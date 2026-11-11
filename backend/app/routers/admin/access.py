"""Operator smart-lock access (L01): a customer's PIN status and the door.

The operator sees where a customer's PIN stands and can rotate, revoke or
re-activate it, and can open a space's door once. The operator never sees the
clear PIN (privacy); the customer sees it on their own dashboard. Every
action is audited; opening the door is throttled like the help form.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

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
from app.models.lock_event import AccessVerdict, LockEventRow
from app.models.organization import OrganizationMember
from app.models.space import Space
from app.models.user import User
from app.ratelimit import SUPPORT_TIER, rate_limit
from app.schemas.access import (
    AccessDeviceOut,
    AccessReportOut,
    AdminAccessOut,
    BookingAccessOut,
    VerdictRowOut,
)

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


# ─── L02: the trail ──────────────────────────────────────────────────────────


def _week_bounds(week: str | None) -> tuple[datetime, datetime]:
    """Monday 00:00 to the next Monday, UTC. `week` is any ISO date in the
    week (YYYY-MM-DD); absent = the current week."""
    anchor = date.fromisoformat(week) if week else datetime.now(tz=UTC).date()
    monday = anchor - timedelta(days=anchor.weekday())
    start = datetime(monday.year, monday.month, monday.day, tzinfo=UTC)
    return start, start + timedelta(days=7)


@router.get("/access/report")
async def admin_access_report(
    org_id: uuid.UUID = Query(...),
    week: str | None = Query(None),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """A week of access verdicts (anomalies stand out) with per-verdict counts."""
    start, end = _week_bounds(week)
    rows = (
        await db.execute(
            select(AccessVerdict, LockEventRow, User)
            .join(LockEventRow, LockEventRow.id == AccessVerdict.lock_event_id)
            .outerjoin(User, User.id == LockEventRow.user_id)
            .where(
                AccessVerdict.org_id == org_id,
                LockEventRow.occurred_at >= start,
                LockEventRow.occurred_at < end,
            )
            .order_by(LockEventRow.occurred_at.desc())
        )
    ).all()
    verdicts = [
        VerdictRowOut(
            verdict=v.verdict,
            delta_minutes=v.delta_minutes,
            entered_at=e.occurred_at,
            departure_estimate_at=v.departure_estimate_at,
            departure_confidence=v.departure_confidence,
            device_id=e.device_id,
            booking_id=v.booking_id,
            customer_name=u.name if u else None,
            customer_email=u.email if u else None,
        )
        for v, e, u in rows
    ]
    counts: dict[str, int] = {}
    for v in verdicts:
        counts[v.verdict] = counts.get(v.verdict, 0) + 1
    return {
        "report": AccessReportOut(week_start=start, week_end=end, counts=counts, verdicts=verdicts)
    }


@router.get("/bookings/{booking_id}/access")
async def admin_booking_access(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The access verdict for one booking (operator booking view)."""
    row = (
        await db.execute(
            select(AccessVerdict, LockEventRow)
            .join(LockEventRow, LockEventRow.id == AccessVerdict.lock_event_id)
            .where(AccessVerdict.org_id == org_id, AccessVerdict.booking_id == booking_id)
            .order_by(LockEventRow.occurred_at)
            .limit(1)
        )
    ).first()
    if row is None:
        return {"access": BookingAccessOut()}
    verdict, event = row
    return {
        "access": BookingAccessOut(
            verdict=verdict.verdict,
            entered_at=event.occurred_at,
            departure_estimate_at=verdict.departure_estimate_at,
            departure_confidence=verdict.departure_confidence,
        )
    }
