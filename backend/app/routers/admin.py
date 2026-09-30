import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import String, and_, distinct, func, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock, deletion, email, package_hours
from app.auth import require_admin, require_owner
from app.booking_validity import (
    MAX_BOOKING_DURATION,
    expire_stale_holds,
    has_conflicting_booking,
    holds_slot,
    is_lost_slot_race,
    is_within_open_hours,
    violated_constraint,
)
from app.config import settings
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import (
    LockGateway,
    attach_access_codes,
    get_lock_gateway,
    try_issue_access_code,
    try_revoke_access_code,
)
from app.media import MediaStorage, get_media_storage
from app.models.audit import AdminAction
from app.models.booking import PAID_AT_CHECKOUT, Booking, BookingStatus, PaymentMethod
from app.models.organization import Organization, OrganizationMember
from app.models.package import BookingPackageDebit, Package, PurchaseStatus, UserPackagePurchase
from app.models.room_block import RoomBlock
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.payments import (
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.audit import AdminActionOut
from app.schemas.booking import (
    AdminBookingCreate,
    AdminBookingDetailOut,
    AdminBookingOut,
    BookingStatusUpdate,
    MarkPaidBody,
)
from app.schemas.organization import OrganizationSettingsOut, OrganizationSettingsUpdate
from app.schemas.package import PackageCreate, PackageDetailOut, PackageOut, PackageUpdate
from app.schemas.room_block import RoomBlockOut
from app.schemas.space import (
    AvailabilityRuleOut,
    AvailabilityRulesSetBody,
    CopyToAllDaysBody,
    RoomCreate,
    RoomOut,
    RoomUpdate,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# The operator's split view (H02): which purchases a booking's pack hours
# came from. Loaded wherever an operator reads a booking, never for a customer.
_WITH_DEBITS = (
    selectinload(Booking.package_debits)
    .selectinload(BookingPackageDebit.purchase)
    .selectinload(UserPackagePurchase.package)
)


# ─── Dashboard ────────────────────────────────────────────────────────────────


@router.get("/dashboard")
async def dashboard(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    total_bookings_result = await db.execute(
        select(func.count(Booking.id)).where(Booking.org_id == org_id)
    )
    total_bookings = total_bookings_result.scalar_one()

    # Booking revenue is money charged *for the booking*. A package booking is
    # settled with hours bought earlier, so counting its `total_amount` here
    # would bill the same customer twice over — and at the rack rate, which is
    # not even what a discounted pack cost them. Revenue from package sales
    # belongs to the purchase, which this dashboard does not total yet.
    revenue_result = await db.execute(
        select(func.coalesce(func.sum(Booking.total_amount), 0)).where(
            Booking.org_id == org_id,
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.completed]),
            Booking.payment_method.in_(PAID_AT_CHECKOUT),
        )
    )
    total_revenue = float(revenue_result.scalar_one())

    active_users_result = await db.execute(
        select(func.count(distinct(Booking.user_id))).where(Booking.org_id == org_id)
    )
    active_users = active_users_result.scalar_one()

    # Occupancy: confirmed+completed bookings / total confirmed+completed+cancelled bookings
    total_non_pending_result = await db.execute(
        select(func.count(Booking.id)).where(
            Booking.org_id == org_id,
            Booking.status.in_(
                [BookingStatus.confirmed, BookingStatus.completed, BookingStatus.cancelled]
            ),
        )
    )
    total_non_pending = total_non_pending_result.scalar_one()

    confirmed_result = await db.execute(
        select(func.count(Booking.id)).where(
            Booking.org_id == org_id,
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.completed]),
        )
    )
    confirmed = confirmed_result.scalar_one()

    occupancy_rate = (confirmed / total_non_pending * 100) if total_non_pending > 0 else 0.0

    return {
        "total_bookings": total_bookings,
        "total_revenue": total_revenue,
        "occupancy_rate": round(occupancy_rate, 1),
        "active_users": active_users,
    }


# ─── Spaces ───────────────────────────────────────────────────────────────────


@router.get("/spaces")
async def admin_list_spaces(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms))
        .where(Space.org_id == org_id)
        .order_by(Space.created_at.desc())
    )
    spaces = result.scalars().all()
    return {"spaces": [SpaceOut.model_validate(s) for s in spaces]}


@router.post("/spaces", status_code=status.HTTP_201_CREATED)
async def admin_create_space(
    body: SpaceCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    space = Space(
        org_id=org_id,
        name=body.name,
        description=body.description,
        address=body.address,
        city=body.city,
        postal_code=body.postal_code,
        latitude=body.latitude,
        longitude=body.longitude,
        images=body.images,
        amenities=body.amenities,
    )
    db.add(space)
    await db.flush()
    await db.refresh(space)
    await audit.record(
        db, actor=admin, org_id=org_id, entity=space, action="create", after=audit.snapshot(space)
    )
    return {"space": SpaceOut.model_validate(space)}


async def _booking_counts(db: AsyncSession, *where) -> dict[str, int]:
    now = clock.utcnow()
    total = await db.scalar(select(func.count()).select_from(Booking).where(*where)) or 0
    upcoming = (
        await db.scalar(
            select(func.count())
            .select_from(Booking)
            .where(*where, Booking.end_time > now, holds_slot(now))
        )
        or 0
    )
    return {"total": total, "upcoming": upcoming}


@router.get("/spaces/{space_id}")
async def admin_get_space(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One space for its page (G04): rooms with their opening windows, how
    many photos, how many bookings ever and still ahead."""
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms).selectinload(Room.availability_rules))
        .where(Space.id == space_id, Space.org_id == org_id)
    )
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    room_ids = [r.id for r in space.rooms]
    return {
        "space": SpaceOut.model_validate(space),
        "photo_count": len(space.photos) + sum(len(r.photos) for r in space.rooms),
        "bookings": await _booking_counts(db, Booking.room_id.in_(room_ids))
        if room_ids
        else {"total": 0, "upcoming": 0},
    }


@router.put("/spaces/{space_id}")
async def admin_update_space(
    space_id: uuid.UUID,
    body: SpaceUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    before = audit.snapshot(space)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)

    await db.flush()
    await db.refresh(space)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=space,
        action="update",
        before=before,
        after=audit.snapshot(space),
    )
    return {"space": SpaceOut.model_validate(space)}


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_space(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Hard delete (G02): only a space none of whose rooms ever had a booking;
    `is_active` is the everyday delete. The rooms, their rules, blocks and
    photo files go with it, and the trail keeps the whole space."""
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms))
        .where(Space.id == space_id, Space.org_id == org_id)
    )
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    deletion.require_confirm(confirm, space.id, space.name)
    booked = (
        await db.execute(
            select(Room.id, Room.name, func.count(Booking.id))
            .join(Booking, Booking.room_id == Room.id)
            .where(Room.space_id == space.id)
            .group_by(Room.id, Room.name)
            .order_by(Room.name)
        )
    ).all()
    if booked:
        raise deletion.blocked(
            "Rooms of this space have bookings; deactivate the space instead",
            [{"room_id": str(rid), "name": name, "bookings": n} for rid, name, n in booked],
        )
    before = audit.snapshot(space)
    photos = [*space.photos, *(p for room in space.rooms for p in room.photos)]
    await db.delete(space)
    await db.flush()
    await audit.record(db, actor=admin, org_id=org_id, entity=space, action="delete", before=before)
    await _delete_photo_files(storage, photos)


async def _delete_photo_files(storage: MediaStorage, photos: list[dict]) -> None:
    # After the rows are gone. A file that will not go is logged, never
    # raised: an orphan file is a nuisance, a rolled-back delete that left
    # some files already gone would be a dangling row.
    for photo in photos:
        for key in (photo.get("key"), photo.get("thumb_key")):
            if key:
                try:
                    await storage.delete(key)
                except OSError:
                    logger.exception("Could not delete media file %s", key)


# ─── Rooms ────────────────────────────────────────────────────────────────────


@router.post("/spaces/{space_id}/rooms", status_code=status.HTTP_201_CREATED)
async def admin_create_room(
    space_id: uuid.UUID,
    body: RoomCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    room = Room(
        space_id=space_id,
        org_id=org_id,
        name=body.name,
        description=body.description,
        capacity=body.capacity,
        hourly_rate=body.hourly_rate,
        color=body.color,
        amenities=body.amenities,
        images=body.images,
    )
    db.add(room)
    await db.flush()
    await db.refresh(room)
    await audit.record(
        db, actor=admin, org_id=org_id, entity=room, action="create", after=audit.snapshot(room)
    )
    return {"room": RoomOut.model_validate(room)}


@router.get("/rooms/{room_id}")
async def admin_get_room(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One room for its page (G04): its space, the rule rows (with ids, for
    the editor), the blocks of the next 30 days, the counts."""
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.space), selectinload(Room.availability_rules))
        .where(Room.id == room_id, Room.org_id == org_id)
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    now = clock.utcnow()
    blocks = (
        (
            await db.execute(
                select(RoomBlock)
                .where(
                    RoomBlock.room_id == room.id,
                    RoomBlock.end_time > now,
                    RoomBlock.start_time < now + timedelta(days=30),
                )
                .order_by(RoomBlock.start_time)
            )
        )
        .scalars()
        .all()
    )
    rules = sorted(room.availability_rules, key=lambda r: (r.day_of_week, r.open_time))
    return {
        "room": RoomOut.model_validate(room),
        "space": SpaceOut.model_validate(room.space),
        "rules": [AvailabilityRuleOut.model_validate(r) for r in rules],
        "blocks": [RoomBlockOut.model_validate(b) for b in blocks],
        "photo_count": len(room.photos),
        "bookings": await _booking_counts(db, Booking.room_id == room.id),
    }


@router.post("/rooms/{room_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def admin_duplicate_room(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """A copy of the room in the same space (G04): fields, amenities and
    the opening rules; not the photos, and not the bookings, obviously."""
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.availability_rules))
        .where(Room.id == room_id, Room.org_id == org_id)
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    copy = Room(
        space_id=source.space_id,
        org_id=org_id,
        name=f"{source.name} (cópia)",
        description=source.description,
        capacity=source.capacity,
        hourly_rate=source.hourly_rate,
        color=source.color,
        amenities=list(source.amenities),
        images=[],
        photos=[],
        is_active=source.is_active,
    )
    db.add(copy)
    await db.flush()
    for rule in source.availability_rules:
        db.add(
            AvailabilityRule(
                room_id=copy.id,
                day_of_week=rule.day_of_week,
                open_time=rule.open_time,
                close_time=rule.close_time,
                is_active=rule.is_active,
            )
        )
    await db.flush()
    await db.refresh(copy)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=copy,
        action="duplicate",
        after=audit.snapshot(copy),
        reason=f"Cópia de {source.name} ({deletion.short_id(source.id)})",
    )
    return {"room": RoomOut.model_validate(copy)}


@router.put("/rooms/{room_id}")
async def admin_update_room(
    room_id: uuid.UUID,
    body: RoomUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    before = audit.snapshot(room)

    changes = body.model_dump(exclude_unset=True)
    if room.is_active and changes.get("is_active") is False:
        # A07: a room with bookings still holding future slots cannot go
        # inactive — the operator moves or cancels them first. The 409 lists
        # them (soonest first, capped) with the total, so the UI can show the
        # way out instead of a bare refusal.
        pending = await _future_slot_holders(db, room_id)
        if pending["total"]:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=pending)

    for field, value in changes.items():
        setattr(room, field, value)

    await db.flush()
    await db.refresh(room)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=room,
        action="update",
        before=before,
        after=audit.snapshot(room),
    )
    return {"room": RoomOut.model_validate(room)}


_DEACTIVATE_LIST_CAP = 20


async def _future_slot_holders(db: AsyncSession, room_id: uuid.UUID) -> dict:
    now = clock.utcnow()
    where = (Booking.room_id == room_id, Booking.end_time > now, holds_slot(now))
    total = await db.scalar(select(func.count()).select_from(Booking).where(*where)) or 0
    rows = (
        (
            await db.execute(
                select(Booking)
                .options(selectinload(Booking.user))
                .where(*where)
                .order_by(Booking.start_time.asc())
                .limit(_DEACTIVATE_LIST_CAP)
            )
        )
        .scalars()
        .all()
    )
    return {
        "message": "Room has future bookings",
        "total": total,
        "bookings": [
            {
                "id": str(b.id),
                "start_time": b.start_time.isoformat(),
                "end_time": b.end_time.isoformat(),
                "status": b.status.value,
                "customer_email": b.user.email if b.user else None,
                "customer_name": b.user.name if b.user else None,
            }
            for b in rows
        ],
    }


@router.get("/rooms/{room_id}/availability")
async def admin_get_availability(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Current availability rules for a room, for pre-filling the admin edit form."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    rules_result = await db.execute(
        select(AvailabilityRule)
        .where(AvailabilityRule.room_id == room_id)
        .order_by(AvailabilityRule.day_of_week)
    )
    rules = rules_result.scalars().all()
    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in rules]}


@router.post("/rooms/{room_id}/availability")
async def admin_set_availability(
    room_id: uuid.UUID,
    body: AvailabilityRulesSetBody,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Replace all availability rules for a room."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Delete existing rules
    existing_result = await db.execute(
        select(AvailabilityRule)
        .where(AvailabilityRule.room_id == room_id)
        .order_by(AvailabilityRule.day_of_week, AvailabilityRule.open_time)
    )
    existing = existing_result.scalars().all()
    before = {"id": str(room.id), "rules": _rules_for_audit(existing)}
    for rule in existing:
        await db.delete(rule)

    # Insert new rules
    new_rules = []
    for rule_in in body.rules:
        rule = AvailabilityRule(
            room_id=room_id,
            day_of_week=rule_in.day_of_week,
            open_time=rule_in.open_time,
            close_time=rule_in.close_time,
        )
        db.add(rule)
        new_rules.append(rule)

    await db.flush()
    for r in new_rules:
        await db.refresh(r)
    # One row for the whole replacement, on the room: the rules are the
    # room's schedule, and a per-rule trail would say nothing readable.
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=room,
        action="availability.set",
        before=before,
        after={"id": str(room.id), "rules": _rules_for_audit(new_rules)},
    )

    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in new_rules]}


@router.post("/rooms/{room_id}/availability/copy-to-all-days")
async def admin_copy_availability_to_all_days(
    room_id: uuid.UUID,
    body: CopyToAllDaysBody,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Every weekday gets the source day's window(s) (G04); a closed source
    day has nothing to copy (422). Audited like the replace-all: one row on
    the room with the whole schedule before and after."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    existing = (
        (
            await db.execute(
                select(AvailabilityRule)
                .where(AvailabilityRule.room_id == room.id)
                .order_by(AvailabilityRule.day_of_week, AvailabilityRule.open_time)
            )
        )
        .scalars()
        .all()
    )
    source = [r for r in existing if r.day_of_week == body.day_of_week and r.is_active]
    if not source:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The source day is closed; nothing to copy",
        )
    before = {"id": str(room.id), "rules": _rules_for_audit(existing)}
    for rule in existing:
        if rule.day_of_week != body.day_of_week:
            await db.delete(rule)
    new_rules = list(source)
    for day in range(7):
        if day == body.day_of_week:
            continue
        for rule in source:
            copy = AvailabilityRule(
                room_id=room.id,
                day_of_week=day,
                open_time=rule.open_time,
                close_time=rule.close_time,
            )
            db.add(copy)
            new_rules.append(copy)
    await db.flush()
    for r in new_rules:
        await db.refresh(r)
    new_rules.sort(key=lambda r: (r.day_of_week, r.open_time))
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=room,
        action="availability.set",
        before=before,
        after={"id": str(room.id), "rules": _rules_for_audit(new_rules)},
    )
    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in new_rules]}


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_room(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Hard delete (G02): only a room with no booking and no block ever —
    cancelled and expired ones are history too. `is_active` (A07) is the
    everyday delete. Rules, and the photo files, go with it."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    deletion.require_confirm(confirm, room.id, room.name)
    bookings = await db.scalar(
        select(func.count()).select_from(Booking).where(Booking.room_id == room.id)
    )
    blocks = await db.scalar(
        select(func.count()).select_from(RoomBlock).where(RoomBlock.room_id == room.id)
    )
    if bookings or blocks:
        raise deletion.blocked(
            "The room has bookings or blocks; deactivate it instead",
            {"bookings": bookings or 0, "blocks": blocks or 0},
        )
    before = audit.snapshot(room)
    photos = list(room.photos)
    await db.delete(room)
    await db.flush()
    await audit.record(db, actor=admin, org_id=org_id, entity=room, action="delete", before=before)
    await _delete_photo_files(storage, photos)


@router.delete("/rooms/{room_id}/availability/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_availability_rule(
    room_id: uuid.UUID,
    rule_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One rule (a weekday's window) off a room's schedule; the replace-all
    endpoint stays for the editor. No confirm: recreated in one click."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    rule = await db.scalar(
        select(AvailabilityRule).where(
            AvailabilityRule.id == rule_id, AvailabilityRule.room_id == room.id
        )
    )
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found")
    before = audit.snapshot(rule)
    await db.delete(rule)
    await db.flush()
    await audit.record(db, actor=admin, org_id=org_id, entity=rule, action="delete", before=before)


def _rules_for_audit(rules) -> list[dict]:
    return [
        {
            "day_of_week": r.day_of_week,
            "open_time": r.open_time.isoformat(),
            "close_time": r.close_time.isoformat(),
        }
        for r in sorted(rules, key=lambda r: (r.day_of_week, r.open_time))
    ]


# ─── Bookings ─────────────────────────────────────────────────────────────────


BookingSort = Literal["start_time", "-start_time", "created_at", "-created_at"]


@router.get("/bookings")
async def admin_list_bookings(
    org_id: uuid.UUID = Query(...),
    room_id: uuid.UUID | None = Query(None),
    booking_status: BookingStatus | None = Query(None, alias="status"),
    payment_method: PaymentMethod | None = Query(None),
    q: str | None = Query(None, max_length=200),
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    include_cancelled: bool = Query(True),
    sort: BookingSort = Query("-start_time"),
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """The org's bookings (G04 filters): `q` matches the customer's name or
    email, or the booking's short id; `include_cancelled=false` hides the
    cancelled rows; `sort` is start_time|created_at, `-` for newest first."""
    filters = [Booking.org_id == org_id]
    if room_id:
        filters.append(Booking.room_id == room_id)
    if booking_status:
        filters.append(Booking.status == booking_status)
    if payment_method:
        filters.append(Booking.payment_method == payment_method)
    if from_date:
        filters.append(Booking.start_time >= from_date)
    if to_date:
        filters.append(Booking.end_time <= to_date)
    if not include_cancelled:
        filters.append(Booking.status != BookingStatus.cancelled)
    query = select(Booking)
    if q and q.strip():
        needle = q.strip().lower()
        query = query.join(User, User.id == Booking.user_id)
        filters.append(
            or_(
                func.lower(User.email).like(f"%{needle}%"),
                func.lower(User.name).like(f"%{needle}%"),
                func.replace(func.cast(Booking.id, String), "-", "").like(f"{needle}%"),
            )
        )
    column = Booking.created_at if sort.endswith("created_at") else Booking.start_time
    order = column.asc() if not sort.startswith("-") else column.desc()

    total_result = await db.execute(
        select(func.count()).select_from(query.where(and_(*filters)).subquery())
    )
    total = total_result.scalar_one()

    result = await db.execute(
        query.options(selectinload(Booking.room), selectinload(Booking.user), _WITH_DEBITS)
        .where(and_(*filters))
        .order_by(order, Booking.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    bookings = result.scalars().all()
    attach_access_codes(lock_gateway, bookings)
    return {
        "bookings": [AdminBookingOut.model_validate(b) for b in bookings],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def _locked_booking(db: AsyncSession, booking_id: uuid.UUID, org_id: uuid.UUID) -> Booking:
    """The booking, inside the operator's org, locked for the transaction."""
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking_id, Booking.org_id == org_id)
        .with_for_update(of=Booking)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return booking


@router.get("/bookings/{booking_id}")
async def admin_get_booking(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """One booking for its page (G04): customer, room, payment (method,
    amount, pack debits, Stripe session id), access code, both notes, the
    hold deadline, and its last twenty trail rows."""
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking_id, Booking.org_id == org_id)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    attach_access_codes(lock_gateway, booking)
    history = (
        (
            await db.execute(
                select(AdminAction)
                .options(selectinload(AdminAction.actor))
                .where(
                    AdminAction.org_id == org_id,
                    AdminAction.entity_type == "booking",
                    AdminAction.entity_id == booking.id,
                )
                .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    return {
        "booking": AdminBookingDetailOut.model_validate(booking),
        "history": [AdminActionOut.model_validate(a) for a in history],
    }


async def _validate_slot(
    db: AsyncSession,
    room_id: uuid.UUID,
    start: datetime,
    end: datetime,
    now: datetime,
    *,
    original_start: datetime | None = None,
) -> None:
    """The same rules a customer booking passes — minus the 24h rule, which is
    a customer's, not an operator's (A01), and minus the booking window (H01).

    The past rule is an operator's (H03 b): a booking that has already
    started may keep its start (or be said to have started later) while the
    end or the room changes; only moving the START to before both now and
    where it was is refused. The end must still lie ahead. Without an
    `original_start` (a new booking) the start itself must lie ahead.
    """
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be after start_time"
        )
    floor = now if original_start is None else min(now, original_start)
    if start < floor:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="start_time cannot be in the past"
        )
    if end <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time cannot be in the past"
        )
    if end - start > MAX_BOOKING_DURATION:
        max_hours = int(MAX_BOOKING_DURATION.total_seconds() // 3600)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking duration cannot exceed {max_hours} hours",
        )
    if not await is_within_open_hours(db, room_id, start, end):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requested time is outside the room's opening hours",
        )


async def _room_in_org(db: AsyncSession, room_id: uuid.UUID, org_id: uuid.UUID) -> Room:
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.space))
        .where(Room.id == room_id, Room.org_id == org_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None or not room.space.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


def _duration(start: datetime, end: datetime) -> Decimal:
    return Decimal(str(round((end - start).total_seconds() / 3600, 2)))


async def _confirm_side_effects(
    booking: Booking,
    *,
    background_tasks: BackgroundTasks,
    email_gateway: EmailGateway,
    lock_gateway: LockGateway,
    changed: bool = False,
) -> None:
    """What every confirmation does: the email and the access code.

    Shared by a customer-paid confirmation (webhook), an operator confirm, a
    manual booking and mark-paid, so none of them can drift.
    """
    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.booking_confirmation_email(
            to=booking.user.email,
            space_name=booking.room.space.name,
            room_name=booking.room.name,
            start_time=booking.start_time,
            end_time=booking.end_time,
            changed=changed,
        ),
    )
    # Best-effort — a Seam outage must not block an operator (Epic 3.3).
    await try_issue_access_code(
        lock_gateway,
        booking_id=booking.id,
        room_id=booking.room_id,
        name=f"Reserva {booking.id} — {booking.room.name}",
        starts_at=booking.start_time,
        ends_at=booking.end_time,
    )


@router.put("/bookings/{booking_id}")
async def admin_update_booking(
    booking_id: uuid.UUID,
    body: BookingStatusUpdate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Change a booking's status, move it (time and/or room), or note it (A01).

    A move on a paid booking changes NO money: the old and new hour counts are
    returned as `hours` and the operator settles the difference with the
    customer outside the platform. Known limitation, recorded in TODO A01.
    The PACK share does follow the new length (H03): shrinking credits the
    surplus back to the purchases it came from, growing draws the extra from
    the customer's hour bank, and `hours.uncovered` says what the bank could
    not give.
    """
    booking = await _locked_booking(db, booking_id, org_id)
    now = clock.utcnow()
    previous_status = booking.status
    hours_before = booking.duration_hours
    before = audit.snapshot(booking)
    response: dict = {}

    if body.admin_note is not None or "admin_note" in body.model_fields_set:
        booking.admin_note = body.admin_note
    if "notes" in body.model_fields_set:
        booking.notes = body.notes
    overridden = False
    if "total_amount" in body.model_fields_set:
        # The price override (G04): the recorded amount changes, no charge and
        # no refund is made; the reason goes to the trail.
        overridden = booking.total_amount != body.total_amount
        booking.total_amount = body.total_amount

    moved = False
    if body.moves:
        room = booking.room
        if body.room_id is not None and body.room_id != booking.room_id:
            room = await _room_in_org(db, body.room_id, org_id)
        start = body.start_time or booking.start_time
        end = body.end_time or booking.end_time
        await _validate_slot(db, room.id, start, end, now, original_start=booking.start_time)
        if booking.status in (BookingStatus.confirmed, BookingStatus.pending):
            await expire_stale_holds(db, room.id, start, end, now)
            # That bulk update may have flipped THIS row: a lapsed hold that
            # still read `pending` and overlaps its own new slot. Its pack
            # share is back on the purchases now; the settle below and the
            # status logic must see what the row really is, or the hours
            # would be credited twice (shrink) or drawn for a row that holds
            # nothing (grow), and the row written back as `pending`.
            await db.refresh(booking, attribute_names=["status", "hold_expires_at"])
            previous_status = booking.status
            if await has_conflicting_booking(
                db, room.id, start, end, exclude_booking_id=booking.id, now=now
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
                )
        booking.room_id = room.id
        booking.start_time = start
        booking.end_time = end
        new_duration = _duration(start, end)
        # The pack share follows the new length through the hour bank (H03);
        # `total_amount` deliberately does not: no charge and no credit is ever
        # created here (O02 owns money movement). `hours` tells the operator
        # what changed and what the bank could not cover.
        try:
            uncovered = await package_hours.settle_moved_booking(
                db, booking, new_duration=new_duration, now=now
            )
        except DBAPIError as exc:
            # Losing a lock race with a concurrent walk is a retry, not a 500.
            if not is_lost_slot_race(exc):
                raise
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The customer's packs are being used right now; try again",
            ) from None
        booking.duration_hours = new_duration
        moved = True
        response["hours"] = {
            "before": f"{hours_before:.2f}",
            "after": f"{booking.duration_hours:.2f}",
        }
        if uncovered > 0:
            response["hours"]["uncovered"] = f"{uncovered:.2f}"

    new_status = body.status if body.status is not None else previous_status
    slot_holding = (BookingStatus.confirmed, BookingStatus.pending)
    entering_slot = (
        new_status != previous_status
        and new_status in slot_holding
        and previous_status not in slot_holding
    )
    if entering_slot:
        # Same reconciliation every slot-acquiring write does (C03): a lapsed
        # unpaid hold is free to us but still counted by the EXCLUDE
        # constraint until it is flipped to `expired`.
        await expire_stale_holds(db, booking.room_id, booking.start_time, booking.end_time, now)
        if await has_conflicting_booking(
            db,
            booking.room_id,
            booking.start_time,
            booking.end_time,
            exclude_booking_id=booking.id,
            now=now,
        ):
            # A cancelled/completed booking's slot may have been sold again
            # since it let go of it. Reinstating must not silently create the
            # double-booking the customer-facing path would have rejected.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
            )

    # An admin status change moves the pack's share exactly like every other
    # transition does (`package_hours.settle_status_change`): returned when the
    # booking stops holding its slot, taken again when it is reinstated — or an
    # admin-cancelled booking would silently burn the customer's hours, and a
    # cancel/re-confirm round trip would hand out a free one. Re-debiting can
    # fail honestly: the returned hours may already be spent elsewhere.
    if not await package_hours.settle_status_change(
        db, booking, previous=previous_status, new=new_status, now=now
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=("The package no longer has enough hours to reinstate this booking"),
        )

    booking.status = new_status
    # Keep the hold marker consistent with the new status (C03): a one-off
    # revived as `pending` is an unpaid hold again and needs a fresh deadline
    # (a series occurrence stays deadline-less for the operator); any other
    # status holds no checkout hold.
    if new_status is BookingStatus.pending:
        payable_hold = (
            booking.payment_method in PAID_AT_CHECKOUT and booking.recurrence_rule_id is None
        )
        if payable_hold and previous_status is not BookingStatus.pending:
            booking.hold_expires_at = now + timedelta(minutes=settings.BOOKING_HOLD_MINUTES)
        elif not payable_hold:
            booking.hold_expires_at = None
        # An already-pending hold keeps its deadline: re-asserting `pending`
        # must not let an operator keep an abandoned hold alive indefinitely.
    else:
        booking.hold_expires_at = None

    try:
        await db.flush()
    except DBAPIError as exc:
        # The EXCLUDE constraint is the last line against a concurrent write
        # into the slot this move or reinstatement is taking. Any other
        # constraint is a refused write, reported by name (H03) — never a 500.
        constraint = violated_constraint(exc)
        if constraint is not None:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"The change violates a constraint ({constraint})",
            ) from None
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    await db.refresh(booking)
    # Re-attach the relationships the refresh expired (the email needs them),
    # against the room the booking is in NOW.
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()

    if new_status != previous_status and new_status is BookingStatus.confirmed:
        await _confirm_side_effects(
            booking,
            background_tasks=background_tasks,
            email_gateway=email_gateway,
            lock_gateway=lock_gateway,
        )
    elif new_status != previous_status and new_status is BookingStatus.cancelled:
        email.enqueue_email(
            background_tasks,
            email_gateway,
            email.booking_cancellation_email(
                to=booking.user.email,
                space_name=booking.room.space.name,
                room_name=booking.room.name,
                start_time=booking.start_time,
                end_time=booking.end_time,
            ),
        )
        await try_revoke_access_code(lock_gateway, booking_id=booking.id)
    elif moved and booking.status is BookingStatus.confirmed:
        # A confirmed booking that changed time or room: the confirmation
        # again, with the new details and one line saying it was altered, and
        # an access code for the new window.
        await try_revoke_access_code(lock_gateway, booking_id=booking.id)
        await _confirm_side_effects(
            booking,
            background_tasks=background_tasks,
            email_gateway=email_gateway,
            lock_gateway=lock_gateway,
            changed=True,
        )

    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action=_booking_action(previous_status, new_status, moved, overridden),
        before=before,
        after=audit.snapshot(booking),
        reason=body.reason,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking), **response}


def _booking_action(
    previous: BookingStatus, new: BookingStatus, moved: bool, overridden: bool = False
) -> str:
    """The verb the trail shows for a generic booking update."""
    if overridden and new == previous and not moved:
        return "price.override"
    if new != previous:
        return {
            BookingStatus.cancelled: "cancel",
            BookingStatus.confirmed: "confirm",
            BookingStatus.completed: "complete",
        }.get(new, f"status.{new.value}")
    return "move" if moved else "update"


@router.post("/bookings", status_code=status.HTTP_201_CREATED)
async def admin_create_booking(
    body: AdminBookingCreate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """A booking made by the operator for a customer, paid or arranged outside
    the platform (`manual`): confirmed at once, with code and email (A01)."""
    room = await _room_in_org(db, body.room_id, org_id)
    # The customer must be a member of THIS org: the same rule the customer
    # path applies to itself, and the only link between a user and a tenant.
    member = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == body.user_id, OrganizationMember.org_id == org_id
        )
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found in this organization"
        )
    now = clock.utcnow()
    await _validate_slot(db, room.id, body.start_time, body.end_time, now)
    await expire_stale_holds(db, room.id, body.start_time, body.end_time, now)
    if await has_conflicting_booking(db, room.id, body.start_time, body.end_time, now=now):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        )

    duration = _duration(body.start_time, body.end_time)
    booking = Booking(
        org_id=org_id,
        room_id=room.id,
        user_id=body.user_id,
        start_time=body.start_time,
        end_time=body.end_time,
        duration_hours=duration,
        # The slot's value, for the record; nothing is charged through here.
        total_amount=duration * room.hourly_rate,
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.manual,
        notes=body.notes,
        admin_note=body.admin_note,
        hold_expires_at=None,
    )
    db.add(booking)
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="create.manual",
        after=audit.snapshot(booking),
    )
    await _confirm_side_effects(
        booking,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking)}


@router.post("/bookings/{booking_id}/mark-paid")
async def admin_mark_booking_paid(
    booking_id: uuid.UUID,
    body: MarkPaidBody,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """An unpaid hourly/mixed hold the customer paid some other way (cash, MB
    WAY): confirmed as `manual`, with code and email (A01). The open Checkout
    Session is expired at the provider first, and the row loses its session
    id, so a late `checkout.session.completed` can no longer match it — the
    webhook looks bookings up by session id.
    """
    booking = await _locked_booking(db, booking_id, org_id)
    now = clock.utcnow()
    before = audit.snapshot(booking)
    live_or_lapsed_hold = booking.status in (BookingStatus.pending, BookingStatus.expired) and (
        booking.hold_expires_at is not None or booking.status is BookingStatus.expired
    )
    if booking.payment_method not in PAID_AT_CHECKOUT or not live_or_lapsed_hold:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Booking is {booking.status.value} ({booking.payment_method.value})"
                " and cannot be marked as paid"
            ),
        )
    if booking.status is BookingStatus.expired:
        # Its slot was released; take it again, like "Pagar agora" does.
        await expire_stale_holds(db, booking.room_id, booking.start_time, booking.end_time, now)
        if await has_conflicting_booking(
            db,
            booking.room_id,
            booking.start_time,
            booking.end_time,
            exclude_booking_id=booking.id,
            now=now,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
            )
    if booking.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not close the payment session",
            ) from exc
        booking.stripe_checkout_session_id = None

    # A lapsed mixed hold gave its pack hours back; confirming takes them again.
    if not await package_hours.settle_status_change(
        db, booking, previous=booking.status, new=BookingStatus.confirmed, now=now
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The package no longer has the hours this booking reserved",
        )
    booking.status = BookingStatus.confirmed
    booking.payment_method = PaymentMethod.manual
    booking.hold_expires_at = None
    stamp = f"Marcada como paga: {body.reason}"
    booking.admin_note = f"{booking.admin_note}\n{stamp}" if booking.admin_note else stamp
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="mark_paid",
        before=before,
        after=audit.snapshot(booking),
        reason=body.reason,
    )
    await _confirm_side_effects(
        booking,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking)}


@router.delete("/bookings/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_booking(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    reason: str | None = Query(default=None, max_length=2000),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Hard delete (G02): "delete" is cancel. Only a booking that never held
    money and holds no pack hours may go: an expired hold; a cancelled one
    with amount 0 and no debit rows; or an operator's `manual` booking, with
    a reason. Anything else is a 409 "cancel instead". An expired hold's
    Checkout Session is still payable (the webhook accepts a late payment,
    C03), so it is expired at the provider first — a session that already
    completed keeps the row (409). The trail keeps the whole booking."""
    booking = await _locked_booking(db, booking_id, org_id)
    deletion.require_confirm(confirm, booking.id)
    debits = await db.scalar(
        select(func.count())
        .select_from(BookingPackageDebit)
        .where(BookingPackageDebit.booking_id == booking.id)
    )
    if booking.payment_method is PaymentMethod.manual:
        if not (reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A reason is required to delete a manual booking",
            )
        allowed = debits == 0
    else:
        allowed = booking.status is BookingStatus.expired or (
            booking.status is BookingStatus.cancelled and booking.total_amount == 0 and debits == 0
        )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This booking held money or pack hours; cancel it instead",
        )
    if booking.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not close the payment session",
            ) from exc
    before = audit.snapshot(booking)
    await db.delete(booking)
    await db.flush()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="delete",
        before=before,
        reason=(reason or "").strip() or None,
    )
    await try_revoke_access_code(lock_gateway, booking_id=booking.id)


# ─── Users ────────────────────────────────────────────────────────────────────


# ─── Packages ─────────────────────────────────────────────────────────────────


@router.get("/packages")
async def admin_list_packages(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Package).where(Package.org_id == org_id).order_by(Package.hours.asc())
    )
    packages = result.scalars().all()
    return {"packages": [PackageOut.model_validate(p) for p in packages]}


@router.post("/packages", status_code=status.HTTP_201_CREATED)
async def admin_create_package(
    body: PackageCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    package = Package(
        org_id=org_id,
        name=body.name,
        hours=body.hours,
        price=body.price,
        validity_days=body.validity_days,
    )
    db.add(package)
    await db.flush()
    await db.refresh(package)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=package,
        action="create",
        after=audit.snapshot(package),
    )
    return {"package": PackageOut.model_validate(package)}


@router.get("/packages/{package_id}")
async def admin_get_package(
    package_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One package for its page (G04): how many purchases, how many of them
    still spendable, and the hours still outstanding on those."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    now = clock.utcnow()
    total = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id)
    )
    live = UserPackagePurchase.status == PurchaseStatus.active
    unexpired = UserPackagePurchase.expires_at > now
    spendable = UserPackagePurchase.hours_remaining > 0
    active = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id, live, unexpired, spendable)
    )
    outstanding = await db.scalar(
        select(func.coalesce(func.sum(UserPackagePurchase.hours_remaining), 0)).where(
            UserPackagePurchase.package_id == package.id, live, unexpired, spendable
        )
    )
    return PackageDetailOut(
        package=PackageOut.model_validate(package),
        purchases={"total": total or 0, "active": active or 0},
        hours_outstanding=Decimal(outstanding or 0).quantize(Decimal("0.01")),
    )


@router.put("/packages/{package_id}")
async def admin_update_package(
    package_id: uuid.UUID,
    body: PackageUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a package's price/hours/validity, or soft-deactivate it via is_active=false."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    before = audit.snapshot(package)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(package, field, value)

    await db.flush()
    await db.refresh(package)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=package,
        action="update",
        before=before,
        after=audit.snapshot(package),
    )
    return {"package": PackageOut.model_validate(package)}


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_package(
    package_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hard delete (G02): only a package nobody ever bought or was granted;
    `is_active` is the everyday delete."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    deletion.require_confirm(confirm, package.id, package.name)
    purchases = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id)
    )
    if purchases:
        raise deletion.blocked(
            "The package has purchases; deactivate it instead", {"purchases": purchases}
        )
    before = audit.snapshot(package)
    await db.delete(package)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=package, action="delete", before=before
    )


# ─── Organisation ─────────────────────────────────────────────────────────────

_ORG_SETTINGS_KEYS = ("contact_email", "contact_phone", "timezone")


def _org_out(org: Organization) -> OrganizationSettingsOut:
    values = org.settings or {}
    return OrganizationSettingsOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        plan=org.plan,
        contact_email=values.get("contact_email") or None,
        contact_phone=values.get("contact_phone") or None,
        timezone=values.get("timezone") or "Europe/Lisbon",
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.get("/organization")
async def admin_get_organization(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The organisation's settings (G04): name, public contact, default
    timezone; `slug` is read-only. Admins read; the owner edits."""
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {"organization": _org_out(org)}


@router.put("/organization")
async def admin_update_organization(
    body: OrganizationSettingsUpdate,
    org_id: uuid.UUID = Query(...),
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    org = await db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    before = _org_out(org).model_dump(mode="json")
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        org.name = changes.pop("name")
    # JSON columns do not see in-place edits: always a new dict.
    values = dict(org.settings or {})
    for key in _ORG_SETTINGS_KEYS:
        if key in changes:
            values[key] = changes[key]
    org.settings = values
    await db.flush()
    await db.refresh(org)
    await audit.record(
        db,
        actor=owner,
        org_id=org_id,
        entity=org,
        action="update",
        before=before,
        after=_org_out(org).model_dump(mode="json"),
    )
    return {"organization": _org_out(org)}
