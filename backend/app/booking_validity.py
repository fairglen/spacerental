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

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock, package_hours
from app.models.booking import Booking, BookingStatus
from app.models.room_block import RoomBlock
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
# A block is an operator's, so it may be longer than a booking (a week of
# works), but not unbounded: the same one-query-per-day loop applies nowhere
# here, this is only a sanity cap on what one row may claim.
MAX_BLOCK_DURATION = timedelta(days=31)

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


def holds_slot(now: datetime):
    """SQL predicate: this row currently blocks its slot (C03).

    `confirmed` always does; `pending` does only while its hold is alive
    (`hold_expires_at` NULL = never expires, e.g. series occurrences). The
    `bookings_no_overlap` EXCLUDE constraint cannot evaluate `now()`, so it
    still counts every pending row — `expire_stale_holds` reconciles the two
    before a write can trip it.
    """
    return or_(
        Booking.status == BookingStatus.confirmed,
        and_(
            Booking.status == BookingStatus.pending,
            or_(Booking.hold_expires_at.is_(None), Booking.hold_expires_at > now),
        ),
    )


async def expire_stale_holds(
    db: AsyncSession,
    room_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    now: datetime,
) -> int:
    """Flip pending rows whose hold lapsed, overlapping `[start, end)`, to `expired`.

    Called by every path that is about to insert or reinstate a slot-holding
    row, so an abandoned hold cannot keep tripping the EXCLUDE constraint.
    The UPDATE takes the row locks, which serialises two customers racing for
    the released slot; the constraint then decides between them as before.
    """
    return await _expire_lapsed_holds(
        db,
        now,
        Booking.room_id == room_id,
        Booking.start_time < end_time,
        Booking.end_time > start_time,
    )


async def expire_user_holds(db: AsyncSession, user_id: uuid.UUID, now: datetime) -> int:
    """Flip one customer's lapsed holds to `expired`, wherever they are.

    Expiry is lazy (no sweeper, C03), so this runs whenever that customer's
    bookings or pack balance are about to be read or spent: a lapsed `mixed`
    hold still has pack hours debited until something reconciles it (C13).
    """
    return await _expire_lapsed_holds(db, now, Booking.user_id == user_id)


async def _expire_lapsed_holds(db: AsyncSession, now: datetime, *scope) -> int:
    """The one place a hold lapses: status to `expired`, pack share back (C13).

    A bulk UPDATE, not a load-and-loop, so it stays a single statement for the
    common case of nothing to do. RETURNING names exactly the rows THIS
    statement flipped — a concurrent expiry of the same row waits on its lock,
    then matches nothing — so each lapsed hold credits its hours once. Booking
    locks are taken before the purchase lock, the order `package_hours` asks of
    every status transition.
    """
    result = await db.execute(
        update(Booking)
        .where(
            Booking.status == BookingStatus.pending,
            Booking.hold_expires_at.is_not(None),
            Booking.hold_expires_at <= now,
            *scope,
        )
        .values(status=BookingStatus.expired)
        .returning(Booking.package_purchase_id, Booking.package_hours_used)
        .execution_options(synchronize_session=False)
    )
    lapsed = result.all()
    for purchase_id, hours in lapsed:
        if purchase_id is not None and hours > 0:
            await package_hours.credit_hours(db, purchase_id=purchase_id, hours=hours)
    return len(lapsed)


async def has_conflicting_booking(
    db: AsyncSession,
    room_id: uuid.UUID,
    start_time: datetime,
    end_time: datetime,
    exclude_booking_id: uuid.UUID | None = None,
    now: datetime | None = None,
) -> bool:
    """True if a slot-holding booking overlaps this interval.

    Existence-only: the caller never needs the row, only the boolean, so this
    never risks `MultipleResultsFound` the way `scalar_one_or_none()` on a
    multi-row `select(Booking)` did (the bug this ticket was opened for).
    An expired unpaid hold does not count (C03).
    """
    conditions = [
        Booking.room_id == room_id,
        holds_slot(now or clock.utcnow()),
        Booking.start_time < end_time,
        Booking.end_time > start_time,
    ]
    if exclude_booking_id is not None:
        conditions.append(Booking.id != exclude_booking_id)

    result = await db.execute(select(Booking.id).where(and_(*conditions)).limit(1))
    if result.first() is not None:
        return True
    # Blocked time (A02) is unavailable to every booking path, customer and
    # operator alike, through this one check.
    return await has_blocking_block(db, room_id, start_time, end_time)


async def has_blocking_block(
    db: AsyncSession, room_id: uuid.UUID, start_time: datetime, end_time: datetime
) -> bool:
    result = await db.execute(
        select(RoomBlock.id)
        .where(
            RoomBlock.room_id == room_id,
            RoomBlock.start_time < end_time,
            RoomBlock.end_time > start_time,
        )
        .limit(1)
    )
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
    start_utc = start_time.astimezone(UTC)
    end_utc = end_time.astimezone(UTC)

    # A whole number of hours between the two endpoints is not the same as
    # both endpoints landing *on* the hour: 08:30-09:30 satisfies the former.
    # Nothing stops an operator configuring an `AvailabilityRule` at
    # `open_time = 08:30`, which would generate 08:30-09:30 slots and let the
    # API accept a start the calendar (`step={60}`) can never produce.
    if (end_utc - start_utc) % SLOT_DURATION != timedelta(0):
        return False
    if any(dt.minute or dt.second or dt.microsecond for dt in (start_utc, end_utc)):
        return False

    all_slots: set[tuple[datetime, datetime]] = set()
    day = start_utc.date()
    last_day = (end_utc - timedelta(microseconds=1)).date()
    while day <= last_day:
        all_slots.update(_hourly_slots(await _open_windows_for_day(db, room_id, day)))
        day += timedelta(days=1)

    # Deduplicated on purpose: two `AvailabilityRule` rows for the same room
    # and weekday may overlap (nothing in the schema or the admin UI prevents
    # it), and the same hour emitted twice would sit adjacent after sorting
    # and break the contiguity check below, rejecting a perfectly open slot.
    covered = sorted(s for s in all_slots if s[0] < end_time and s[1] > start_time)
    if not covered or covered[0][0] != start_time or covered[-1][1] != end_time:
        return False
    return all(prev[1] == nxt[0] for prev, nxt in pairwise(covered))
