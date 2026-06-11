import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.space import Space, Room, AvailabilityRule
from app.models.booking import Booking, BookingStatus
from app.schemas.space import SpaceOut, RoomOut, AvailabilitySlot

router = APIRouter(tags=["spaces"])


@router.get("/spaces")
async def list_spaces(db: AsyncSession = Depends(get_db)):
    """List all active spaces (public)."""
    result = await db.execute(
        select(Space).where(Space.is_active == True).order_by(Space.created_at.desc())  # noqa: E712
    )
    spaces = result.scalars().all()
    return {"spaces": [SpaceOut.model_validate(s) for s in spaces]}


@router.get("/spaces/{space_id}")
async def get_space(space_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Space detail with rooms (public)."""
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms))
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
async def get_room_availability(
    room_id: uuid.UUID,
    date: date = Query(..., description="Date in YYYY-MM-DD format"),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate 1-hour availability slots for a room on a given date.
    Returns array of {start, end, available}.
    """
    result = await db.execute(
        select(Room).where(Room.id == room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

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

    # Build 1-hour slots within each open/close window (multiple windows per day
    # are supported, e.g. morning + evening).
    slot_starts: list[datetime] = []
    windows: list[tuple[datetime, datetime]] = []
    for rule in rules:
        open_dt = datetime.combine(date, rule.open_time, tzinfo=timezone.utc)
        close_dt = datetime.combine(date, rule.close_time, tzinfo=timezone.utc)
        windows.append((open_dt, close_dt))
        current = open_dt
        while current + timedelta(hours=1) <= close_dt:
            slot_starts.append(current)
            current += timedelta(hours=1)

    if not slot_starts:
        return {"slots": []}

    day_start = min(w[0] for w in windows)
    day_end = max(w[1] for w in windows)

    # Fetch confirmed bookings for this room on this date
    result = await db.execute(
        select(Booking).where(
            and_(
                Booking.room_id == room_id,
                Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                Booking.start_time < day_end,
                Booking.end_time > day_start,
            )
        )
    )
    existing_bookings = result.scalars().all()

    def is_slot_taken(slot_start: datetime, slot_end: datetime) -> bool:
        for booking in existing_bookings:
            # Overlap: booking starts before slot ends AND booking ends after slot starts
            if booking.start_time < slot_end and booking.end_time > slot_start:
                return True
        return False

    slots: list[AvailabilitySlot] = []
    for slot_start in sorted(slot_starts):
        slot_end = slot_start + timedelta(hours=1)
        available = not is_slot_taken(slot_start, slot_end)
        slots.append(AvailabilitySlot(start=slot_start, end=slot_end, available=available))

    return {"slots": [s.model_dump() for s in slots]}
