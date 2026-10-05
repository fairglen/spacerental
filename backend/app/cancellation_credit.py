"""The paid hours of a cancelled booking, back in the customer's bank (K01).

Money never moves. A booking that was paid for — `hourly`, the money share
of `mixed`, or an operator's `manual` one — and is cancelled becomes a
purchase row of `source = cancellation_credit`: `credit_hours = total_amount
/ room.hourly_rate` (what the recorded amount buys at the room's rate),
`amount_paid = total_amount` so money reports still add up, no package, and
an expiry of CANCELLATION_CREDIT_VALIDITY_DAYS. One credit per booking,
ever (unique `source_booking_id`). Never for an unpaid hold, an expired one
or a `package` booking: nothing was paid for them.

Reinstating a cancelled booking takes the credit back if none of it was
spent; once any credited hour went into another booking the reinstatement
is refused and a new booking is the way.
"""

import uuid
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.package import PurchaseSource, PurchaseStatus, UserPackagePurchase

CREDITABLE_METHODS = (PaymentMethod.hourly, PaymentMethod.mixed, PaymentMethod.manual)
# The statuses in which the booking held money: a pending hold has paid
# nothing yet, an expired or unfulfilled one holds no slot.
PAID_STATUSES = (BookingStatus.confirmed, BookingStatus.completed)


class CreditSpentError(Exception):
    """A credited hour is already in another booking: no reversal."""


# The purchases ledger stores hours as Numeric(5, 2), like the packs and the
# complimentary grants (≤ 999 h). An operator may override a booking's amount
# with no ratio to the rate, so the derived credit is checked here — a 409
# the caller can act on, not a numeric overflow that turns into a 500 and a
# rolled-back cancellation (review on #69).
MAX_LEDGER_HOURS = Decimal("999.99")


class CreditTooLargeError(Exception):
    """The credit would not fit the hour bank's ledger; nothing was written."""

    def __init__(self, hours: Decimal) -> None:
        super().__init__(f"{hours} h exceeds the ledger maximum of {MAX_LEDGER_HOURS} h")
        self.hours = hours


def credit_hours_for(booking: Booking) -> Decimal:
    rate = booking.room.hourly_rate
    if rate <= 0 or booking.total_amount <= 0:
        return Decimal("0.00")
    return (booking.total_amount / rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def is_creditable(booking: Booking, previous: BookingStatus) -> bool:
    return (
        previous in PAID_STATUSES
        and booking.payment_method in CREDITABLE_METHODS
        and booking.total_amount > 0
    )


async def existing_credit(db: AsyncSession, booking_id: uuid.UUID) -> UserPackagePurchase | None:
    return await db.scalar(
        select(UserPackagePurchase).where(UserPackagePurchase.source_booking_id == booking_id)
    )


async def create_credit(
    db: AsyncSession, booking: Booking, *, previous: BookingStatus, now: datetime
) -> UserPackagePurchase | None:
    """The credit row for a booking being cancelled, or None when nothing
    was paid or an active credit already exists. `booking.room` must be
    loaded. A booking cancelled, reinstated and cancelled again keeps its
    one row: the reversal left it `cancelled` and unspent, so it comes back
    with a fresh expiry rather than a second row."""
    if not is_creditable(booking, previous):
        return None
    hours = credit_hours_for(booking)
    if hours <= 0:
        return None
    if hours > MAX_LEDGER_HOURS:
        raise CreditTooLargeError(hours)
    existing = await existing_credit(db, booking.id)
    if existing is not None:
        if existing.status is not PurchaseStatus.cancelled or existing.hours_used > 0:
            return None
        existing.hours_total = hours
        existing.hours_remaining = hours
        existing.amount_paid = booking.total_amount
        existing.status = PurchaseStatus.active
        existing.purchased_at = now
        existing.expires_at = now + timedelta(days=settings.CANCELLATION_CREDIT_VALIDITY_DAYS)
        await db.flush()
        return existing
    credit = UserPackagePurchase(
        user_id=booking.user_id,
        package_id=None,
        org_id=booking.org_id,
        hours_total=hours,
        hours_used=Decimal("0.00"),
        hours_remaining=hours,
        amount_paid=booking.total_amount,
        status=PurchaseStatus.active,
        source=PurchaseSource.cancellation_credit,
        source_booking_id=booking.id,
        purchased_at=now,
        expires_at=now + timedelta(days=settings.CANCELLATION_CREDIT_VALIDITY_DAYS),
    )
    db.add(credit)
    await db.flush()
    return credit


async def reverse_credit(db: AsyncSession, booking_id: uuid.UUID) -> bool:
    """Take a booking's credit back on reinstatement. True when one was
    cancelled, False when there was none; CreditSpentError when any of it
    was already spent."""
    credit = await db.scalar(
        select(UserPackagePurchase)
        .where(UserPackagePurchase.source_booking_id == booking_id)
        .with_for_update()
    )
    if credit is None:
        return False
    # Spent hours are spent whatever the row's status: an operator may have
    # cancelled the purchase row (PUT /admin/purchases) after some of it went
    # into another booking, and that must not read as "already reversed"
    # (review on #69, round 2).
    if credit.hours_used > 0:
        raise CreditSpentError(str(credit.id))
    if credit.status is PurchaseStatus.cancelled:
        return False
    if credit.hours_remaining < credit.hours_total:
        raise CreditSpentError(str(credit.id))
    credit.status = PurchaseStatus.cancelled
    credit.hours_remaining = Decimal("0.00")
    await db.flush()
    return True
