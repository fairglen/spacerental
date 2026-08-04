import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
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
):
    """List current user's bookings."""
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room))
        .where(Booking.user_id == user.id)
        .order_by(Booking.start_time.desc())
    )
    bookings = result.scalars().all()
    return {"bookings": [BookingOut.model_validate(b) for b in bookings]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_booking(
    body: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
):
    """Create a new booking. Checks for time overlap before inserting.

    The booking is created `pending` alongside a Checkout Session; only the
    `checkout.session.completed` webhook promotes it to `confirmed`. It holds
    the slot meanwhile — the overlap check counts pending bookings.
    """
    if body.payment_method is PaymentMethod.package:
        # Package redemption has no charge path yet — accepting it here would
        # hand out free bookings.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Paying with a package is not supported yet",
        )

    # Fetch room
    result = await db.execute(
        select(Room).where(Room.id == body.room_id, Room.is_active == True)  # noqa: E712
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

    booking = Booking(
        org_id=room.org_id,
        room_id=body.room_id,
        user_id=user.id,
        start_time=body.start_time,
        end_time=body.end_time,
        duration_hours=duration_hours,
        total_amount=total_amount,
        status=BookingStatus.pending,
        payment_method=PaymentMethod.hourly,
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

    try:
        session = await gateway.create_checkout_session(
            amount=total_amount,
            description=f"{room.name} — {duration_hours}h",
            kind=CheckoutKind.booking,
            reference_id=booking.id,
            org_id=booking.org_id,
        )
    except PaymentProviderError as exc:
        # Nothing is committed: get_db rolls back on the raised exception, so
        # no unpayable booking is left holding the slot.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the payment session",
        ) from exc
    booking.stripe_checkout_session_id = session.id
    await db.flush()
    await db.refresh(booking)

    # Load room for response
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room))
        .where(Booking.id == booking.id)
    )
    booking = result.scalar_one()

    return BookingCheckoutOut(
        booking=BookingOut.model_validate(booking), checkout_url=session.url
    )


@router.delete("/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_booking(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cancel own booking if start_time is more than 24h in the future."""
    result = await db.execute(
        select(Booking).where(Booking.id == booking_id)
    )
    booking = result.scalar_one_or_none()

    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    if booking.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only cancel your own bookings",
        )

    if booking.status in (BookingStatus.cancelled, BookingStatus.completed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking is already {booking.status.value}",
        )

    now = datetime.now(tz=timezone.utc)
    # booking.start_time is TIMESTAMPTZ — SQLAlchemy returns an aware UTC datetime.
    if booking.start_time - now < timedelta(hours=24):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bookings can only be cancelled more than 24 hours in advance",
        )

    booking.status = BookingStatus.cancelled
