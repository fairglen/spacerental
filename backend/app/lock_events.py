"""The smart-lock audit trail (L02): poll the lock log, store each entry
once, attribute keypad entries to customers, and reconcile them into verdicts.

All of this runs in the same reconciliation pass as the PIN sync
(app/holds.py, under the N01 advisory lock). Ingestion is idempotent (insert
on the provider event id, ignore a duplicate); verdicts are computed once per
keypad entry and survive the raw event, which is pruned after
ACCESS_EVENT_RETENTION_DAYS. Nuki times are UTC; the operator UI shows Lisbon.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import email
from app.config import settings
from app.locks import (
    KIND_AUTO_LOCK,
    KIND_DOOR_CLOSE,
    KIND_KEYPAD_UNLOCK,
    KIND_LOCK,
    LockGateway,
    classify_action,
    spaces_for_device,
)
from app.models.booking import Booking, BookingStatus
from app.models.customer_access import CustomerAccess, CustomerAccessDevice
from app.models.lock_event import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_NONE,
    VERDICT_EARLY,
    VERDICT_LATE,
    VERDICT_NO_BOOKING,
    VERDICT_ON_TIME,
    VERDICT_OVERSTAY,
    AccessVerdict,
    LockEventRow,
)
from app.models.space import Room

logger = logging.getLogger("app.lock_events")

INGEST_BATCH = 500
# Door-closing kinds that can end a session for the departure estimate.
_CLOSE_KINDS = (KIND_DOOR_CLOSE, KIND_LOCK, KIND_AUTO_LOCK)


@dataclass
class TrailResult:
    ingested: int = 0
    judged: int = 0
    alerts: int = 0
    pruned: int = 0


async def ingest_and_judge(db: AsyncSession, gateway: LockGateway, now: datetime) -> TrailResult:
    """One trail tick: pull each mapped device's log, store new entries,
    reconcile keypad entries into verdicts, prune old raw events."""
    result = TrailResult()
    for org_id, device_id in await _device_pairs(db):
        await _ingest_device(db, gateway, org_id, device_id, now, result)
    await _reconcile_verdicts(db, now, result)
    result.pruned = await _prune(db, now)
    return result


async def _device_pairs(db: AsyncSession) -> list[tuple]:
    """(org_id, device_id) for every lock a customer has been on — the locks
    worth polling. A lock with no customer has nothing to attribute."""
    rows = await db.execute(
        select(CustomerAccessDevice.org_id, CustomerAccessDevice.device_id).distinct()
    )
    return list(rows.all())


async def _ingest_device(
    db: AsyncSession,
    gateway: LockGateway,
    org_id,
    device_id: str,
    now: datetime,
    result: TrailResult,
) -> None:
    last = await db.scalar(
        select(func.max(LockEventRow.occurred_at)).where(LockEventRow.device_id == device_id)
    )
    if last:
        since = last - timedelta(hours=1)
    else:
        since = now - timedelta(days=settings.ACCESS_EVENT_RETENTION_DAYS)
    try:
        events = await gateway.read_log(device_id, since)
    except Exception:  # noqa: BLE001 - one bad lock must not stop the whole pass
        logger.warning("lock trail: could not read the log for %s", device_id)
        return

    # Which auth ids on this device are our keypad PINs → the customer.
    auth_to_user = dict(
        (
            await db.execute(
                select(CustomerAccessDevice.nuki_auth_id, CustomerAccess.user_id)
                .join(CustomerAccess, CustomerAccess.id == CustomerAccessDevice.customer_access_id)
                .where(
                    CustomerAccessDevice.device_id == device_id,
                    CustomerAccessDevice.nuki_auth_id.is_not(None),
                )
            )
        ).all()
    )

    for event in events[:INGEST_BATCH]:
        exists = await db.scalar(
            select(LockEventRow.id).where(LockEventRow.nuki_event_id == event.external_id)
        )
        if exists is not None:
            continue
        user_id = auth_to_user.get(event.auth_id) if event.auth_id else None
        kind = classify_action(event.action, attributed_to_keypad=user_id is not None)
        db.add(
            LockEventRow(
                org_id=org_id,
                device_id=device_id,
                nuki_event_id=event.external_id,
                occurred_at=event.occurred_at,
                kind=kind,
                nuki_auth_id=event.auth_id,
                user_id=user_id,
                trigger=event.trigger,
                raw=event.raw or {},
            )
        )
        if user_id is not None and kind == KIND_KEYPAD_UNLOCK:
            await db.execute(
                CustomerAccess.__table__.update()
                .where(CustomerAccess.org_id == org_id, CustomerAccess.user_id == user_id)
                .values(last_used_at=event.occurred_at)
            )
        result.ingested += 1
    await db.flush()


async def _reconcile_verdicts(db: AsyncSession, now: datetime, result: TrailResult) -> None:
    """Every attributed keypad entry without a verdict yet gets one."""
    judged_ids = select(AccessVerdict.lock_event_id).where(AccessVerdict.lock_event_id.is_not(None))
    entries = (
        (
            await db.execute(
                select(LockEventRow)
                .where(
                    LockEventRow.kind == KIND_KEYPAD_UNLOCK,
                    LockEventRow.user_id.is_not(None),
                    LockEventRow.id.not_in(judged_ids),
                )
                .order_by(LockEventRow.occurred_at)
                .limit(INGEST_BATCH)
            )
        )
        .scalars()
        .all()
    )
    for entry in entries:
        booking = await _matching_booking(db, entry)
        verdict, delta = _classify(entry, booking)
        departure_at, confidence = await _estimate_departure(db, entry, booking)
        if (
            booking is not None
            and departure_at is not None
            and departure_at
            > booking.end_time + timedelta(minutes=settings.ACCESS_OVERSTAY_MINUTES)
        ):
            verdict = VERDICT_OVERSTAY
        db.add(
            AccessVerdict(
                org_id=entry.org_id,
                lock_event_id=entry.id,
                booking_id=booking.id if booking is not None else None,
                verdict=verdict,
                delta_minutes=delta,
                departure_estimate_at=departure_at,
                departure_confidence=confidence,
            )
        )
        result.judged += 1
        if verdict == VERDICT_NO_BOOKING and (settings.ACCESS_ALERT_EMAIL or "").strip():
            await _alert_no_booking(entry)
            result.alerts += 1
    await db.flush()


async def _matching_booking(db: AsyncSession, entry: LockEventRow) -> Booking | None:
    """The customer's booking at a space this lock serves, on the event's day.
    The nearest in time wins when there is more than one."""
    served = spaces_for_device(entry.device_id)  # None = every space
    day_start = entry.occurred_at.replace(hour=0, minute=0, second=0, microsecond=0)
    query = (
        select(Booking)
        .where(
            Booking.org_id == entry.org_id,
            Booking.user_id == entry.user_id,
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.completed]),
            Booking.start_time >= day_start,
            Booking.start_time < day_start + timedelta(days=1),
        )
        .order_by(func.abs(func.extract("epoch", Booking.start_time - entry.occurred_at)))
    )
    candidates = (await db.execute(query)).scalars().all()
    if served is None:
        return candidates[0] if candidates else None
    for booking in candidates:
        room = await db.get(Room, booking.room_id)
        if room is not None and str(room.space_id) in served:
            return booking
    return None


def _classify(entry: LockEventRow, booking: Booking | None) -> tuple[str, int | None]:
    if booking is None:
        return VERDICT_NO_BOOKING, None
    early_cut = booking.start_time - timedelta(minutes=settings.ACCESS_EARLY_MINUTES)
    delta = round((entry.occurred_at - booking.start_time).total_seconds() / 60)
    if entry.occurred_at > booking.end_time:
        return VERDICT_LATE, delta
    if entry.occurred_at < early_cut:
        return VERDICT_EARLY, delta
    return VERDICT_ON_TIME, delta


async def _estimate_departure(
    db: AsyncSession, entry: LockEventRow, booking: Booking | None
) -> tuple[datetime | None, str]:
    """The first door-close/lock after the booking's end on the same device.
    `high` when no other keypad entry sits between the end and it, `low` when
    another session overlaps, `none` when nothing is found."""
    if booking is None:
        return None, CONFIDENCE_NONE
    close = await db.scalar(
        select(LockEventRow.occurred_at)
        .where(
            LockEventRow.device_id == entry.device_id,
            LockEventRow.kind.in_(_CLOSE_KINDS),
            LockEventRow.occurred_at > booking.end_time,
        )
        .order_by(LockEventRow.occurred_at)
        .limit(1)
    )
    if close is None:
        return None, CONFIDENCE_NONE
    others = await db.scalar(
        select(func.count())
        .select_from(LockEventRow)
        .where(
            LockEventRow.device_id == entry.device_id,
            LockEventRow.kind == KIND_KEYPAD_UNLOCK,
            LockEventRow.id != entry.id,
            and_(LockEventRow.occurred_at > booking.end_time, LockEventRow.occurred_at < close),
        )
    )
    return close, (CONFIDENCE_LOW if others else CONFIDENCE_HIGH)


async def _alert_no_booking(entry: LockEventRow) -> None:
    to = settings.ACCESS_ALERT_EMAIL
    when = entry.occurred_at.isoformat()
    message = email.EmailMessage(
        to=to,
        subject="Acesso sem reserva — FlowSpace",
        text_body=(
            f"Foi registado um acesso ao espaço sem uma reserva correspondente.\n\n"
            f"Fechadura: {entry.device_id}\nData/hora (UTC): {when}\n\n"
            "Verifique no painel de administração."
        ),
        html_body=(
            f"<p>Foi registado um acesso ao espaço sem uma reserva correspondente.</p>"
            f"<p>Fechadura: <code>{entry.device_id}</code><br>Data/hora (UTC): {when}</p>"
            "<p>Verifique no painel de administração.</p>"
        ),
    )
    try:
        await email._deliver(email.get_email_gateway(), message)
    except Exception:  # noqa: BLE001 - an alert failure must not stop the pass
        logger.warning("lock trail: could not send the no-booking alert")


async def _prune(db: AsyncSession, now: datetime) -> int:
    cutoff = now - timedelta(days=settings.ACCESS_EVENT_RETENTION_DAYS)
    result = await db.execute(
        LockEventRow.__table__.delete().where(LockEventRow.occurred_at < cutoff)
    )
    return result.rowcount or 0
