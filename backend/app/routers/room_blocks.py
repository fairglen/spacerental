"""Blocked time (A02): CRUD under /admin/rooms/{id}/blocks.

A block may not overlap a booking that holds its slot: the operator moves or
cancels the booking first, and the refusal names it. Nothing is ever
overridden silently.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.auth import require_admin
from app.booking_validity import (
    MAX_BLOCK_DURATION,
    expire_stale_holds,
    holds_slot,
    is_lost_slot_race,
)
from app.database import get_db
from app.models.booking import Booking
from app.models.room_block import RoomBlock
from app.models.space import Room
from app.models.user import User
from app.schemas.room_block import (
    BlockedBookingOut,
    RoomBlockCreate,
    RoomBlockOut,
    RoomBlockUpdate,
)

router = APIRouter(prefix="/admin/rooms/{room_id}/blocks", tags=["admin-blocks"])


async def _room(db: AsyncSession, room_id: uuid.UUID, org_id: uuid.UUID) -> Room:
    room = await db.scalar(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    return room


async def _block(db: AsyncSession, room: Room, block_id: uuid.UUID) -> RoomBlock:
    block = await db.scalar(
        select(RoomBlock)
        .where(
            RoomBlock.id == block_id, RoomBlock.room_id == room.id, RoomBlock.org_id == room.org_id
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if block is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Block not found")
    return block


def _validate(start: datetime, end: datetime, now: datetime) -> None:
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be after start_time"
        )
    # A block may have started already ("out of service since this morning")
    # but recording one that is entirely over is a mistake, not a block.
    if end <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="The block is entirely in the past"
        )
    if end - start > MAX_BLOCK_DURATION:
        days = MAX_BLOCK_DURATION.days
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A block cannot be longer than {days} days; create several",
        )


async def _refuse_if_bookings_hold_the_slot(
    db: AsyncSession, room_id: uuid.UUID, start: datetime, end: datetime, now: datetime
) -> None:
    await expire_stale_holds(db, room_id, start, end, now)
    result = await db.execute(
        select(Booking)
        .where(
            and_(
                Booking.room_id == room_id,
                holds_slot(now),
                Booking.start_time < end,
                Booking.end_time > start,
            )
        )
        .order_by(Booking.start_time)
    )
    conflicts = result.scalars().all()
    if conflicts:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "Bookings hold this time; move or cancel them first",
                "conflicts": [
                    BlockedBookingOut.model_validate(b).model_dump(mode="json") for b in conflicts
                ],
            },
        )


def _lost_race() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Another block already covers part of this time",
    )


@router.get("")
async def list_blocks(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    from_time: datetime | None = Query(None, alias="from"),
    to_time: datetime | None = Query(None, alias="to"),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    room = await _room(db, room_id, org_id)
    conditions = [RoomBlock.room_id == room.id]
    if from_time is not None:
        conditions.append(RoomBlock.end_time > from_time)
    if to_time is not None:
        conditions.append(RoomBlock.start_time < to_time)
    result = await db.execute(
        select(RoomBlock).where(and_(*conditions)).order_by(RoomBlock.start_time)
    )
    return {"blocks": [RoomBlockOut.model_validate(b) for b in result.scalars().all()]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_block(
    room_id: uuid.UUID,
    body: RoomBlockCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    room = await _room(db, room_id, org_id)
    now = clock.utcnow()
    _validate(body.start_time, body.end_time, now)
    await _refuse_if_bookings_hold_the_slot(db, room.id, body.start_time, body.end_time, now)
    block = RoomBlock(
        org_id=room.org_id,
        room_id=room.id,
        start_time=body.start_time,
        end_time=body.end_time,
        reason=body.reason,
        created_by=admin.id,
    )
    db.add(block)
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise _lost_race() from None
    await db.refresh(block)
    return {"block": RoomBlockOut.model_validate(block)}


@router.put("/{block_id}")
async def update_block(
    room_id: uuid.UUID,
    block_id: uuid.UUID,
    body: RoomBlockUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    room = await _room(db, room_id, org_id)
    block = await _block(db, room, block_id)
    now = clock.utcnow()
    start = body.start_time or block.start_time
    end = body.end_time or block.end_time
    if body.start_time is not None or body.end_time is not None:
        _validate(start, end, now)
        await _refuse_if_bookings_hold_the_slot(db, room.id, start, end, now)
    block.start_time = start
    block.end_time = end
    if body.reason is not None:
        block.reason = body.reason
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise _lost_race() from None
    await db.refresh(block)
    return {"block": RoomBlockOut.model_validate(block)}


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(
    room_id: uuid.UUID,
    block_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    room = await _room(db, room_id, org_id)
    block = await _block(db, room, block_id)
    await db.delete(block)
    await db.flush()
