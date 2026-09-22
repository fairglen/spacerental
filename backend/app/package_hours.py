"""The prepaid-hours ledger: every debit and credit against a package purchase.

Prepaid hours are money the customer has already paid, so the invariant this
module exists to hold is `hours_used + hours_remaining == hours_total` — always,
including under concurrency and including when a booking is cancelled.

Since H02 the customer's purchases form one HOUR BANK: a booking draws on as
many active, unexpired purchases as it needs, soonest-expiring first, and each
draw is a `BookingPackageDebit` row. That row is what lets a cancellation put
every hour back on the exact purchase it came from, whatever else happened to
the balances in between. `Booking.package_hours_used` records the booking's
pack share for good; the debit rows exist only while the booking holds it.

Three rules make the invariant hold:

* **Every write takes `SELECT ... FOR UPDATE` on the purchase row.** Balances are
  read-then-written, and without the lock two requests interleave, both read the
  same balance, and the second overwrites the first — selling the same hour
  twice.
* **Status transitions lock the booking before its purchases.** Callers must
  re-read the booking under that lock before deciding to refund or re-debit,
  so concurrent transitions cannot apply the same movement twice.
* **No function here commits.** Callers keep the lock until the request's
  transaction ends, so a deduction and the booking it paid for land, or roll
  back, together. A booking can never exist without its debits, and a debit can
  never exist without its booking.

It lives outside `routers/` because both the member cancel path
(`routers/bookings.py`) and the admin status-change path (`routers/admin.py`)
move hours, and neither should be importing the other.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking, BookingStatus
from app.models.package import BookingPackageDebit, PurchaseStatus, UserPackagePurchase

# The smallest balance worth spending: one cent of an hour, the column's scale.
_ANY_HOURS = Decimal("0.01")

# One purchase's contribution to a booking, as the walk decided it.
Draw = tuple[UserPackagePurchase, Decimal]


async def _lock(db: AsyncSession, purchase_id: uuid.UUID) -> UserPackagePurchase | None:
    """Re-read one purchase under a row lock, bypassing the identity map.

    `populate_existing` matters as much as the lock: without it the session can
    answer from its identity map with the pre-lock values, which are exactly the
    values we took the lock in order to stop trusting.
    """
    result = await db.execute(
        select(UserPackagePurchase)
        .where(UserPackagePurchase.id == purchase_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def is_spendable(purchase: UserPackagePurchase, now: datetime) -> bool:
    """Part of the bank: active, not yet expired, something left on it."""
    return (
        purchase.status is PurchaseStatus.active
        and purchase.expires_at > now
        and purchase.hours_remaining >= _ANY_HOURS
    )


async def _walk(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> list[Draw]:
    """Debit up to `hours` across the bank, soonest-expiring purchase first.

    Candidate ids are read unlocked, then each candidate is re-read under
    `FOR UPDATE` and re-validated *under that lock*. That second check is the
    point: a concurrent redemption that spends the last hour commits before our
    lock is granted, and READ COMMITTED then hands us its row version, so we see
    the drained balance and move on instead of overdrawing the purchase. Locks
    are taken in expiry order by every walker, so two walks never deadlock.

    Returns what was taken from whom, balances already debited. May cover less
    than `hours` (an empty list when the bank is empty); the caller decides
    what that makes of the booking, or reverts it with `_undo`.
    """
    candidates = await db.execute(
        select(UserPackagePurchase.id)
        .where(
            UserPackagePurchase.user_id == user_id,
            UserPackagePurchase.org_id == org_id,
            UserPackagePurchase.status == PurchaseStatus.active,
            UserPackagePurchase.expires_at > now,
            UserPackagePurchase.hours_remaining >= _ANY_HOURS,
        )
        # Spend the soonest-expiring hours first so nothing lapses unused.
        .order_by(UserPackagePurchase.expires_at.asc(), UserPackagePurchase.id.asc())
    )

    draws: list[Draw] = []
    needed = hours
    for purchase_id in candidates.scalars().all():
        if needed <= 0:
            break
        purchase = await _lock(db, purchase_id)
        if purchase is None or not is_spendable(purchase, now):
            continue
        taken = min(purchase.hours_remaining, needed)
        purchase.hours_remaining -= taken
        purchase.hours_used += taken
        draws.append((purchase, taken))
        needed -= taken
    if draws:
        await db.flush()
    return draws


async def _undo(db: AsyncSession, draws: list[Draw]) -> None:
    """Put a walk's draws back, under the locks the walk still holds."""
    for purchase, taken in draws:
        purchase.hours_remaining += taken
        purchase.hours_used -= taken
    if draws:
        await db.flush()


async def redeem_up_to(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> list[Draw]:
    """Debit as much of `hours` as the bank holds (C13 → H02: across purchases).

    The pack's share of a `mixed` booking: `min(hours, bank)`. Returns the
    draws, which may add up to all of `hours` if the balance grew since the
    caller last looked — the caller decides what kind of booking that makes.
    """
    return await _walk(db, user_id=user_id, org_id=org_id, hours=hours, now=now)


async def redeem_hours(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> list[Draw] | None:
    """Debit the whole of `hours` from the bank, or nothing at all.

    The same walk, all-or-nothing: if the bank cannot cover the block every
    draw is put back before returning None, so a refused `package` booking
    leaves the balances exactly as they were.
    """
    draws = await _walk(db, user_id=user_id, org_id=org_id, hours=hours, now=now)
    if sum((taken for _, taken in draws), Decimal(0)) < hours:
        await _undo(db, draws)
        return None
    return draws


def total_drawn(draws: list[Draw]) -> Decimal:
    return sum((taken for _, taken in draws), Decimal(0))


async def record_debits(db: AsyncSession, booking: Booking, draws: list[Draw]) -> None:
    """Write the debit rows for a booking whose hours a walk just took.

    Called once the booking row exists (it needs the id). The booking's
    `package_hours_used` is the sum of these rows from here on.
    """
    for purchase, taken in draws:
        db.add(
            BookingPackageDebit(
                org_id=booking.org_id,
                booking_id=booking.id,
                purchase_id=purchase.id,
                hours=taken,
            )
        )
    if draws:
        await db.flush()


async def debits_of(db: AsyncSession, booking_id: uuid.UUID) -> list[BookingPackageDebit]:
    """A booking's debit rows in draw order: soonest-expiring purchase first,
    the order every walk takes (rows written in one flush share a timestamp,
    so `created_at` alone cannot tell them apart)."""
    result = await db.execute(
        select(BookingPackageDebit)
        .join(UserPackagePurchase, UserPackagePurchase.id == BookingPackageDebit.purchase_id)
        .where(BookingPackageDebit.booking_id == booking_id)
        .order_by(UserPackagePurchase.expires_at.asc(), UserPackagePurchase.id.asc())
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def credit_hours(db: AsyncSession, *, purchase_id: uuid.UUID, hours: Decimal) -> None:
    """Give `hours` back to the purchase they were debited from.

    Unconditional by design: an expired or cancelled purchase still gets its
    hours back, because this reverses one specific earlier debit rather than
    granting new spendable time. Whether those hours can be spent again is
    `expires_at`'s business, not this function's — and silently keeping them
    would break `hours_used + hours_remaining == hours_total`.

    A missing purchase is not an error: the debit's FK cascades, so a deleted
    purchase leaves the booking cancellable with nothing to credit.
    """
    purchase = await _lock(db, purchase_id)
    if purchase is None:
        return

    purchase.hours_remaining += hours
    purchase.hours_used -= hours
    await db.flush()


async def release_debits(db: AsyncSession, booking_id: uuid.UUID) -> Decimal:
    """Credit every debit of a booking back to its own purchase and drop the rows.

    The one way hours come back: cancellation, a lapsed hold, an operator
    moving the booking out of a slot-holding status. Returns what was
    released. Deleting the rows is what makes a repeat call a no-op rather
    than a second credit, so the caller's re-read of the booking's status is
    the guard, not this function.
    """
    released = Decimal(0)
    for debit in await debits_of(db, booking_id):
        await credit_hours(db, purchase_id=debit.purchase_id, hours=debit.hours)
        released += debit.hours
    await db.execute(
        delete(BookingPackageDebit).where(BookingPackageDebit.booking_id == booking_id)
    )
    await db.flush()
    return released


async def redebit_booking(db: AsyncSession, booking: Booking, *, now: datetime) -> bool:
    """Take a booking's pack share again, from whatever the bank holds now.

    Reinstating a cancelled booking, resuming an expired hold, late money for
    a lapsed one: the hours went back when it stopped holding them and may
    have been spent since, so this can honestly fail. Nothing is written in
    that case; the caller refuses the transition.
    """
    draws = await redeem_hours(
        db,
        user_id=booking.user_id,
        org_id=booking.org_id,
        hours=booking.package_hours_used,
        now=now,
    )
    if draws is None:
        return False
    await record_debits(db, booking, draws)
    return True


async def settle_moved_booking(
    db: AsyncSession, booking: Booking, *, new_duration: Decimal, now: datetime
) -> Decimal:
    """Bring a booking's pack share in line with a new length (H03 a).

    Shrinking gives the surplus back in REVERSE draw order, so the hours that
    lapse first stay spent and the latest-expiring purchase is the one that
    gets hours back. Growing draws the extra from the bank, soonest-expiring
    first, and returns what the bank could NOT cover — the operator settles
    that with the customer outside the platform; no money moves here in
    either direction. A booking that holds no hours (cancelled, expired) only
    has its recorded share capped at the new length; nothing is credited
    twice or drawn for a booking that is not live.
    """
    if booking.package_hours_used <= 0:
        return Decimal(0)
    if not holds_package_hours(booking.status):
        booking.package_hours_used = min(booking.package_hours_used, new_duration)
        return Decimal(0)

    if new_duration < booking.package_hours_used:
        surplus = booking.package_hours_used - new_duration
        for debit in reversed(await debits_of(db, booking.id)):
            if surplus <= 0:
                break
            give = min(debit.hours, surplus)
            await credit_hours(db, purchase_id=debit.purchase_id, hours=give)
            debit.hours -= give
            if debit.hours <= 0:
                await db.delete(debit)
            surplus -= give
        booking.package_hours_used = new_duration
        await db.flush()
        return Decimal(0)

    extra = new_duration - booking.duration_hours
    if extra <= 0:
        return Decimal(0)
    # The CHECK constraint (share <= duration) is evaluated at every flush,
    # so the longer duration must be on the row before the share grows.
    booking.duration_hours = new_duration
    draws = await redeem_up_to(
        db, user_id=booking.user_id, org_id=booking.org_id, hours=extra, now=now
    )
    existing = {d.purchase_id: d for d in await debits_of(db, booking.id)}
    for purchase, taken in draws:
        # One row per purchase: a purchase already drawn on grows its row.
        if purchase.id in existing:
            existing[purchase.id].hours += taken
        else:
            db.add(
                BookingPackageDebit(
                    org_id=booking.org_id,
                    booking_id=booking.id,
                    purchase_id=purchase.id,
                    hours=taken,
                )
            )
    drawn = total_drawn(draws)
    booking.package_hours_used += drawn
    await db.flush()
    return extra - drawn


# A booking has its pack share debited exactly while it is in one of these.
# Everything that changes a status goes through `settle_status_change`, so the
# rule lives here once: a booking that stops holding its slot without being
# used (cancelled, an unpaid hold that expired, money that arrived too late)
# gives its hours back, and takes them again if it is ever reinstated.
_HOLDS_HOURS = frozenset({BookingStatus.pending, BookingStatus.confirmed, BookingStatus.completed})


def holds_package_hours(status: BookingStatus) -> bool:
    return status in _HOLDS_HOURS


async def settle_status_change(
    db: AsyncSession,
    booking: Booking,
    *,
    previous: BookingStatus,
    new: BookingStatus,
    now: datetime,
) -> bool:
    """Move `booking`'s pack share to match a status change. False = cannot re-debit.

    The caller holds the booking's row lock and passes the status the row
    REALLY had (re-read after any bulk update), which is what makes a repeated
    transition a no-op instead of a second credit. Re-debiting walks the bank
    again and can honestly fail: the returned hours may have been spent
    elsewhere. Nothing is written in that case; the caller refuses the
    transition.
    """
    if booking.package_hours_used <= 0:
        return True
    held_before, held_after = holds_package_hours(previous), holds_package_hours(new)
    if held_before and not held_after:
        await release_debits(db, booking.id)
    elif held_after and not held_before:
        return await redebit_booking(db, booking, now=now)
    return True


@dataclass(frozen=True)
class ExpiringNext:
    hours: Decimal
    expires_at: datetime


@dataclass(frozen=True)
class BankBalance:
    """What the customer sees as one number (H02): every spendable hour, and
    the slice of it that lapses first."""

    hours_available: Decimal
    hours_expiring_next: ExpiringNext | None


def bank_balance(purchases: list[UserPackagePurchase], now: datetime) -> BankBalance:
    spendable = sorted(
        (p for p in purchases if is_spendable(p, now)), key=lambda p: (p.expires_at, p.id)
    )
    total = sum((p.hours_remaining for p in spendable), Decimal(0))
    if not spendable:
        return BankBalance(hours_available=total, hours_expiring_next=None)
    first = spendable[0]
    # Purchases that lapse at the same instant lapse together.
    same_instant = sum(
        (p.hours_remaining for p in spendable if p.expires_at == first.expires_at), Decimal(0)
    )
    return BankBalance(
        hours_available=total,
        hours_expiring_next=ExpiringNext(hours=same_instant, expires_at=first.expires_at),
    )
