"""The hold sweeper (P2.2), and the abandoned-purchase sweep (B68).

An unpaid hold lapses on its own clock; until now nothing noticed until the
customer's next read, which made `GET /bookings/me` issue an UPDATE on every
call. A task started by the app's lifespan now reconciles every lapsed hold
in the organisation every `HOLD_SWEEP_INTERVAL_SECONDS`, in its own session,
so the reads only read. The reconciliation itself is unchanged
(`app.booking_validity._expire_lapsed_holds`: status to `expired`, pack
share back). Single-replica like the rate limiter: with several API
replicas each would sweep — harmless, the UPDATE's RETURNING credits a
hold once — but one sweeper is enough.

The same pass cancels pack purchases left `pending` for longer than
`PACKAGE_CHECKOUT_MINUTES` (B68): a Checkout the customer closed without
paying or cancelling, with no `checkout.session.expired` delivered. Nothing
is owed on a `pending` row, so cancelling it only stops it from being
listed as a pack to resume forever.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import clock
from app.booking_validity import _expire_lapsed_holds
from app.config import settings
from app.models.package import PurchaseStatus, UserPackagePurchase

logger = logging.getLogger(__name__)


async def cancel_stale_purchases(db: AsyncSession, now: datetime) -> int:
    """Every `pending` purchase older than PACKAGE_CHECKOUT_MINUTES to
    `cancelled`; how many were flipped."""
    cutoff = now - timedelta(minutes=settings.PACKAGE_CHECKOUT_MINUTES)
    result = await db.execute(
        update(UserPackagePurchase)
        .where(
            UserPackagePurchase.status == PurchaseStatus.pending,
            UserPackagePurchase.purchased_at < cutoff,
        )
        .values(status=PurchaseStatus.cancelled)
    )
    return result.rowcount or 0


async def sweep_lapsed_holds_once(session_factory: async_sessionmaker) -> int:
    """Flip every lapsed hold, everywhere, and cancel the abandoned
    purchases; how many rows were flipped."""
    async with session_factory() as db:
        try:
            now = clock.utcnow()
            flipped = await _expire_lapsed_holds(db, now)
            cancelled = await cancel_stale_purchases(db, now)
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    if flipped:
        logger.info("hold sweep: %d lapsed hold(s) expired", flipped)
    if cancelled:
        logger.info("hold sweep: %d abandoned pack purchase(s) cancelled", cancelled)
    return flipped + cancelled


async def run_hold_sweeper(session_factory: async_sessionmaker, interval_seconds: float) -> None:
    """Sweep forever, `interval_seconds` apart; a failed sweep is logged and
    the next one still runs. Cancelled by the lifespan on shutdown."""
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await sweep_lapsed_holds_once(session_factory)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("hold sweep failed; retrying after %.0fs", interval_seconds)
