"""The hold sweeper (P2.2), and the abandoned-purchase sweep (B68).

An unpaid hold lapses on its own clock; until now nothing noticed until the
customer's next read, which made `GET /bookings/me` issue an UPDATE on every
call. A task started by the app's lifespan now reconciles every lapsed hold
in the organisation every `HOLD_SWEEP_INTERVAL_SECONDS`, in its own session,
so the reads only read. The reconciliation itself is unchanged
(`app.booking_validity._expire_lapsed_holds`: status to `expired`, pack
share back).

One sweeper per deployment, however many workers or replicas run (N01):
every process starts the task, but a sweep first takes a transaction-level
advisory lock on one constant key (`pg_try_advisory_xact_lock`) in its own
session, and a process that finds it taken skips the tick at DEBUG. The
lock lives exactly as long as the sweep's transaction, so a worker that
dies mid-sweep leaves nothing to clean up. The UPDATE's RETURNING already
credited a hold once under any interleaving; the lock makes the duplicate
work and the duplicate log lines go away too.

The same pass cancels pack purchases left `pending` for longer than
`PACKAGE_CHECKOUT_MINUTES` (B68): a Checkout the customer closed without
paying or cancelling, with no `checkout.session.expired` delivered. Nothing
is owed on a `pending` row, so cancelling it only stops it from being
listed as a pack to resume forever.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import clock
from app.booking_validity import _expire_lapsed_holds
from app.config import settings
from app.models.package import PurchaseStatus, UserPackagePurchase

logger = logging.getLogger(__name__)

# One key for the whole deployment: the lock is the sweep's, not a worker's.
# Any constant does; this one is unlikely to collide with another tool's.
SWEEP_LOCK_KEY = 7_120_001


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


async def try_sweep_lock(db: AsyncSession) -> bool:
    """Take the deployment-wide sweep lock for this session's transaction;
    False when another process holds it (the lock is released at commit or
    rollback, never explicitly)."""
    taken = await db.scalar(
        select(text("pg_try_advisory_xact_lock(:key)")), {"key": SWEEP_LOCK_KEY}
    )
    return bool(taken)


async def sweep_lapsed_holds_once(session_factory: async_sessionmaker) -> int | None:
    """Flip every lapsed hold, everywhere, and cancel the abandoned
    purchases; how many rows were flipped — or None when another process
    is sweeping right now and this one skipped its tick (N01)."""
    async with session_factory() as db:
        try:
            if not await try_sweep_lock(db):
                logger.debug("hold sweep: another process holds the sweep lock; skipping")
                await db.rollback()
                return None
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
