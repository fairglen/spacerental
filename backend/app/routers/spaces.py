import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock
from app.booking_validity import booking_window_end, holds_slot, local_hourly_slots
from app.database import get_db
from app.models.booking import Booking
from app.models.room_block import RoomBlock
from app.models.space import AvailabilityRule, Room, Space
from app.ratelimit import PUBLIC_TIER, rate_limit
from app.schemas.space import AvailabilitySlot, RoomOut, SlotReason, SpaceOut

router = APIRouter(tags=["spaces"])


@router.get("/spaces")
@rate_limit(PUBLIC_TIER)
async def list_spaces(db: AsyncSession = Depends(get_db)):
    """List all active spaces (public)."""
    result = await db.execute(
        select(Space).where(Space.is_active == True).order_by(Space.created_at.desc())  # noqa: E712
    )
    spaces = result.scalars().all()
    return {"spaces": [SpaceOut.model_validate(s) for s in spaces]}


@router.get("/spaces/{space_id}")
@rate_limit(PUBLIC_TIER)
async def get_space(space_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Space detail with rooms (public)."""
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms).selectinload(Room.availability_rules))
        .where(Space.id == space_id, Space.is_active == True)  # noqa: E712
    )
    space = result.scalar_one_or_none()

    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    active_rooms = [r for r in space.rooms if r.is_active]
    return {
        "space": SpaceOut.model_validate(space),
        "rooms": [RoomOut.model_validate(r) for r in active_rooms],
    }


@router.get("/rooms/{room_id}/availability")
@rate_limit(PUBLIC_TIER)
async def get_room_availability(
    room_id: uuid.UUID,
    date: date = Query(..., description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate 1-hour availability slots for a room on a given date.
    Returns array of {start, end, available, reason}.

    `date` is the SPACE's local date (R01): the slots are the wall-clock hours
    the room is open that day, returned as UTC instants.
    """
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.space))
        .where(Room.id == room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    zone = ZoneInfo(room.space.timezone)

    # A slot that has already started cannot be booked (POST /bookings rejects
    # a past start_time), so it must not be advertised as available either;
    # the calendar used to paint every same-day hour green late at night (B24).
    now = clock.utcnow()
    # The customer's horizon (H01). Days past it are refused outright rather
    # than served as all-unavailable, so a client cannot fan out one request
    # per day for months; the last day inside it is served with each slot past
    # the exact instant marked `beyond_window`.
    window_end = booking_window_end(now)
    if date > window_end.astimezone(zone).date():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="date is beyond the booking window",
        )

    # 0=Monday, 6=Sunday in Python's weekday()
    day_of_week = date.weekday()

    result = await db.execute(
        select(AvailabilityRule).where(
            AvailabilityRule.room_id == room_id,
            AvailabilityRule.day_of_week == day_of_week,
            AvailabilityRule.is_active == True,  # noqa: E712
        )
    )
    rules = result.scalars().all()

    if not rules:
        # No availability rule for this day — room is closed
        return {"slots": []}

    # One slot per wall-clock hour of each open window (several windows per
    # day are fine, e.g. morning + evening), as UTC instants.
    hourly: set[tuple[datetime, datetime]] = set()
    for rule in rules:
        hourly.update(local_hourly_slots(date, rule.open_time, rule.close_time, zone))
    slot_starts = sorted(s[0] for s in hourly)

    if not slot_starts:
        return {"slots": []}

    day_start = slot_starts[0]
    day_end = max(s[1] for s in hourly)

    # Bookings holding a slot on this date; an expired unpaid hold is free (C03).
    result = await db.execute(
        select(Booking).where(
            and_(
                Booking.room_id == room_id,
                holds_slot(now),
                Booking.start_time < day_end,
                Booking.end_time > day_start,
            )
        )
    )
    existing_bookings = result.scalars().all()
    # Blocked time (A02) reads exactly like a booking to the customer.
    blocks = (
        (
            await db.execute(
                select(RoomBlock).where(
                    RoomBlock.room_id == room_id,
                    RoomBlock.start_time < day_end,
                    RoomBlock.end_time > day_start,
                )
            )
        )
        .scalars()
        .all()
    )
    booked_ranges = [(b.start_time, b.end_time) for b in existing_bookings]
    blocked_ranges = [(b.start_time, b.end_time) for b in blocks]

    def overlaps(ranges, slot_start: datetime, slot_end: datetime) -> bool:
        # Overlap: it starts before the slot ends AND ends after the slot starts.
        return any(start < slot_end and end > slot_start for start, end in ranges)

    def reason_for(slot_start: datetime, slot_end: datetime) -> SlotReason | None:
        # One reason per slot, in the order the customer can act on it: a gone
        # hour is gone whatever else is true; past the horizon nothing matters
        # (an operator's booking out there is not the customer's business);
        # then whose it is. A block never overlaps a live booking (A02).
        if slot_start < now:
            return "past"
        if slot_start > window_end:
            return "beyond_window"
        if overlaps(booked_ranges, slot_start, slot_end):
            return "booked"
        if overlaps(blocked_ranges, slot_start, slot_end):
            return "blocked"
        return None

    slots: list[AvailabilitySlot] = []
    for slot_start in sorted(slot_starts):
        slot_end = slot_start + timedelta(hours=1)
        reason = reason_for(slot_start, slot_end)
        slots.append(
            AvailabilitySlot(
                start=slot_start, end=slot_end, available=reason is None, reason=reason
            )
        )

    return {"slots": [s.model_dump() for s in slots]}
