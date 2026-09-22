"""The prepaid-hours ledger: every debit and credit against a package purchase.

Prepaid hours are money the customer has already paid, so the invariant this
module exists to hold is `hours_used + hours_remaining == hours_total` — always,
including under concurrency and including when a booking is cancelled.

Two rules make that hold:

* **Every write takes `SELECT ... FOR UPDATE` on the purchase row.** Balances are
  read-then-written, and without the lock two requests interleave, both read the
  same balance, and the second overwrites the first — selling the same hour
  twice.
* **Status transitions lock the booking before its purchase.** Callers must
  re-read the booking under that lock before deciding to refund or re-debit,
  so concurrent transitions cannot apply the same movement twice.
* **No function here commits.** Callers keep the lock until the request's
  transaction ends, so a deduction and the booking it paid for land, or roll
  back, together. A booking can never exist without its debit, and a debit can
  never exist without its booking.

It lives outside `routers/` because both the member cancel path
(`routers/bookings.py`) and the admin status-change path (`routers/admin.py`)
move hours, and neither should be importing the other.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking, BookingStatus
from app.models.package import PurchaseStatus, UserPackagePurchase


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


def _is_spendable(purchase: UserPackagePurchase, hours: Decimal, now: datetime) -> bool:
    return (
        purchase.status is PurchaseStatus.active
        and purchase.expires_at > now
        and purchase.hours_remaining >= hours
    )


async def _debit_first(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    at_least: Decimal,
    at_most: Decimal,
    now: datetime,
) -> tuple[UserPackagePurchase, Decimal] | None:
    """Debit the first usable purchase; return it and the hours taken, or None.

    "First" is the soonest-expiring active purchase holding `at_least` hours,
    so nothing lapses unused. It gives up to `at_most`. Both redemption rules
    are this one walk: a whole block asks for `at_least == at_most`, a partial
    one (C13) accepts any positive balance. One purchase per call, never a sum
    across several — a booking points at exactly one purchase, which is what
    lets a cancellation put the hours back where they came from.

    Candidate ids are read unlocked, then each candidate is re-read under
    `FOR UPDATE` and re-validated *under that lock*. That second check is the
    point: a concurrent redemption that spends the last hour commits before our
    lock is granted, and READ COMMITTED then hands us its row version, so we see
    the drained balance and move on instead of overdrawing the purchase.
    """
    candidates = await db.execute(
        select(UserPackagePurchase.id)
        .where(
            UserPackagePurchase.user_id == user_id,
            UserPackagePurchase.org_id == org_id,
            UserPackagePurchase.status == PurchaseStatus.active,
            UserPackagePurchase.expires_at > now,
            UserPackagePurchase.hours_remaining >= at_least,
        )
        # Spend the soonest-expiring hours first so nothing lapses unused.
        .order_by(UserPackagePurchase.expires_at.asc(), UserPackagePurchase.id.asc())
    )

    for purchase_id in candidates.scalars().all():
        purchase = await _lock(db, purchase_id)
        if purchase is None or not _is_spendable(purchase, at_least, now):
            continue

        hours = min(purchase.hours_remaining, at_most)
        purchase.hours_remaining -= hours
        purchase.hours_used += hours
        await db.flush()
        return purchase, hours

    return None


async def redeem_hours(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> UserPackagePurchase | None:
    """Debit the whole of `hours` from the caller's best active purchase, or None."""
    debited = await _debit_first(
        db, user_id=user_id, org_id=org_id, at_least=hours, at_most=hours, now=now
    )
    return debited[0] if debited else None


# The smallest balance worth spending: one cent of an hour, the column's scale.
_ANY_HOURS = Decimal("0.01")


async def redeem_up_to(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> tuple[UserPackagePurchase, Decimal] | None:
    """Debit as much of `hours` as the soonest-expiring purchase still has (C13).

    The pack's share of a `mixed` booking. Returns the purchase and what it
    gave, which may be all of `hours` if a balance grew since the caller last
    looked — the caller decides what kind of booking that makes.
    """
    return await _debit_first(
        db, user_id=user_id, org_id=org_id, at_least=_ANY_HOURS, at_most=hours, now=now
    )


async def credit_hours(db: AsyncSession, *, purchase_id: uuid.UUID, hours: Decimal) -> None:
    """Give `hours` back to the purchase they were debited from.

    Unconditional by design: an expired or cancelled purchase still gets its
    hours back, because this reverses one specific earlier debit rather than
    granting new spendable time. Whether those hours can be spent again is
    `expires_at`'s business, not this function's — and silently keeping them
    would break `hours_used + hours_remaining == hours_total`.

    A missing purchase is not an error. The FK is `ON DELETE SET NULL`, so a
    deleted purchase leaves the booking cancellable with nothing to credit.
    """
    purchase = await _lock(db, purchase_id)
    if purchase is None:
        return

    purchase.hours_remaining += hours
    purchase.hours_used -= hours
    await db.flush()


async def debit_purchase(
    db: AsyncSession,
    *,
    purchase_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> bool:
    """Re-debit one specific purchase; False if it can no longer cover `hours`.

    Only used to undo a refund — reinstating a package booking that was
    cancelled. It targets the original purchase rather than searching, so the
    hours return to where they came from, and it can legitimately fail: the
    refunded hours may have been spent on another booking in the meantime.
    """
    purchase = await _lock(db, purchase_id)
    if purchase is None or not _is_spendable(purchase, hours, now):
        return False

    purchase.hours_remaining -= hours
    purchase.hours_used += hours
    await db.flush()
    return True


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
    transition a no-op instead of a second credit. Re-debiting targets the
    original purchase and can honestly fail: the returned hours may have been
    spent elsewhere. Nothing is written in that case; the caller refuses the
    transition.
    """
    if booking.package_purchase_id is None or booking.package_hours_used <= 0:
        return True
    held_before, held_after = holds_package_hours(previous), holds_package_hours(new)
    if held_before and not held_after:
        await credit_hours(
            db, purchase_id=booking.package_purchase_id, hours=booking.package_hours_used
        )
    elif held_after and not held_before:
        return await debit_purchase(
            db,
            purchase_id=booking.package_purchase_id,
            hours=booking.package_hours_used,
            now=now,
        )
    return True
