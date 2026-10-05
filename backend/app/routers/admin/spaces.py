"""Spaces: list, create, one page, update, hard delete (G04)."""

import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, deletion
from app.auth import require_admin
from app.database import get_db
from app.media import MediaStorage, get_media_storage
from app.models.booking import Booking
from app.models.space import Room, Space
from app.models.user import User
from app.schemas.space import (
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

from ._common import _booking_counts, _delete_photo_files

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


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
        timezone=body.timezone,
    )
    db.add(space)
    await db.flush()
    await db.refresh(space)
    await audit.record(
        db, actor=admin, org_id=org_id, entity=space, action="create", after=audit.snapshot(space)
    )
    return {"space": SpaceOut.model_validate(space)}


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
    background_tasks: BackgroundTasks,
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
        .with_for_update(of=Space)
    )
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    deletion.require_confirm(confirm, space.id, space.name)
    # The rooms' rows too: a booking being inserted takes a KEY SHARE lock on
    # its room, which waits behind this, so no booking can slip in between
    # the count below and the cascade.
    await db.execute(select(Room.id).where(Room.space_id == space.id).with_for_update())
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
    background_tasks.add_task(_delete_photo_files, storage, photos)
