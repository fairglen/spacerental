import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.booking_cancellation import apply_cancellation, validate_cancellation
from app.config import settings
from app.database import get_db
from app.locks import LockGateway, get_lock_gateway
from app.email import EmailGateway, get_email_gateway
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember
from app.models.recurrence import RecurrenceFrequency, RecurrenceRule
from app.models.space import Room
from app.models.user import User
from app.schemas.booking import BookingOut
from app.schemas.recurrence import (
    RecurrenceConflictOut,
    RecurrenceCreate,
    RecurrenceOut,
    RecurrenceUpdate,
    RecurrenceWithBookingsOut,
)


def require_recurrence_enabled() -> None:
    if not settings.RECURRING_BOOKINGS_ENABLED:
        raise HTTPException(status_code=404, detail="Recurring bookings are not enabled")


router = APIRouter(
    prefix="/recurrences", tags=["recurrences"],
    dependencies=[Depends(require_recurrence_enabled)],
)

# A booking only holds its slot while pending or confirmed; cancelled and
# completed rows may overlap freely. Mirrors the predicate of the
# `bookings_no_overlap` EXCLUDE constraint.
ACTIVE_STATUSES = (BookingStatus.pending, BookingStatus.confirmed)

# Two years of weekly slots. A bound is needed because the series is expanded
# flat — one row per occurrence — so an unbounded `until_date` is a cheap way
# to ask for an arbitrarily large write.
MAX_OCCURRENCES = 104

_STEP = {RecurrenceFrequency.weekly: timedelta(days=7)}


def expand_occurrences(
    start_time: datetime,
    end_time: datetime,
    until_date: date,
    frequency: RecurrenceFrequency = RecurrenceFrequency.weekly,
) -> list[tuple[datetime, datetime]]:
    """Every (start, end) pair the series covers, in ascending order.

    The cadence is added to the UTC instant, so a series crossing a DST
    boundary shifts by an hour in Portuguese local time. Anchoring to local
    time would need a timezone on the room, which the schema does not carry
    yet; UTC arithmetic is the honest behaviour until it does.

    Ascending order matters: concurrent series that touch the same slots then
    take their locks in the same order, so the loser of a race gets a
    constraint violation rather than a deadlock.
    """
    step = _STEP[frequency]
    duration = end_time - start_time
    occurrences: list[tuple[datetime, datetime]] = []
    cursor = start_time
    while cursor.date() <= until_date:
        occurrences.append((cursor, cursor + duration))
        cursor += step
    return occurrences


def _conflict_response(conflicts: list[datetime]) -> JSONResponse:
    """409 carrying the occurrences that are already taken.

    Top-level `conflicts` rather than FastAPI's `detail` envelope so the client
    can branch on it directly (Epic 1.4 lists the dates inline).
    """
    body = RecurrenceConflictOut(
        detail="Some occurrences in this series are already booked",
        conflicts=conflicts,
    )
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "detail": body.detail,
            "conflicts": [
                c.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                for c in body.conflicts
            ],
        },
    )


async def _lock_room(db: AsyncSession, room_id: uuid.UUID) -> None:
    """Serialize series writes on one room for the rest of the transaction.

    Not an optimisation — it removes a genuine deadlock. Two series racing on
    the same room each insert *many* rows, and the EXCLUDE constraint makes
    each insert wait on the other transaction's conflicting tuple; with rows
    landing in different orders the two waits form a cycle and PostgreSQL kills
    one with a deadlock error rather than a constraint violation. Measured at
    roughly one run in ten before this lock existed.

    A single-row writer (`POST /bookings`) cannot take part in such a cycle —
    it either inserts and never waits, or waits holding nothing — so it does
    not need the lock, and the EXCLUDE constraint remains the real arbiter
    between a series and a one-off booking.

    Held until commit or rollback; nothing has to release it by hand.
    """
    await db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:room_key, 0))"),
        {"room_key": str(room_id)},
    )


async def _find_conflicts(
    db: AsyncSession,
    room_id: uuid.UUID,
    occurrences: list[tuple[datetime, datetime]],
    ignore_booking_ids: list[uuid.UUID] | None = None,
) -> list[datetime]:
    """Starts of the occurrences that overlap a slot-holding booking.

    `ignore_booking_ids` excludes the series' own rows during an edit — they
    are about to be cancelled, so they must not be counted as conflicting with
    their own replacements.
    """
    if not occurrences:
        return []

    overlaps_any = or_(
        *[
            and_(Booking.start_time < occ_end, Booking.end_time > occ_start)
            for occ_start, occ_end in occurrences
        ]
    )
    stmt = select(Booking.start_time, Booking.end_time).where(
        Booking.room_id == room_id,
        Booking.status.in_(ACTIVE_STATUSES),
        overlaps_any,
    )
    if ignore_booking_ids:
        stmt = stmt.where(Booking.id.notin_(ignore_booking_ids))

    taken = (await db.execute(stmt)).all()
    return [
        occ_start
        for occ_start, occ_end in occurrences
        if any(start < occ_end and end > occ_start for start, end in taken)
    ]


def _validate_window(
    start_time: datetime,
    end_time: datetime,
    until_date: date,
    frequency: RecurrenceFrequency,
    *,
    allow_past_anchor: bool = False,
) -> list[tuple[datetime, datetime]]:
    """Validate the requested series and return its expansion."""
    if end_time <= start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_time must be after start_time",
        )
    if not allow_past_anchor and start_time <= datetime.now(tz=timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_time must be in the future",
        )
    if until_date < start_time.date():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="until_date must not be before start_time",
        )
    if end_time - start_time > _STEP[frequency]:
        # Otherwise consecutive occurrences overlap each other and the series
        # could never be inserted.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An occurrence cannot be longer than the recurrence interval",
        )

    if (until_date - start_time.date()).days // 7 + 1 > MAX_OCCURRENCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A series cannot have more than {MAX_OCCURRENCES} occurrences",
        )
    occurrences = expand_occurrences(start_time, end_time, until_date, frequency)
    if allow_past_anchor:
        now = datetime.now(tz=timezone.utc)
        occurrences = [occ for occ in occurrences if occ[0] > now]
        if not occurrences:
            raise HTTPException(status_code=400, detail="The series has no future occurrences")
    return occurrences


def _build_bookings(
    *,
    rule: RecurrenceRule,
    room: Room,
    occurrences: list[tuple[datetime, datetime]],
) -> list[Booking]:
    """One `Booking` row per occurrence, all pointing back at the rule.

    Created `pending`, exactly like `POST /bookings`: pending holds the slot,
    so nothing here hands out an unpaid confirmed booking. Charging for a whole
    series in one Checkout Session needs the webhook to confirm more than one
    row per session, which the unique `stripe_checkout_session_id` forbids —
    deliberately left to the follow-up that wires payments to Epic 1.
    """
    duration = occurrences[0][1] - occurrences[0][0]
    duration_hours = Decimal(str(round(duration.total_seconds() / 3600, 2)))
    total_amount = duration_hours * room.hourly_rate
    return [
        Booking(
            org_id=room.org_id,
            room_id=room.id,
            user_id=rule.user_id,
            start_time=occ_start,
            end_time=occ_end,
            duration_hours=duration_hours,
            total_amount=total_amount,
            status=BookingStatus.pending,
            payment_method=PaymentMethod.hourly,
            notes=rule.notes,
            recurrence_rule_id=rule.id,
        )
        for occ_start, occ_end in occurrences
    ]


async def _load_bookings(db: AsyncSession, booking_ids: list[uuid.UUID]) -> list[Booking]:
    """Re-read just-written rows so server defaults are populated.

    Reading `created_at` straight off a flushed instance would trigger implicit
    IO outside the greenlet and fail with MissingGreenlet.
    """
    result = await db.execute(
        select(Booking).where(Booking.id.in_(booking_ids)).order_by(Booking.start_time)
    )
    return list(result.scalars().all())


async def _require_membership(db: AsyncSession, user: User, org_id: uuid.UUID) -> None:
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.org_id == org_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )


async def _get_own_rule(
    db: AsyncSession, recurrence_id: uuid.UUID, user: User
) -> RecurrenceRule:
    result = await db.execute(
        select(RecurrenceRule).where(RecurrenceRule.id == recurrence_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Recurrence not found"
        )
    if rule.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage your own recurring bookings",
        )
    return rule


@router.post("", status_code=status.HTTP_201_CREATED, responses={409: {"model": RecurrenceConflictOut}})
async def create_recurrence(
    body: RecurrenceCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a recurring series, all-or-nothing.

    Two layers guard the slots, and both are needed. The pre-check exists to
    report *which* dates clash, which the database cannot tell us; the
    `bookings_no_overlap` EXCLUDE constraint is what actually makes it safe,
    because between the pre-check and the insert another request can claim the
    same slot. Everything happens in one transaction, so a constraint violation
    rolls the whole series back and no partial series can survive.
    """
    result = await db.execute(
        select(Room).where(Room.id == body.room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    occurrences = _validate_window(
        body.start_time, body.end_time, body.until_date, body.frequency
    )
    await _require_membership(db, user, room.org_id)

    await _lock_room(db, room.id)
    conflicts = await _find_conflicts(db, room.id, occurrences)
    if conflicts:
        await db.rollback()
        return _conflict_response(conflicts)

    rule = RecurrenceRule(
        org_id=room.org_id,
        room_id=room.id,
        user_id=user.id,
        frequency=body.frequency,
        start_time=body.start_time,
        end_time=body.end_time,
        until_date=body.until_date,
        notes=body.notes,
        is_active=True,
    )
    db.add(rule)
    await db.flush()

    bookings = _build_bookings(rule=rule, room=room, occurrences=occurrences)
    db.add_all(bookings)
    try:
        await db.flush()
    except IntegrityError:
        # Lost a race with a concurrent booking or series. The rule and every
        # occurrence go with the rollback — all-or-nothing holds even here.
        await db.rollback()
        conflicts = await _find_conflicts(db, body.room_id, occurrences)
        return _conflict_response(conflicts or [occ[0] for occ in occurrences])

    booking_ids = [b.id for b in bookings]
    await db.refresh(rule)
    created = await _load_bookings(db, booking_ids)

    return RecurrenceWithBookingsOut(
        recurrence=RecurrenceOut.model_validate(rule),
        bookings=[BookingOut.model_validate(b) for b in created],
    )


@router.put("/{recurrence_id}")
async def update_recurrence(
    recurrence_id: uuid.UUID,
    body: RecurrenceUpdate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Move a series to new times, all-or-nothing.

    Only occurrences that have not started yet are replaced. Anything already
    under way or in the past keeps its row untouched — an edit is not a way to
    rewrite history, and a `completed` booking is a record of something that
    happened.
    """
    rule = await _get_own_rule(db, recurrence_id, user)
    if not rule.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This series has been cancelled",
        )

    await _require_membership(db, user, rule.org_id)
    result = await db.execute(
        select(Room).where(Room.id == rule.room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    until_date = body.until_date or rule.until_date
    occurrences = _validate_window(
        body.start_time, body.end_time, until_date, rule.frequency, allow_past_anchor=True
    )

    await _lock_room(db, rule.room_id)

    now = datetime.now(tz=timezone.utc)
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.space))
        .where(
            Booking.recurrence_rule_id == rule.id,
            Booking.status.in_(ACTIVE_STATUSES),
            Booking.start_time > now,
        ).order_by(Booking.id).with_for_update().execution_options(populate_existing=True)
    )
    replaceable = list(result.scalars().all())
    for booking in replaceable:
        validate_cancellation(booking, now)

    conflicts = await _find_conflicts(
        db, rule.room_id, occurrences, ignore_booking_ids=[b.id for b in replaceable]
    )
    if conflicts:
        await db.rollback()
        return _conflict_response(conflicts)

    staged_tasks = BackgroundTasks()
    for booking in replaceable:
        await apply_cancellation(db, booking, user, staged_tasks, email_gateway, lock_gateway)
    # Flush before inserting: a cancelled row falls outside the partial EXCLUDE
    # index, so the slots are released before their replacements claim them.
    await db.flush()

    rule.start_time = body.start_time
    rule.end_time = body.end_time
    rule.until_date = until_date

    room_id = room.id
    bookings = _build_bookings(rule=rule, room=room, occurrences=occurrences)
    db.add_all(bookings)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        conflicts = await _find_conflicts(db, room_id, occurrences)
        return _conflict_response(conflicts or [occ[0] for occ in occurrences])

    booking_ids = [b.id for b in bookings]
    await db.refresh(rule)
    created = await _load_bookings(db, booking_ids)

    background_tasks.tasks.extend(staged_tasks.tasks)
    return RecurrenceWithBookingsOut(
        recurrence=RecurrenceOut.model_validate(rule),
        bookings=[BookingOut.model_validate(b) for b in created],
    )


@router.delete("/{recurrence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_recurrence(
    recurrence_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    from_date: date | None = Query(
        None,
        description="Cancel occurrences starting on or after this date (UTC). "
        "Defaults to now, i.e. every remaining occurrence.",
    ),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Cancel the rest of the series ("this and all future").

    Cancelling a single occurrence is `DELETE /bookings/{id}` — that endpoint
    already does the right thing for a series member and leaves the rule alone.
    """
    rule = await _get_own_rule(db, recurrence_id, user)
    await _lock_room(db, rule.room_id)

    now = datetime.now(tz=timezone.utc)
    cutoff = max(
        datetime.combine(from_date, time.min, tzinfo=timezone.utc) if from_date else now,
        now,
    )
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.space))
        .where(
            Booking.recurrence_rule_id == rule.id,
            Booking.start_time >= cutoff,
            Booking.status.in_(ACTIVE_STATUSES),
        )
        .order_by(Booking.id).with_for_update().execution_options(populate_existing=True)
    )
    bookings = list(result.scalars().all())
    for booking in bookings:
        validate_cancellation(booking, now)
    for booking in bookings:
        await apply_cancellation(db, booking, user, background_tasks, email_gateway, lock_gateway)
    rule.is_active = False
