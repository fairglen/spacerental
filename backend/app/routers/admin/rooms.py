"""Rooms: create, page, duplicate, update (incl. deactivation), the opening rules, hard delete —
and the blocks router (A02) mounted below.
"""

import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock, deletion
from app.auth import require_admin
from app.booking_validity import (
    holds_slot,
)
from app.database import get_db
from app.media import MediaStorage, get_media_storage
from app.models.booking import Booking
from app.models.room_block import RoomBlock
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.schemas.room_block import RoomBlockOut
from app.schemas.space import (
    AvailabilityRuleOut,
    AvailabilityRulesSetBody,
    CopyToAllDaysBody,
    RoomCreate,
    RoomOut,
    RoomUpdate,
    SpaceOut,
)

from ._common import _booking_counts, _delete_photo_files

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


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
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    """Hard delete (G02): only a room with no booking and no block ever —
    cancelled and expired ones are history too. `is_active` (A07) is the
    everyday delete. Rules, and the photo files, go with it."""
    # Locked: an inserting booking or block waits on the room's row (KEY
    # SHARE), so nothing crosses the guard below and gets cascaded away.
    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.org_id == org_id).with_for_update()
    )
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
    background_tasks.add_task(_delete_photo_files, storage, photos)


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
