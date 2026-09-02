"""The prepaid-hours ledger: every debit and credit against a package purchase.

Prepaid hours are money the customer has already paid, so the invariant this
module exists to hold is `hours_used + hours_remaining == hours_total` — always,
including under concurrency and including when a booking is cancelled.

Two rules make that hold:

* **Every write takes `SELECT ... FOR UPDATE` on the purchase row.** Balances are
  read-then-written, and without the lock two requests interleave, both read the
  same balance, and the second overwrites the first — selling the same hour
  twice.
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

from app.models.package import PurchaseStatus, UserPackagePurchase


async def _lock(
    db: AsyncSession, purchase_id: uuid.UUID
) -> UserPackagePurchase | None:
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


async def redeem_hours(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    org_id: uuid.UUID,
    hours: Decimal,
    now: datetime,
) -> UserPackagePurchase | None:
    """Debit `hours` from the caller's best active purchase, or return None.

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
            UserPackagePurchase.hours_remaining >= hours,
        )
        # Spend the soonest-expiring hours first so nothing lapses unused.
        .order_by(UserPackagePurchase.expires_at.asc(), UserPackagePurchase.id.asc())
    )

    for purchase_id in candidates.scalars().all():
        purchase = await _lock(db, purchase_id)
        if purchase is None or not _is_spendable(purchase, hours, now):
            continue

        purchase.hours_remaining -= hours
        purchase.hours_used += hours
        await db.flush()
        return purchase

    return None


async def credit_hours(
    db: AsyncSession, *, purchase_id: uuid.UUID, hours: Decimal
) -> None:
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
