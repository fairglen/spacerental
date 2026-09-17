from datetime import datetime, timedelta

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import email, package_hours
from app.email import EmailGateway
from app.locks import LockGateway, try_revoke_access_code
from app.models.booking import Booking, BookingStatus
from app.models.user import User


def validate_cancellation(booking: Booking, now: datetime) -> None:
    if booking.status in (BookingStatus.cancelled, BookingStatus.completed):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking is already {booking.status.value}",
        )

    if booking.status in (BookingStatus.expired, BookingStatus.paid_unfulfilled):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking is {booking.status.value} and holds no slot to cancel",
        )

    # An unpaid checkout hold (`pending` with a hold deadline) may always be
    # let go: nothing was paid, no hours were debited, and the slot is what
    # the customer wants to release (C03). Series occurrences are pending
    # without a deadline — the operator has reserved them — and keep the
    # 24h rule like every paid reservation.
    if booking.status is BookingStatus.pending and booking.hold_expires_at is not None:
        return

    # booking.start_time is TIMESTAMPTZ — SQLAlchemy returns an aware UTC datetime.
    if booking.start_time - now < timedelta(hours=24):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bookings can only be cancelled more than 24 hours in advance",
        )


async def apply_cancellation(
    db: AsyncSession,
    booking: Booking,
    user: User,
    background_tasks: BackgroundTasks,
    email_gateway: EmailGateway,
    lock_gateway: LockGateway,
) -> None:
    """Apply an already validated cancellation to a locked, eagerly loaded row."""
    booking.status = BookingStatus.cancelled

    if booking.package_purchase_id is not None:
        # Cancelling more than 24h out is free, so the hours go back on the
        # package. Same transaction as the status change: the booking is never
        # cancelled without the credit, and never credited twice — the
        # already-cancelled guard above is what makes a repeat call a 400
        # rather than a second refund.
        await package_hours.credit_hours(
            db,
            purchase_id=booking.package_purchase_id,
            hours=booking.duration_hours,
        )

    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.booking_cancellation_email(
            to=user.email,
            space_name=booking.room.space.name,
            room_name=booking.room.name,
            start_time=booking.start_time,
            end_time=booking.end_time,
        ),
    )

    # Series edits stage these tasks until replacement rows have flushed. A
    # rolled-back edit must not revoke access to the original valid bookings.
    background_tasks.add_task(try_revoke_access_code, lock_gateway, booking_id=booking.id)
