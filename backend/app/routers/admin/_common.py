"""What the admin modules share (Q50): the auth dependencies, the locked loaders and the small
helpers more than one entity page needs.
"""

import logging
import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock
from app.auth import require_admin, require_owner
from app.booking_validity import (
    holds_slot,
)
from app.media import MediaStorage
from app.models.booking import Booking
from app.models.package import BookingPackageDebit, UserPackagePurchase
from app.models.space import Room

logger = logging.getLogger(__name__)

__all__ = [
    "_WITH_DEBITS",
    "_booking_counts",
    "_delete_photo_files",
    "_locked_booking",
    "_room_in_org",
    "require_admin",
    "require_owner",
]

# The operator's split view (H02): which purchases a booking's pack hours
# came from. Loaded wherever an operator reads a booking, never for a customer.
_WITH_DEBITS = (
    selectinload(Booking.package_debits)
    .selectinload(BookingPackageDebit.purchase)
    .selectinload(UserPackagePurchase.package)
)


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


async def _delete_photo_files(storage: MediaStorage, photos: list[dict]) -> None:
    # Runs after the response, i.e. after the transaction committed: a commit
    # that fails leaves the rows and their files intact. A file that will not
    # go is logged, never raised — an orphan file is a nuisance, a dangling
    # row would be worse.
    for photo in photos:
        for key in (photo.get("key"), photo.get("thumb_key")):
            if key:
                try:
                    await storage.delete(key)
                except OSError:
                    logger.exception("Could not delete media file %s", key)


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
