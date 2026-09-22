import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock, email, package_hours
from app.auth import require_admin
from app.booking_validity import (
    MAX_BOOKING_DURATION,
    expire_stale_holds,
    has_conflicting_booking,
    holds_slot,
    is_lost_slot_race,
    is_within_open_hours,
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
from app.models.booking import PAID_AT_CHECKOUT, Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember
from app.models.package import Package
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.payments import (
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.booking import (
    AdminBookingCreate,
    AdminBookingOut,
    BookingStatusUpdate,
    MarkPaidBody,
)
from app.schemas.package import PackageCreate, PackageOut, PackageUpdate
from app.schemas.space import (
    AvailabilityRuleOut,
    AvailabilityRulesSetBody,
    RoomCreate,
    RoomOut,
    RoomUpdate,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

router = APIRouter(prefix="/admin", tags=["admin"])


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
    _: User = Depends(require_admin),
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
    return {"space": SpaceOut.model_validate(space)}


@router.put("/spaces/{space_id}")
async def admin_update_space(
    space_id: uuid.UUID,
    body: SpaceUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)

    await db.flush()
    await db.refresh(space)
    return {"space": SpaceOut.model_validate(space)}


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_space(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    space.is_active = False


# ─── Rooms ────────────────────────────────────────────────────────────────────


@router.post("/spaces/{space_id}/rooms", status_code=status.HTTP_201_CREATED)
async def admin_create_room(
    space_id: uuid.UUID,
    body: RoomCreate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
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
    return {"room": RoomOut.model_validate(room)}


@router.put("/rooms/{room_id}")
async def admin_update_room(
    room_id: uuid.UUID,
    body: RoomUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

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
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Replace all availability rules for a room."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Delete existing rules
    existing_result = await db.execute(
        select(AvailabilityRule).where(AvailabilityRule.room_id == room_id)
    )
    for rule in existing_result.scalars().all():
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

    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in new_rules]}


# ─── Bookings ─────────────────────────────────────────────────────────────────


@router.get("/bookings")
async def admin_list_bookings(
    org_id: uuid.UUID = Query(...),
    room_id: uuid.UUID | None = Query(None),
    booking_status: BookingStatus | None = Query(None, alias="status"),
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    filters = [Booking.org_id == org_id]
    if room_id:
        filters.append(Booking.room_id == room_id)
    if booking_status:
        filters.append(Booking.status == booking_status)
    if from_date:
        filters.append(Booking.start_time >= from_date)
    if to_date:
        filters.append(Booking.end_time <= to_date)

    total_result = await db.execute(select(func.count(Booking.id)).where(and_(*filters)))
    total = total_result.scalar_one()

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room), selectinload(Booking.user))
        .where(and_(*filters))
        .order_by(Booking.start_time.desc(), Booking.id.desc())
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
        .options(selectinload(Booking.room).selectinload(Room.space), selectinload(Booking.user))
        .where(Booking.id == booking_id, Booking.org_id == org_id)
        .with_for_update(of=Booking)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return booking


async def _validate_slot(
    db: AsyncSession, room_id: uuid.UUID, start: datetime, end: datetime, now: datetime
) -> None:
    """The same rules a customer booking passes — minus the 24h rule, which is
    a customer's, not an operator's (A01)."""
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be after start_time"
        )
    if start < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="start_time cannot be in the past"
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
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Change a booking's status, move it (time and/or room), or note it (A01).

    A move on a paid booking changes NO money: the old and new hour counts are
    returned as `hours` and the operator settles the difference with the
    customer outside the platform. Known limitation, recorded in TODO A01.
    """
    booking = await _locked_booking(db, booking_id, org_id)
    now = clock.utcnow()
    previous_status = booking.status
    hours_before = booking.duration_hours
    response: dict = {}

    if body.admin_note is not None or "admin_note" in body.model_fields_set:
        booking.admin_note = body.admin_note

    moved = False
    if body.moves:
        room = booking.room
        if body.room_id is not None and body.room_id != booking.room_id:
            room = await _room_in_org(db, body.room_id, org_id)
        start = body.start_time or booking.start_time
        end = body.end_time or booking.end_time
        await _validate_slot(db, room.id, start, end, now)
        if booking.status in (BookingStatus.confirmed, BookingStatus.pending):
            await expire_stale_holds(db, room.id, start, end, now)
            if await has_conflicting_booking(
                db, room.id, start, end, exclude_booking_id=booking.id, now=now
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
                )
        booking.room_id = room.id
        booking.start_time = start
        booking.end_time = end
        booking.duration_hours = _duration(start, end)
        # Deliberately NOT recomputed: no charge and no credit is ever created
        # here (O02 owns money movement). `hours` tells the operator what changed.
        moved = True
        response["hours"] = {
            "before": f"{hours_before:.2f}",
            "after": f"{booking.duration_hours:.2f}",
        }

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
        # into the slot this move or reinstatement is taking.
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
        .options(selectinload(Booking.room).selectinload(Room.space), selectinload(Booking.user))
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

    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking), **response}


@router.post("/bookings", status_code=status.HTTP_201_CREATED)
async def admin_create_booking(
    body: AdminBookingCreate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
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
        .options(selectinload(Booking.room).selectinload(Room.space), selectinload(Booking.user))
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
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
    _: User = Depends(require_admin),
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
        .options(selectinload(Booking.room).selectinload(Room.space), selectinload(Booking.user))
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
    await _confirm_side_effects(
        booking,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking)}


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
    _: User = Depends(require_admin),
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
    return {"package": PackageOut.model_validate(package)}


@router.put("/packages/{package_id}")
async def admin_update_package(
    package_id: uuid.UUID,
    body: PackageUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a package's price/hours/validity, or soft-deactivate it via is_active=false."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(package, field, value)

    await db.flush()
    await db.refresh(package)
    return {"package": PackageOut.model_validate(package)}
