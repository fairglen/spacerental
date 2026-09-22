"""Operator photo management for rooms and spaces (C14).

One set of handlers serves both entities: the rules (content validation,
limits, processing, ordering, tenancy) must never drift apart between them.
Every handler finds the entity INSIDE the caller's organisation first and
answers 404 otherwise, exactly as it does for an id that does not exist, so
nothing about another tenant can be learned from here.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app import media
from app.auth import require_admin
from app.database import get_db
from app.media import MediaStorage, get_media_storage
from app.models.space import Room, Space
from app.models.user import User
from app.ratelimit import UPLOAD_TIER, rate_limit
from app.schemas.space import PhotoOrder, RoomOut, SpaceOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin-media"])

_READ_CHUNK = 1024 * 1024


async def _read_capped(file: UploadFile) -> bytes:
    """The upload's bytes, or 413 as soon as it is known to be too large.

    Read in chunks against the cap instead of trusting Content-Length (absent
    or wrong at the client's whim) or reading an unbounded body into memory.
    """
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(_READ_CHUNK):
        size += len(chunk)
        if size > media.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Image is larger than 8 MB",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _entity(db: AsyncSession, model, entity_id: uuid.UUID, org_id: uuid.UUID):
    # FOR UPDATE: `photos` is read, changed and written back as one list, and
    # two uploads in flight would otherwise each overwrite the other's photo.
    result = await db.execute(
        select(model)
        .where(model.id == entity_id, model.org_id == org_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    entity = result.scalar_one_or_none()
    if entity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"{model.__name__} not found"
        )
    return entity


async def _add_photo(
    db: AsyncSession, storage: MediaStorage, entity, kind: str, file: UploadFile
) -> None:
    if len(entity.photos) >= media.MAX_PHOTOS_PER_ENTITY:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"At most {media.MAX_PHOTOS_PER_ENTITY} photos; delete one first",
        )
    data = await _read_capped(file)
    try:
        # Decoding and re-encoding is CPU-bound; keep it off the event loop.
        processed = await run_in_threadpool(media.process_image, data)
    except media.ImageTooLargeError:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image is too large"
        ) from None
    except media.UnsupportedImageError:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only JPEG, PNG and WebP images are accepted",
        ) from None

    photo_id, key, thumb_key = media.new_photo_keys(kind, entity.id)
    await storage.save(key, processed.main)
    await storage.save(thumb_key, processed.thumb)
    entity.photos = [
        *entity.photos,
        {
            "id": photo_id,
            "key": key,
            "thumb_key": thumb_key,
            "width": processed.width,
            "height": processed.height,
        },
    ]
    try:
        await db.flush()
    except Exception:
        # The row did not take the photo, so its files would be orphans.
        await storage.delete(key)
        await storage.delete(thumb_key)
        raise


async def _remove_photo(
    db: AsyncSession, storage: MediaStorage, entity, image_id: uuid.UUID
) -> None:
    doomed = next((p for p in entity.photos if p["id"] == str(image_id)), None)
    if doomed is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    entity.photos = [p for p in entity.photos if p is not doomed]
    await db.flush()
    # After the row no longer points at them. A photo carried over from an
    # external `images` URL has no keys: there is nothing of ours to delete.
    for key in (doomed.get("key"), doomed.get("thumb_key")):
        if key:
            try:
                await storage.delete(key)
            except OSError:
                logger.exception("Could not delete media file %s", key)


async def _reorder(db: AsyncSession, entity, order: list[uuid.UUID]) -> None:
    by_id = {p["id"]: p for p in entity.photos}
    wanted = [str(i) for i in order]
    # A permutation of what is there now, nothing else: a stale list (someone
    # added or removed a photo meanwhile) must not silently drop or revive one.
    if len(wanted) != len(by_id) or set(wanted) != set(by_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The order must list every current photo exactly once",
        )
    entity.photos = [by_id[i] for i in wanted]
    await db.flush()


def _room_out(room: Room) -> dict:
    return {"room": RoomOut.model_validate(room)}


def _space_out(space: Space) -> dict:
    # `rooms` is a noload relationship; this response is about the space itself.
    return {"space": SpaceOut.model_validate(space)}


@router.post("/rooms/{room_id}/images", status_code=status.HTTP_201_CREATED)
@rate_limit(UPLOAD_TIER)
async def upload_room_image(
    room_id: uuid.UUID,
    file: UploadFile,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    room = await _entity(db, Room, room_id, org_id)
    await _add_photo(db, storage, room, "rooms", file)
    await db.refresh(room)
    return _room_out(room)


@router.post("/spaces/{space_id}/images", status_code=status.HTTP_201_CREATED)
@rate_limit(UPLOAD_TIER)
async def upload_space_image(
    space_id: uuid.UUID,
    file: UploadFile,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    space = await _entity(db, Space, space_id, org_id)
    await _add_photo(db, storage, space, "spaces", file)
    await db.refresh(space)
    return _space_out(space)


# `/order` is declared before `/{image_id}` so it is never read as an image id.
@router.put("/rooms/{room_id}/images/order")
async def reorder_room_images(
    room_id: uuid.UUID,
    body: PhotoOrder,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    room = await _entity(db, Room, room_id, org_id)
    await _reorder(db, room, body.order)
    await db.refresh(room)
    return _room_out(room)


@router.put("/spaces/{space_id}/images/order")
async def reorder_space_images(
    space_id: uuid.UUID,
    body: PhotoOrder,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    space = await _entity(db, Space, space_id, org_id)
    await _reorder(db, space, body.order)
    await db.refresh(space)
    return _space_out(space)


# 200 with the updated entity rather than 204: the client needs the new list
# (and the new cover) and should not have to ask for it again.
@router.delete("/rooms/{room_id}/images/{image_id}")
async def delete_room_image(
    room_id: uuid.UUID,
    image_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    room = await _entity(db, Room, room_id, org_id)
    await _remove_photo(db, storage, room, image_id)
    await db.refresh(room)
    return _room_out(room)


@router.delete("/spaces/{space_id}/images/{image_id}")
async def delete_space_image(
    space_id: uuid.UUID,
    image_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    storage: MediaStorage = Depends(get_media_storage),
):
    space = await _entity(db, Space, space_id, org_id)
    await _remove_photo(db, storage, space, image_id)
    await db.refresh(space)
    return _space_out(space)
