"""Customer smart-lock access service (L01): the durable bookkeeping the
routers and the reconciliation pass share.

The confirm paths call `try_ensure_customer_access` on a first confirmed
booking; it only touches the database (a PIN row and a `pending` device
row), so a lock outage never fails a payment. The pass
(`reconcile_customer_access`, driven by app/holds.py under the N01 advisory
lock) does the actual Nuki work: issue pending PINs, delete revoke_pending
ones, take dormant customers off the lock, and retry with backoff. The clear
PIN exists only in memory here; the column is always encrypted.
"""

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock
from app.config import settings
from app.locks import (
    LockGateway,
    LockProviderError,
    customer_ref,
    decrypt_pin,
    device_id_for_space,
    encrypt_pin,
    generate_pin,
)
from app.models.booking import Booking
from app.models.customer_access import (
    ACCESS_ACTIVE,
    ACCESS_DORMANT,
    ACCESS_REVOKED,
    SYNC_FAILED,
    SYNC_PENDING,
    SYNC_REVOKE_PENDING,
    SYNC_SYNCED,
    CustomerAccess,
    CustomerAccessDevice,
)

logger = logging.getLogger("app.access")

# How many failed regenerations before a device is parked `failed` (a new
# booking or a rotate resets it). Transient provider errors keep it `pending`.
MAX_REGEN_ATTEMPTS = 5
# A tick processes at most this many device rows, so one slow lock cannot
# stall the whole sweep.
PASS_DEVICE_BATCH = 100


async def _org_pins(
    db: AsyncSession, org_id: uuid.UUID, *, exclude_id: uuid.UUID | None = None
) -> set[str]:
    """Every customer's current clear PIN in the org, to keep a new one
    unique on any shared keypad (stronger than Nuki's per-keypad rule; see
    the L01 DECISION)."""
    rows = (
        await db.execute(
            select(CustomerAccess.id, CustomerAccess.pin_encrypted).where(
                CustomerAccess.org_id == org_id, CustomerAccess.status != ACCESS_REVOKED
            )
        )
    ).all()
    pins = set()
    for row_id, token in rows:
        if exclude_id is not None and row_id == exclude_id:
            continue
        try:
            pins.add(decrypt_pin(token))
        except LockProviderError:
            continue
    return pins


async def _new_unique_pin(
    db: AsyncSession, org_id: uuid.UUID, *, exclude_id: uuid.UUID | None = None
) -> str:
    return generate_pin(await _org_pins(db, org_id, exclude_id=exclude_id))


async def _get_access(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID
) -> CustomerAccess | None:
    return (
        await db.execute(
            select(CustomerAccess)
            .options(selectinload(CustomerAccess.devices))
            .where(CustomerAccess.org_id == org_id, CustomerAccess.user_id == user_id)
        )
    ).scalar_one_or_none()


async def ensure_customer_access(
    db: AsyncSession, *, user_id: uuid.UUID, org_id: uuid.UUID, space_id: uuid.UUID
) -> CustomerAccess | None:
    """On a confirmed booking: make sure the customer has a PIN and a device
    row for this space's lock, both ready for the pass. A space with no lock
    configured is a silent no-op. Does no network I/O."""
    device_id = device_id_for_space(space_id)
    if device_id is None:
        return None

    access = await _get_access(db, org_id, user_id)
    if access is None:
        # A new customer: one PIN and one pending device. Never read the
        # freshly-flushed `devices` relationship — that would fire an async
        # lazy-load in a sync context (MissingGreenlet).
        pin = await _new_unique_pin(db, org_id)
        access = CustomerAccess(
            org_id=org_id, user_id=user_id, pin_encrypted=encrypt_pin(pin), status=ACCESS_ACTIVE
        )
        db.add(access)
        await db.flush()
        db.add(
            CustomerAccessDevice(
                org_id=org_id,
                customer_access_id=access.id,
                device_id=device_id,
                sync_status=SYNC_PENDING,
            )
        )
        return access

    # Existing customer: `devices` is eagerly loaded by `_get_access`.
    if access.status != ACCESS_ACTIVE:
        # Re-activation: a dormant or revoked customer booked again.
        access.status = ACCESS_ACTIVE
        for device in access.devices:
            if device.sync_status in (SYNC_REVOKE_PENDING, SYNC_FAILED):
                _mark_pending(device)

    device = next((d for d in access.devices if d.device_id == device_id), None)
    if device is None:
        device = CustomerAccessDevice(
            org_id=org_id,
            customer_access_id=access.id,
            device_id=device_id,
            sync_status=SYNC_PENDING,
        )
        db.add(device)
        access.devices.append(device)
    elif device.sync_status in (SYNC_REVOKE_PENDING, SYNC_FAILED):
        _mark_pending(device)
    return access


async def try_ensure_customer_access(
    db: AsyncSession, *, user_id: uuid.UUID, org_id: uuid.UUID, space_id: uuid.UUID
) -> None:
    """Best-effort wrapper for the confirm paths: a bug or a full keypad must
    never turn a confirmed booking into a 500. The work is isolated in a
    SAVEPOINT so a failure here leaves the booking's own changes intact."""
    try:
        async with db.begin_nested():
            await ensure_customer_access(
                db, user_id=user_id, org_id=org_id, space_id=space_id
            )
    except Exception:
        logger.exception(
            "Could not prepare smart-lock access for user %s / space %s", user_id, space_id
        )


def _mark_pending(device: CustomerAccessDevice) -> None:
    device.sync_status = SYNC_PENDING
    device.attempts = 0
    device.last_error = None


# ─── Customer and admin actions ─────────────────────────────────────────────


async def rotate_pin(
    db: AsyncSession, access: CustomerAccess, *, actor=None
) -> str:
    """Give the customer a fresh PIN; every device re-issues (the pass deletes
    the old authorisation first, keeping its id until the delete succeeds).
    Returns the new clear PIN."""
    new_pin = await _new_unique_pin(db, access.org_id, exclude_id=access.id)
    access.pin_encrypted = encrypt_pin(new_pin)
    access.rotated_at = clock.utcnow()
    if access.status != ACCESS_ACTIVE:
        access.status = ACCESS_ACTIVE
    for device in access.devices:
        if device.sync_status != SYNC_REVOKE_PENDING:
            # Keep nuki_auth_id: the pass removes the old code before the new.
            device.sync_status = SYNC_PENDING
            device.attempts = 0
            device.last_error = None
    await audit.record(
        db, actor=actor, org_id=access.org_id, entity=access, action="access.rotate",
        before={"status": access.status}, after={"status": access.status},
    )
    return new_pin


async def revoke_access(db: AsyncSession, access: CustomerAccess, *, actor=None) -> None:
    """Take the customer off every lock (the pass deletes the authorisations)
    and mark the access revoked. The PIN is kept so a re-activation restores
    the same code."""
    access.status = ACCESS_REVOKED
    for device in access.devices:
        device.sync_status = SYNC_REVOKE_PENDING
    await audit.record(
        db, actor=actor, org_id=access.org_id, entity=access, action="access.revoke",
        after={"status": ACCESS_REVOKED},
    )


async def reactivate_access(db: AsyncSession, access: CustomerAccess, *, actor=None) -> None:
    """Put a dormant or revoked customer back on the lock with their existing
    PIN."""
    access.status = ACCESS_ACTIVE
    for device in access.devices:
        _mark_pending(device)
    await audit.record(
        db, actor=actor, org_id=access.org_id, entity=access, action="access.reactivate",
        after={"status": ACCESS_ACTIVE},
    )


async def revoke_for_anonymisation(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """GDPR delete: mark the customer's access revoked and every device
    `revoke_pending` so the pass deletes the codes. Never waits on the lock —
    the anonymisation commits immediately and the pass finishes the removal."""
    access = await _get_access(db, org_id, user_id)
    if access is None:
        return
    access.status = ACCESS_REVOKED
    for device in access.devices:
        device.sync_status = SYNC_REVOKE_PENDING


# ─── The reconciliation pass ────────────────────────────────────────────────


@dataclass
class PassResult:
    issued: int = 0
    revoked: int = 0
    dormant: int = 0
    failures: int = 0


async def reconcile_customer_access(
    db: AsyncSession, gateway: LockGateway, now: datetime
) -> PassResult:
    """One reconciliation tick, inside the sweep's locked transaction: push
    pending PINs, delete revoke_pending ones, and send idle customers dormant.
    Provider errors are caught per device (attempts, last_error) so one lock
    never blocks the rest."""
    result = PassResult()
    await _sweep_dormancy(db, now, result)

    devices = (
        (
            await db.execute(
                select(CustomerAccessDevice)
                .options(selectinload(CustomerAccessDevice.access))
                .where(CustomerAccessDevice.sync_status.in_([SYNC_PENDING, SYNC_REVOKE_PENDING]))
                .order_by(CustomerAccessDevice.created_at)
                .limit(PASS_DEVICE_BATCH)
            )
        )
        .scalars()
        .all()
    )
    for device in devices:
        try:
            if device.sync_status == SYNC_REVOKE_PENDING:
                await _reconcile_revoke(db, gateway, device, result)
            else:
                await _reconcile_issue(db, gateway, device, now, result)
        except LockProviderError as exc:
            device.attempts += 1
            device.last_error = str(exc)[:500]
            result.failures += 1
            logger.warning(
                "lock reconcile: device %s (%s) failed attempt %d",
                device.device_id, device.sync_status, device.attempts,
            )
    return result


async def _reconcile_issue(
    db: AsyncSession,
    gateway: LockGateway,
    device: CustomerAccessDevice,
    now: datetime,
    result: PassResult,
) -> None:
    access = device.access
    if access is None or access.status != ACCESS_ACTIVE:
        # The customer went dormant/revoked between selection and now.
        device.sync_status = SYNC_REVOKE_PENDING
        return
    ref = customer_ref(access.user_id)
    pin = decrypt_pin(access.pin_encrypted)
    # A rotate leaves the old authorisation id in place; remove it first, and
    # only drop the id once the lock confirms (never orphan a code).
    if device.nuki_auth_id is not None:
        await gateway.revoke(device.device_id, device.nuki_auth_id)
        device.nuki_auth_id = None
    try:
        auth_id = await gateway.issue_for_customer(ref, device.device_id, pin)
    except LockProviderError as exc:
        if _is_code_in_use(exc):
            await _regenerate_and_retry(db, gateway, device, access, now, result)
            return
        raise
    device.nuki_auth_id = auth_id
    device.sync_status = SYNC_SYNCED
    device.synced_at = now
    device.attempts = 0
    device.last_error = None
    result.issued += 1
    await audit.record(
        db, actor=None, org_id=access.org_id, entity=access, action="access.issue",
        after={"status": access.status, "device_id": device.device_id},
    )


async def _reconcile_revoke(
    db: AsyncSession, gateway: LockGateway, device: CustomerAccessDevice, result: PassResult
) -> None:
    if device.nuki_auth_id is not None:
        await gateway.revoke(device.device_id, device.nuki_auth_id)
        device.nuki_auth_id = None
    access = device.access
    await db.delete(device)
    result.revoked += 1
    if access is not None:
        await audit.record(
            db, actor=None, org_id=access.org_id, entity=access, action="access.revoke_device",
            after={"device_id": device.device_id},
        )


async def _regenerate_and_retry(
    db: AsyncSession,
    gateway: LockGateway,
    device: CustomerAccessDevice,
    access: CustomerAccess,
    now: datetime,
    result: PassResult,
) -> None:
    """Nuki said the code is already used on that keypad: give the customer a
    new org-unique PIN and try again, up to MAX_REGEN_ATTEMPTS."""
    for _ in range(MAX_REGEN_ATTEMPTS):
        new_pin = await _new_unique_pin(db, access.org_id, exclude_id=access.id)
        access.pin_encrypted = encrypt_pin(new_pin)
        try:
            auth_id = await gateway.issue_for_customer(
                customer_ref(access.user_id), device.device_id, new_pin
            )
        except LockProviderError as exc:
            if _is_code_in_use(exc):
                continue
            raise
        device.nuki_auth_id = auth_id
        device.sync_status = SYNC_SYNCED
        device.synced_at = now
        device.attempts = 0
        device.last_error = None
        result.issued += 1
        return
    device.sync_status = SYNC_FAILED
    device.last_error = "Could not place a unique PIN on the keypad after retries"
    result.failures += 1


def _is_code_in_use(exc: LockProviderError) -> bool:
    text = str(exc).lower()
    return "409" in text or "already" in text or "in use" in text or "conflict" in text


async def _sweep_dormancy(db: AsyncSession, now: datetime, result: PassResult) -> None:
    """Active customers whose most recent booking is older than
    ACCESS_DORMANCY_DAYS lose the lock slot (PIN kept)."""
    cutoff = now - timedelta(days=settings.ACCESS_DORMANCY_DAYS)
    accesses = (
        (
            await db.execute(
                select(CustomerAccess)
                .options(selectinload(CustomerAccess.devices))
                .where(CustomerAccess.status == ACCESS_ACTIVE)
            )
        )
        .scalars()
        .all()
    )
    for access in accesses:
        last = (
            await db.execute(
                select(func.max(Booking.start_time)).where(
                    Booking.org_id == access.org_id, Booking.user_id == access.user_id
                )
            )
        ).scalar_one_or_none()
        # Dormancy is about booking activity. A brand-new access with no
        # bookings yet gets a grace window from its own creation, so it is
        # never sent dormant before its first booking lands.
        reference = last if last is not None else access.created_at
        if reference >= cutoff:
            continue
        access.status = ACCESS_DORMANT
        for device in access.devices:
            if device.sync_status in (SYNC_SYNCED, SYNC_PENDING, SYNC_FAILED):
                device.sync_status = SYNC_REVOKE_PENDING
        result.dormant += 1
