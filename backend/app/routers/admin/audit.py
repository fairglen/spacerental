"""The audit trail (G01, O05): the organisation's rows and each entity's history."""

import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import require_admin
from app.database import get_db
from app.models.audit import AdminAction
from app.models.booking import Booking
from app.models.organization import OrganizationMember
from app.models.package import Package, UserPackagePurchase
from app.models.space import Room, Space
from app.models.support import SupportRequest
from app.models.user import User
from app.schemas.audit import AdminActionOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-audit"])

EntityType = Literal[
    "space",
    "room",
    "availability_rule",
    "room_block",
    "booking",
    "user",
    "package",
    "purchase",
    "support_request",
    "organization",
]


async def _page(db: AsyncSession, where: list, page: int, page_size: int) -> dict:
    total = await db.scalar(select(func.count()).select_from(AdminAction).where(*where))
    result = await db.execute(
        select(AdminAction)
        .options(selectinload(AdminAction.actor))
        .where(*where)
        .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "actions": [AdminActionOut.model_validate(a) for a in result.scalars().all()],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/audit")
async def admin_list_audit(
    org_id: uuid.UUID = Query(...),
    entity_type: EntityType | None = Query(default=None),
    entity_id: uuid.UUID | None = Query(default=None),
    actor: uuid.UUID | None = Query(default=None),
    # Aware instants only: `created_at` is TIMESTAMPTZ and a naive value would
    # reach asyncpg as one it cannot compare (a 500 instead of a 422).
    from_time: AwareDatetime | None = Query(default=None, alias="from"),
    to_time: AwareDatetime | None = Query(default=None, alias="to"),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    where = [AdminAction.org_id == org_id]
    if entity_type is not None:
        where.append(AdminAction.entity_type == entity_type)
    if entity_id is not None:
        where.append(AdminAction.entity_id == entity_id)
    if actor is not None:
        where.append(AdminAction.actor_user_id == actor)
    if from_time is not None:
        where.append(AdminAction.created_at >= from_time)
    if to_time is not None:
        where.append(AdminAction.created_at <= to_time)
    return await _page(db, where, page, page_size)


async def _history(
    db: AsyncSession, org_id: uuid.UUID, entity_type: str, entity_id: uuid.UUID, page, page_size
) -> dict:
    where = [
        AdminAction.org_id == org_id,
        AdminAction.entity_type == entity_type,
        AdminAction.entity_id == entity_id,
    ]
    return await _page(db, where, page, page_size)


async def _in_org(db: AsyncSession, model, entity_id: uuid.UUID, org_id: uuid.UUID) -> None:
    found = await db.scalar(
        select(func.count()).select_from(model).where(model.id == entity_id, model.org_id == org_id)
    )
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"{model.__name__} not found"
        )


@router.get("/spaces/{space_id}/history")
async def space_history(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, Space, space_id, org_id)
    return await _history(db, org_id, "space", space_id, page, page_size)


@router.get("/rooms/{room_id}/history")
async def room_history(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, Room, room_id, org_id)
    return await _history(db, org_id, "room", room_id, page, page_size)


@router.get("/bookings/{booking_id}/history")
async def booking_history(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, Booking, booking_id, org_id)
    return await _history(db, org_id, "booking", booking_id, page, page_size)


@router.get("/users/{user_id}/history")
async def user_history(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # A person is "in" the org through their membership row — or, once
    # anonymised or removed, through the trail itself, which is what the
    # operator most needs to read then.
    member = await db.scalar(
        select(func.count())
        .select_from(OrganizationMember)
        .where(OrganizationMember.user_id == user_id, OrganizationMember.org_id == org_id)
    )
    audited = await db.scalar(
        select(func.count())
        .select_from(AdminAction)
        .where(
            AdminAction.org_id == org_id,
            AdminAction.entity_type == "user",
            AdminAction.entity_id == user_id,
        )
    )
    if not member and not audited:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return await _history(db, org_id, "user", user_id, page, page_size)


@router.get("/packages/{package_id}/history")
async def package_history(
    package_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, Package, package_id, org_id)
    return await _history(db, org_id, "package", package_id, page, page_size)


@router.get("/purchases/{purchase_id}/history")
async def purchase_history(
    purchase_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, UserPackagePurchase, purchase_id, org_id)
    return await _history(db, org_id, "purchase", purchase_id, page, page_size)


@router.get("/support/requests/{request_id}/history")
async def support_request_history(
    request_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _in_org(db, SupportRequest, request_id, org_id)
    return await _history(db, org_id, "support_request", request_id, page, page_size)
