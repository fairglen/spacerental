from datetime import datetime, timedelta

from fastapi import BackgroundTasks, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import cancellation_credit, clock, email, package_hours
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
    previous = booking.status
    booking.status = BookingStatus.cancelled

    # The pack's share of the booking goes back on the package: all of a
    # `package` booking, the prepaid part of a `mixed` one (C13), nothing for
    # `hourly`. Same transaction as the status change: the booking is never
    # cancelled without the credit, and never credited twice — the
    # already-cancelled guard above is what makes a repeat call a 400 rather
    # than a second credit. Money is not touched here, for any method.
    now = clock.utcnow()
    await package_hours.settle_status_change(
        db, booking, previous=previous, new=BookingStatus.cancelled, now=now
    )
    # The money share comes back as hours in the bank (K01), in the same
    # transaction, never as a refund (O02 superseded).
    try:
        credit = await cancellation_credit.create_credit(db, booking, previous=previous, now=now)
    except cancellation_credit.CreditTooLargeError as exc:
        # Only an operator's price override can get here; the request fails
        # whole (the status change above rolls back with it).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"The credit for this booking ({exc.hours} h) exceeds what the hour bank "
                f"can hold ({cancellation_credit.MAX_LEDGER_HOURS} h); contact the space"
            ),
        ) from None

    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.booking_cancellation_email(
            to=user.email,
            space_name=booking.room.space.name,
            room_name=booking.room.name,
            start_time=booking.start_time,
            end_time=booking.end_time,
            credit_hours=credit.hours_total if credit is not None else None,
            credit_expires_at=credit.expires_at if credit is not None else None,
        ),
    )

    # Series edits stage these tasks until replacement rows have flushed. A
    # rolled-back edit must not revoke access to the original valid bookings.
    background_tasks.add_task(try_revoke_access_code, lock_gateway, booking_id=booking.id)
