"""Operator smart-lock access (L01): a customer's PIN status and the door.

The operator sees where a customer's PIN stands and can rotate, revoke or
re-activate it, and can open a space's door once. The operator never sees the
clear PIN (privacy); the customer sees it on their own dashboard. Every
action is audited; opening the door is throttled like the help form.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import access as access_service
from app import audit
from app.auth import require_admin
from app.database import get_db
from app.locks import LockGateway, LockProviderError, device_id_for_space, get_lock_gateway
from app.models.customer_access import CustomerAccess
from app.models.organization import OrganizationMember
from app.models.space import Space
from app.models.user import User
from app.ratelimit import SUPPORT_TIER, rate_limit
from app.schemas.access import AccessDeviceOut, AdminAccessOut

router = APIRouter(tags=["admin"])


async def _require_member(db: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID) -> None:
    exists = await db.scalar(
        select(OrganizationMember.user_id).where(
            OrganizationMember.user_id == user_id, OrganizationMember.org_id == org_id
        )
    )
    if exists is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")


async def _load(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> CustomerAccess | None:
    return (
        await db.execute(
            select(CustomerAccess)
            .options(selectinload(CustomerAccess.devices))
            .where(CustomerAccess.org_id == org_id, CustomerAccess.user_id == user_id)
        )
    ).scalar_one_or_none()


def _admin_view(access: CustomerAccess | None) -> AdminAccessOut:
    if access is None:
        return AdminAccessOut(status=None, devices=[])
    return AdminAccessOut(
        status=access.status,
        created_at=access.created_at,
        rotated_at=access.rotated_at,
        last_used_at=access.last_used_at,
        devices=[
            AccessDeviceOut(
                device_id=d.device_id,
                sync_status=d.sync_status,
                synced_at=d.synced_at,
                last_error=d.last_error,
            )
            for d in access.devices
        ],
    )


@router.get("/users/{user_id}/access")
async def admin_get_access(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """A customer's PIN status and per-lock sync (never the clear PIN)."""
    await _require_member(db, user_id, org_id)
    return {"access": _admin_view(await _load(db, org_id, user_id))}


@router.post("/users/{user_id}/access/rotate")
async def admin_rotate_access(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Give the customer a fresh PIN. The operator is not shown the new code;
    the customer sees it on their dashboard."""
    await _require_member(db, user_id, org_id)
    access = await _load(db, org_id, user_id)
    if access is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No access to rotate")
    await access_service.rotate_pin(db, access, actor=admin)
    await db.commit()
    await db.refresh(access)
    return {"access": _admin_view(await _load(db, org_id, user_id))}


@router.post("/users/{user_id}/access/revoke")
async def admin_revoke_access(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Take the customer off every lock. The PIN is kept so re-activation
    restores the same code."""
    await _require_member(db, user_id, org_id)
    access = await _load(db, org_id, user_id)
    if access is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No access to revoke")
    await access_service.revoke_access(db, access, actor=admin)
    await db.commit()
    return {"access": _admin_view(await _load(db, org_id, user_id))}


@router.post("/users/{user_id}/access/reactivate")
async def admin_reactivate_access(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Put a dormant or revoked customer back on the lock with their PIN."""
    await _require_member(db, user_id, org_id)
    access = await _load(db, org_id, user_id)
    if access is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No access to re-activate"
        )
    await access_service.reactivate_access(db, access, actor=admin)
    await db.commit()
    return {"access": _admin_view(await _load(db, org_id, user_id))}


@rate_limit(SUPPORT_TIER)
@router.post("/spaces/{space_id}/open-door")
async def admin_open_door(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Open the space's door once (operator action, audited)."""
    space = await db.scalar(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")
    device_id = device_id_for_space(space_id)
    if device_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="This space has no lock configured"
        )
    try:
        await lock_gateway.open_now(device_id)
    except LockProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="The lock did not accept the command"
        ) from exc
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=space,
        action="access.open_door",
        after={"device_id": device_id},
    )
    await db.commit()
    return {"opened": True}
