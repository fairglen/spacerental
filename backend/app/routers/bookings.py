import uuid
from datetime import timedelta
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock, email, package_hours
from app.auth import get_current_user
from app.booking_cancellation import apply_cancellation, validate_cancellation
from app.booking_validity import (
    MAX_BOOKING_DURATION,
    expire_stale_holds,
    expire_user_holds,
    has_conflicting_booking,
    is_lost_slot_race,
    is_within_open_hours,
)
from app.config import settings
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import LockGateway, attach_access_codes, get_lock_gateway, try_issue_access_code
from app.models.booking import PAID_AT_CHECKOUT, Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember
from app.models.space import Room
from app.models.user import User
from app.payments import (
    CheckoutKind,
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.booking import BookingCheckoutOut, BookingCreate, BookingOut

router = APIRouter(prefix="/bookings", tags=["bookings"])


@router.get("/me")
async def my_bookings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """List current user's bookings."""
    # Expiry is lazy (no sweeper): reconcile the caller's own lapsed holds so
    # the dashboard shows `expired` rather than a pending row that no longer
    # blocks anything (C03), and a lapsed mixed hold's pack hours are back on
    # the pack (C13).
    await expire_user_holds(db, user.id, clock.utcnow())
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room))
        .where(Booking.user_id == user.id)
        .order_by(Booking.start_time.desc())
    )
    bookings = result.scalars().all()
    attach_access_codes(lock_gateway, bookings)
    return {"bookings": [BookingOut.model_validate(b) for b in bookings]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_booking(
    body: BookingCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Create a new booking. Checks for time overlap before inserting.

    Two payment paths:

    * `hourly` — the booking is created `pending` alongside a Checkout Session;
      only the `checkout.session.completed` webhook promotes it to `confirmed`.
      It holds the slot meanwhile — the overlap check counts pending bookings.
    * `package` — prepaid hours are debited from an active purchase in the same
      transaction and the booking is `confirmed` immediately. There is nothing
      left to pay, so the response carries no `checkout_url`, and the
      confirmation email is sent from here rather than from the webhook.
    * `mixed` (C13) — "use my pack and pay the rest". The server alone decides
      the split: a pack that covers the whole block makes it a `package`
      booking; otherwise the soonest-expiring pack gives what it has, that
      share is reserved now, and only the remaining hours go to Checkout as a
      `pending` hold; with no usable hours at all it is a plain `hourly` one.
      The reserved hours return whenever the hold ends without being paid.
    """
    # Fetch room. Space.is_active is checked alongside Room.is_active — a room
    # under a deactivated space is just as unbookable, and the public listing
    # (GET /spaces/{id}) already hides it, so treating it as "not found" here
    # matches what the customer could ever have seen to book it from.
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.space))
        .where(Room.id == body.room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None or not room.space.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Resolve org membership (user must be a member of this room's org).
    # This must run before any other validation: a user who isn't a member of
    # this room's org has no business right to learn *why* a slot they picked
    # is invalid (past, closed, or conflicting) — that's information about
    # another org's calendar. Checking membership first means probing those
    # checks for a room you don't belong to always ends the same way, 403,
    # rather than leaking 400/409 detail before the org check ever runs.
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.org_id == room.org_id,
        )
    )
    membership = result.scalar_one_or_none()
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    # Validate times
    if body.end_time <= body.start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_time must be after start_time",
        )

    now = clock.utcnow()
    if body.start_time < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_time cannot be in the past",
        )

    # Defensive technical bound, not a product decision about how long a
    # booking may be (that's a future call, not this one) — it exists purely
    # to keep `is_within_open_hours`'s one-query-per-calendar-day loop from
    # being handed an attacker-controlled range spanning months or years.
    if body.end_time - body.start_time > MAX_BOOKING_DURATION:
        max_hours = int(MAX_BOOKING_DURATION.total_seconds() // 3600)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking duration cannot exceed {max_hours} hours",
        )

    # Mirrors what BookingCalendar already offers: whole-hour slots inside an
    # AvailabilityRule window, with no closed gap (e.g. a lunch break) inside
    # the requested range. The API must not accept what the UI never would.
    if not await is_within_open_hours(db, body.room_id, body.start_time, body.end_time):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requested time is outside the room's opening hours",
        )

    # An abandoned hold whose deadline passed must not keep the slot (or trip
    # the EXCLUDE constraint below); flip it before checking for conflicts.
    await expire_stale_holds(db, body.room_id, body.start_time, body.end_time, now)

    # Overlap check — existence only. A prior version used
    # `scalar_one_or_none()` on the matching rows themselves, which raised an
    # unhandled `MultipleResultsFound` (500) whenever a request overlapped two
    # or more existing bookings instead of the intended 409.
    if await has_conflicting_booking(db, body.room_id, body.start_time, body.end_time, now=now):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        )

    # Calculate duration and cost
    delta = body.end_time - body.start_time
    duration_hours = Decimal(str(round(delta.total_seconds() / 3600, 2)))
    total_amount = duration_hours * room.hourly_rate

    # What the client asked for is only a request: the method stored, the pack
    # share and the amount charged are all decided here, from the ledger.
    # The schema admits customer methods only (`manual` is an operator's, A01)
    # and hands over a plain string; the identity checks below need the enum.
    method = PaymentMethod(body.payment_method)
    purchase_id: uuid.UUID | None = None
    package_hours_used = Decimal(0)
    if method is not PaymentMethod.hourly:
        # A lapsed mixed hold of this customer still has hours debited until
        # something reconciles it; do that before judging what they can spend.
        await expire_user_holds(db, user.id, now)
        purchase = await package_hours.redeem_hours(
            db,
            user_id=user.id,
            org_id=room.org_id,
            hours=duration_hours,
            now=now,
        )
        if purchase is not None:
            # One pack pays for everything, so nothing is left to charge — even
            # if a sooner-expiring pack holds a few hours (C13 decision 6).
            method = PaymentMethod.package
            purchase_id, package_hours_used = purchase.id, duration_hours
        elif method is PaymentMethod.package:
            # Nothing was deducted and no booking exists yet — the request is
            # refused before anything is written.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"No active package with {duration_hours} hours remaining"),
            )
        else:
            partial = await package_hours.redeem_up_to(
                db, user_id=user.id, org_id=room.org_id, hours=duration_hours, now=now
            )
            if partial is None:
                method = PaymentMethod.hourly
            else:
                purchase_id, package_hours_used = partial[0].id, partial[1]
                # A balance that grew between the two looks can cover it all.
                if package_hours_used == duration_hours:
                    method = PaymentMethod.package
                else:
                    # `total_amount` is the money charged: the uncovered hours.
                    total_amount = (duration_hours - package_hours_used) * room.hourly_rate

    pays_with_package = method is PaymentMethod.package

    booking = Booking(
        org_id=room.org_id,
        room_id=body.room_id,
        user_id=user.id,
        start_time=body.start_time,
        end_time=body.end_time,
        duration_hours=duration_hours,
        # The hourly value of the slot either way. Package bookings take no
        # fresh charge — the money arrived when the package was bought.
        total_amount=total_amount,
        status=BookingStatus.confirmed if pays_with_package else BookingStatus.pending,
        payment_method=method,
        package_purchase_id=purchase_id,
        package_hours_used=package_hours_used,
        notes=body.notes,
        hold_expires_at=None if pays_with_package else now + _hold_lifetime(),
    )
    db.add(booking)
    try:
        await db.flush()
    except DBAPIError as exc:
        # Race with a concurrent booking — DB-level EXCLUDE constraint caught
        # it (or, rarely, Postgres reported the same race as a deadlock; see
        # `is_lost_slot_race`). Anything else is a real fault, not a conflict.
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        ) from None

    checkout_url: str | None = None
    if not pays_with_package:
        try:
            session = await gateway.create_checkout_session(
                amount=total_amount,
                description=_checkout_description(booking, room.name),
                kind=CheckoutKind.booking,
                reference_id=booking.id,
                org_id=booking.org_id,
            )
        except PaymentProviderError as exc:
            # Nothing is committed: get_db rolls back on the raised exception,
            # so no unpayable booking is left holding the slot (or pack hours).
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not start the payment session",
            ) from exc
        booking.stripe_checkout_session_id = session.id
        checkout_url = session.url

    await db.flush()
    await db.refresh(booking)

    # Load room for response
    result = await db.execute(
        select(Booking).options(selectinload(Booking.room)).where(Booking.id == booking.id)
    )
    booking = result.scalar_one()

    if pays_with_package:
        # An `hourly` booking gets this from the webhook when it flips to
        # confirmed (Epic 4). A package booking never reaches the webhook, so
        # without this the only bookings that confirm silently would be the
        # prepaid ones.
        email.enqueue_email(
            background_tasks,
            email_gateway,
            email.booking_confirmation_email(
                to=user.email,
                space_name=room.space.name,
                room_name=room.name,
                start_time=booking.start_time,
                end_time=booking.end_time,
            ),
        )

        await try_issue_access_code(
            lock_gateway,
            booking_id=booking.id,
            room_id=booking.room_id,
            name=f"Reserva {booking.id} — {room.name}",
            starts_at=booking.start_time,
            ends_at=booking.end_time,
        )
    attach_access_codes(lock_gateway, booking)

    return BookingCheckoutOut(booking=BookingOut.model_validate(booking), checkout_url=checkout_url)


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_booking(
    booking_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Cancel own booking if start_time is more than 24h in the future."""
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.space))
        .where(Booking.id == booking_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one_or_none()

    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    if booking.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only cancel your own bookings",
        )

    validate_cancellation(booking, clock.utcnow())
    await apply_cancellation(db, booking, user, background_tasks, email_gateway, lock_gateway)


def _hold_lifetime() -> timedelta:
    return timedelta(minutes=settings.BOOKING_HOLD_MINUTES)


def _hours_label(hours: Decimal) -> str:
    # 7.00 -> "7h", 1.50 -> "1.5h"
    return f"{hours.normalize():f}h"


def _checkout_description(booking: Booking, room_name: str) -> str:
    """What the customer reads on the Checkout page, and later on a receipt."""
    if booking.payment_method is PaymentMethod.mixed:
        # Says what the amount is for AND why it is less than the block booked.
        paid = booking.duration_hours - booking.package_hours_used
        return (
            f"{_hours_label(paid)} {room_name} "
            f"({_hours_label(booking.package_hours_used)} pagas com o pack)"
        )
    return f"{room_name} — {booking.duration_hours}h"


@router.post("/{booking_id}/checkout")
async def resume_checkout(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Pay for an unpaid hold ("Pagar agora"), resuming or retrying it (C03).

    A live `pending` hold gets a fresh Checkout Session for the same row. An
    `expired` hold is retried: if its slot is still free it becomes `pending`
    again with a new deadline; if not, 409 and it stays `expired`. Either way
    the previous session is expired at the gateway first so a late completion
    of it cannot arrive, and no second booking row is ever created.
    """
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room))
        .where(Booking.id == booking_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if booking.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only pay for your own bookings",
        )

    now = clock.utcnow()
    live_hold = booking.status is BookingStatus.pending and (
        booking.hold_expires_at is None or booking.hold_expires_at > now
    )
    lapsed = booking.status is BookingStatus.expired or (
        booking.status is BookingStatus.pending and not live_hold
    )
    if booking.payment_method not in PAID_AT_CHECKOUT or not (live_hold or lapsed):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Booking is {booking.status.value} and has nothing to pay",
        )
    if booking.recurrence_rule_id is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Series occurrences are paid with the operator, not through Checkout",
        )
    if booking.start_time < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_time cannot be in the past",
        )

    if lapsed:
        await expire_stale_holds(db, booking.room_id, booking.start_time, booking.end_time, now)
        # That bulk update may just have flipped THIS row (a hold that lapsed
        # but still read `pending`), returning its pack share; the ORM copy is
        # stale, and the hours decision below needs the status the row has.
        await db.refresh(booking, attribute_names=["status"])
        if await has_conflicting_booking(
            db,
            booking.room_id,
            booking.start_time,
            booking.end_time,
            exclude_booking_id=booking.id,
            now=now,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This time slot is already booked",
            )

    if live_hold and booking.stripe_checkout_session_id:
        # Idempotent for a double submit: while the hold is live, hand back
        # the session that is already open instead of replacing it.
        try:
            open_url = await gateway.get_checkout_url(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not restart the payment session",
            ) from exc
        if open_url:
            attach_access_codes(lock_gateway, booking)
            return BookingCheckoutOut(
                booking=BookingOut.model_validate(booking), checkout_url=open_url
            )

    if booking.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            # Paid at the provider, webhook not yet delivered: keep the
            # session id so that webhook still confirms this row.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not restart the payment session",
            ) from exc

    # An expired mixed hold gave its pack hours back; holding the slot again
    # takes the same hours from the same pack, or the retry is refused. The
    # split and the price of an existing booking are never recomputed (C13).
    if not await package_hours.settle_status_change(
        db, booking, previous=booking.status, new=BookingStatus.pending, now=now
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The package no longer has the hours this booking reserved",
        )
    booking.status = BookingStatus.pending
    booking.hold_expires_at = now + _hold_lifetime()
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        ) from None

    try:
        session = await gateway.create_checkout_session(
            amount=booking.total_amount,
            description=_checkout_description(booking, booking.room.name),
            kind=CheckoutKind.booking,
            reference_id=booking.id,
            org_id=booking.org_id,
        )
    except PaymentProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the payment session",
        ) from exc
    booking.stripe_checkout_session_id = session.id
    await db.flush()
    await db.refresh(booking)
    attach_access_codes(lock_gateway, booking)
    return BookingCheckoutOut(booking=BookingOut.model_validate(booking), checkout_url=session.url)
