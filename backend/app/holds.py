"""The hold sweeper (P2.2).

An unpaid hold lapses on its own clock; until now nothing noticed until the
customer's next read, which made `GET /bookings/me` issue an UPDATE on every
call. A task started by the app's lifespan now reconciles every lapsed hold
in the organisation every `HOLD_SWEEP_INTERVAL_SECONDS`, in its own session,
so the reads only read. The reconciliation itself is unchanged
(`app.booking_validity._expire_lapsed_holds`: status to `expired`, pack
share back). Single-replica like the rate limiter: with several API
replicas each would sweep — harmless, the UPDATE's RETURNING credits a
hold once — but one sweeper is enough.
"""

import asyncio
import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

from app import clock
from app.booking_validity import _expire_lapsed_holds

logger = logging.getLogger(__name__)


async def sweep_lapsed_holds_once(session_factory: async_sessionmaker) -> int:
    """Flip every lapsed hold, everywhere; how many were flipped."""
    async with session_factory() as db:
        try:
            flipped = await _expire_lapsed_holds(db, clock.utcnow())
            await db.commit()
        except Exception:
            await db.rollback()
            raise
    if flipped:
        logger.info("hold sweep: %d lapsed hold(s) expired", flipped)
    return flipped


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
