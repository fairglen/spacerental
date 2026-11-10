"""The customer's own smart-lock PIN (L01): see it, rotate it.

One PIN per customer; it is shown only to the customer who owns it. Rotation
is throttled like authentication (a code is a credential).
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import access as access_service
from app.auth import get_current_user
from app.database import get_db
from app.locks import LockProviderError, decrypt_pin
from app.models.customer_access import ACCESS_REVOKED, CustomerAccess
from app.models.user import User
from app.ratelimit import AUTH_TIER, rate_limit
from app.schemas.access import CustomerDeviceOut, CustomerPinOut

router = APIRouter(tags=["access"])


async def _load_access(db: AsyncSession, user_id: uuid.UUID) -> CustomerAccess | None:
    """The customer's access row. If somehow in more than one organisation,
    the active one wins, else the most recent."""
    rows = (
        (
            await db.execute(
                select(CustomerAccess)
                .options(selectinload(CustomerAccess.devices))
                .where(CustomerAccess.user_id == user_id)
                .order_by(CustomerAccess.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return None
    active = [a for a in rows if a.status != ACCESS_REVOKED]
    return active[0] if active else rows[0]


def _customer_view(access: CustomerAccess | None) -> CustomerPinOut:
    if access is None:
        return CustomerPinOut(status="none", pin=None, devices=[])
    pin = None
    if access.status != ACCESS_REVOKED:
        try:
            pin = decrypt_pin(access.pin_encrypted)
        except LockProviderError:
            pin = None
    return CustomerPinOut(
        status=access.status,
        pin=pin,
        rotated_at=access.rotated_at,
        # The customer sees where their code stands, not the operator's error text.
        devices=[
            CustomerDeviceOut(
                device_id=d.device_id, sync_status=d.sync_status, synced_at=d.synced_at
            )
            for d in access.devices
        ],
    )


@router.get("/access/me")
async def get_my_access(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The customer's door PIN, its status, and per-lock sync."""
    access = await _load_access(db, user.id)
    return {"access": _customer_view(access)}


@rate_limit(AUTH_TIER)
@router.post("/access/me/rotate")
async def rotate_my_access(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Replace the customer's PIN with a fresh one; the old code is deleted
    from every lock by the pass."""
    access = await _load_access(db, user.id)
    if access is None or access.status == ACCESS_REVOKED:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No access code to rotate"
        )
    await access_service.rotate_pin(db, access, actor=user)
    await db.commit()
    await db.refresh(access)
    return {"access": _customer_view(access)}
