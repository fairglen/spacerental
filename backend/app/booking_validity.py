"""Booking validity checks shared by every path that can acquire a room's slot.

`create_booking` (bookings.py) and the admin status transition that can
reinstate a cancelled/completed booking back to `confirmed`/`pending`
(admin.py) both use `has_conflicting_booking` so they agree on what counts as
a conflict. The public `GET /rooms/{room_id}/availability` slot listing
(spaces.py) is *not* on this module yet — it still has its own separate
slot-generation implementation for what counts as "open" hours. Unifying that
is follow-up work, not something already done here; don't assume the two
agree until spaces.py is migrated to `is_within_open_hours`.

All comparisons are done on tz-aware UTC instants. Stored `TIMESTAMPTZ`
columns and `BookingCreate`'s validator both guarantee that; nothing here
does wall-clock/local-time reasoning — R01 is the ticket for Lisbon local
time, not this one.
"""

import uuid
from datetime import UTC, datetime, timedelta
from datetime import date as date_
from itertools import pairwise

from sqlalchemy import and_, select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.booking import Booking, BookingStatus
from app.models.space import AvailabilityRule

# The product currently only ever offers whole-hour slots (see
# `GET /rooms/{room_id}/availability` and `BookingCalendar`'s
# `step={60}` / `timeslots={1}` react-big-calendar config). This constant is
# the single place that assumption lives on the backend.
SLOT_DURATION = timedelta(hours=1)

# A purely defensive, technical safety bound on how long a range callers may
# hand to `is_within_open_hours` — NOT a product decision about the maximum
# length of a booking (that policy call, if one is ever needed, belongs
# elsewhere and can be tighter than this). `is_within_open_hours` runs one DB
# query per calendar day in `[start_time, end_time)`; without a cap, a client
# could request a range spanning months or years and force a correspondingly
# huge number of queries and in-memory slots in a single request. Callers
# must check `end_time - start_time` against this *before* calling
# `is_within_open_hours`, so the day-loop below is bounded no matter what.
MAX_BOOKING_DURATION = timedelta(hours=24)

# Postgres sqlstate for `deadlock_detected`.
_DEADLOCK_SQLSTATE = "40P01"


def is_lost_slot_race(exc: DBAPIError) -> bool:
    """True if `exc` is how Postgres reported losing `bookings_no_overlap`.

    Usually that is an `IntegrityError` — the exclusion constraint itself
    firing. But two concurrent INSERTs landing on the same GIST index range
    (a one-off booking racing a recurring series, for instance) can instead
    make Postgres report a deadlock, because a GIST exclusion check briefly
    holds a lock against the other row while probing for overlap. SQLAlchemy's
    asyncpg dialect does not map that case to `IntegrityError`, so a caller
    that only caught `IntegrityError` around a booking insert would see an
    unhandled 500 for what is, semantically, still just a lost race for the
    slot — the exact failure mode this module exists to close off.
    """
    return isinstance(exc, IntegrityError) or getattr(exc.orig, "sqlstate", None) == (
        _DEADLOCK_SQLSTATE
    )


async def has_conflicting_booking(
    db: AsyncSession,
    room_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_booking_id: uuid.UUID | None = None,
) -> bool:
    """True if an active (confirmed/pending) booking overlaps this interval.

    Existence-only: the caller never needs the row, only the boolean, so this
    never risks `MultipleResultsFound` the way `scalar_one_or_none()` on a
    multi-row `select(Booking)` did (the bug this ticket was opened for).
    """
    conditions = [
        Booking.room_id == room_id,
        Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
        Booking.start_time < end_time,
        Booking.end_time > start_time,
    ]
    if exclude_booking_id is not None:
        conditions.append(Booking.id != exclude_booking_id)

    result = await db.execute(select(Booking.id).where(and_(*conditions)).limit(1))
    return result.first() is not None


async def _open_windows_for_day(
    db: AsyncSession, room_id: uuid.UUID, day: date_
) -> list[tuple[datetime, datetime]]:
    result = await db.execute(
        select(AvailabilityRule).where(
            AvailabilityRule.room_id == room_id,
            AvailabilityRule.day_of_week == day.weekday(),
            AvailabilityRule.is_active == True,  # noqa: E712
        )
    )
    rules = result.scalars().all()
    return [
        (
            datetime.combine(day, rule.open_time, tzinfo=UTC),
            datetime.combine(day, rule.close_time, tzinfo=UTC),
        )
        for rule in rules
    ]


def _hourly_slots(windows: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    slots: list[tuple[datetime, datetime]] = []
    for open_dt, close_dt in windows:
        current = open_dt
        while current + SLOT_DURATION <= close_dt:
            slots.append((current, current + SLOT_DURATION))
            current += SLOT_DURATION
    return sorted(slots)


async def is_within_open_hours(
    db: AsyncSession, room_id: uuid.UUID, start_time: datetime, end_time: datetime
) -> bool:
    """True if `[start_time, end_time)` is a contiguous run of open hourly slots.

    Mirrors `resolveSelection` in `BookingCalendar.tsx`: the interval must
    align to the hour, and every hour it touches must fall inside an open
    `AvailabilityRule` window for that day with no closed gap in between (e.g.
    a lunch closure) and none of it outside the configured hours entirely.
    A day with no active rule at all is closed, same as the calendar's "no
    rule for this day" case.
    """
    if (end_time - start_time) % SLOT_DURATION != timedelta(0):
        return False

    all_slots: list[tuple[datetime, datetime]] = []
    day = start_time.astimezone(UTC).date()
    last_day = (end_time.astimezone(UTC) - timedelta(microseconds=1)).date()
    while day <= last_day:
        all_slots.extend(_hourly_slots(await _open_windows_for_day(db, room_id, day)))
        day += timedelta(days=1)

    covered = sorted(s for s in all_slots if s[0] < end_time and s[1] > start_time)
    if not covered or covered[0][0] != start_time or covered[-1][1] != end_time:
        return False
    return all(prev[1] == nxt[0] for prev, nxt in pairwise(covered))
