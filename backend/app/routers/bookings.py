import uuid
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app import email, package_hours
from app.auth import get_current_user
from app.booking_cancellation import apply_cancellation, validate_cancellation
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import LockGateway, attach_access_codes, get_lock_gateway, try_issue_access_code
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.space import Room
from app.models.organization import OrganizationMember
from app.models.user import User
from app.payments import (
    CheckoutKind,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.booking import BookingOut, BookingCreate, BookingCheckoutOut

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
    # Fetch room
    result = await db.execute(
        select(Room)
        .options(selectinload(Room.space))
        .where(Room.id == body.room_id, Room.is_active == True)  # noqa: E712
    )
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Validate times
    if body.end_time <= body.start_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_time must be after start_time",
        )

    # Overlap check
    result = await db.execute(
        select(Booking).where(
            and_(
                Booking.room_id == body.room_id,
                Booking.status.in_([BookingStatus.confirmed, BookingStatus.pending]),
                Booking.start_time < body.end_time,
                Booking.end_time > body.start_time,
            )
        )
    )
    conflicting = result.scalar_one_or_none()
    if conflicting is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        )

    # Calculate duration and cost
    delta = body.end_time - body.start_time
    duration_hours = Decimal(str(round(delta.total_seconds() / 3600, 2)))
    total_amount = duration_hours * room.hourly_rate

    # Resolve org membership (user must be a member of this room's org)
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

    pays_with_package = body.payment_method is PaymentMethod.package
    purchase_id: uuid.UUID | None = None
    if pays_with_package:
        purchase = await package_hours.redeem_hours(
            db,
            user_id=user.id,
            org_id=room.org_id,
            hours=duration_hours,
            now=datetime.now(tz=timezone.utc),
        )
        if purchase is None:
            # Nothing was deducted and no booking exists yet — the request is
            # refused before anything is written.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"No active package with {duration_hours} hours remaining"
                ),
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
    except IntegrityError:
        # Race with a concurrent booking — DB-level EXCLUDE constraint caught it.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This time slot is already booked",
        )

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
        select(Booking)
        .options(selectinload(Booking.room))
        .where(Booking.id == booking.id)
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

    return BookingCheckoutOut(
        booking=BookingOut.model_validate(booking), checkout_url=checkout_url
    )


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

    validate_cancellation(booking, datetime.now(tz=timezone.utc))
    await apply_cancellation(db, booking, user, background_tasks, email_gateway, lock_gateway)
