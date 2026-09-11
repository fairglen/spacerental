import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import email, package_hours
from app.auth import get_current_user
from app.booking_cancellation import apply_cancellation, validate_cancellation
from app.booking_validity import (
    MAX_BOOKING_DURATION,
    has_conflicting_booking,
    is_lost_slot_race,
    is_within_open_hours,
)
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import LockGateway, attach_access_codes, get_lock_gateway, try_issue_access_code
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember
from app.models.space import Room
from app.models.user import User
from app.payments import (
    CheckoutKind,
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

    if body.start_time < datetime.now(tz=UTC):
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

    # Overlap check — existence only. A prior version used
    # `scalar_one_or_none()` on the matching rows themselves, which raised an
    # unhandled `MultipleResultsFound` (500) whenever a request overlapped two
    # or more existing bookings instead of the intended 409.
    if await has_conflicting_booking(db, body.room_id, body.start_time, body.end_time):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        )

    # Calculate duration and cost
    delta = body.end_time - body.start_time
    duration_hours = Decimal(str(round(delta.total_seconds() / 3600, 2)))
    total_amount = duration_hours * room.hourly_rate

    pays_with_package = body.payment_method is PaymentMethod.package
    purchase_id: uuid.UUID | None = None
    if pays_with_package:
        purchase = await package_hours.redeem_hours(
            db,
            user_id=user.id,
            org_id=room.org_id,
            hours=duration_hours,
            now=datetime.now(tz=UTC),
        )
        if purchase is None:
            # Nothing was deducted and no booking exists yet — the request is
            # refused before anything is written.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(f"No active package with {duration_hours} hours remaining"),
            )
        purchase_id = purchase.id

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
        payment_method=body.payment_method,
        package_purchase_id=purchase_id,
        notes=body.notes,
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
                description=f"{room.name} — {duration_hours}h",
                kind=CheckoutKind.booking,
                reference_id=booking.id,
                org_id=booking.org_id,
            )
        except PaymentProviderError as exc:
            # Nothing is committed: get_db rolls back on the raised exception,
            # so no unpayable booking is left holding the slot.
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

    validate_cancellation(booking, datetime.now(tz=UTC))
    await apply_cancellation(db, booking, user, background_tasks, email_gateway, lock_gateway)
