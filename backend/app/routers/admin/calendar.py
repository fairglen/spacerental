"""The operator calendar's one read (P1.4).

The page used to ask for the bookings and then, once per visible room, the
blocks — six requests for a day with three rooms. One request now answers
with everything that touches the range, for every room of the organisation
(or of one space), and the page keeps filtering by room and status itself.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_admin
from app.database import get_db
from app.locks import LockGateway, attach_access_codes, get_lock_gateway
from app.models.booking import Booking
from app.models.room_block import RoomBlock
from app.models.space import Room
from app.models.user import User
from app.schemas.booking import AdminBookingOut
from app.schemas.room_block import RoomBlockOut

from ._common import _WITH_DEBITS

router = APIRouter(tags=["admin"])

# Two weeks: the week view, with room to spare; never a quarter in one go.
MAX_CALENDAR_DAYS = 14


@router.get("/calendar")
async def admin_calendar(
    org_id: uuid.UUID = Query(...),
    from_time: AwareDatetime = Query(..., alias="from"),
    to_time: AwareDatetime = Query(..., alias="to"),
    space_id: uuid.UUID | None = Query(None, description="Only this space's rooms."),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Every booking (any status) and every block of the organisation's rooms
    that overlaps `[from, to)`, each in time order — `{bookings, blocks}`."""
    if to_time <= from_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="to must follow from")
    if to_time - from_time > timedelta(days=MAX_CALENDAR_DAYS):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"a calendar range covers at most {MAX_CALENDAR_DAYS} days",
        )

    room_ids = select(Room.id).where(Room.org_id == org_id)
    if space_id is not None:
        room_ids = room_ids.where(Room.space_id == space_id)

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room), selectinload(Booking.user), _WITH_DEBITS)
        .where(
            Booking.org_id == org_id,
            Booking.room_id.in_(room_ids),
            Booking.start_time < to_time,
            Booking.end_time > from_time,
        )
        .order_by(Booking.start_time, Booking.id)
    )
    bookings = result.scalars().all()
    attach_access_codes(lock_gateway, bookings)

    blocks = (
        (
            await db.execute(
                select(RoomBlock)
                .where(
                    RoomBlock.org_id == org_id,
                    RoomBlock.room_id.in_(room_ids),
                    RoomBlock.start_time < to_time,
                    RoomBlock.end_time > from_time,
                )
                .order_by(RoomBlock.start_time, RoomBlock.id)
            )
        )
        .scalars()
        .all()
    )
    return {
        "bookings": [AdminBookingOut.model_validate(b) for b in bookings],
        "blocks": [RoomBlockOut.model_validate(b) for b in blocks],
    }
