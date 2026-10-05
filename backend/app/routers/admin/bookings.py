"""Operator booking management (A01, G04, H03, K01): list, page, change/move/cancel, create, mark
paid, hard delete.
"""

import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import String, and_, func, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, cancellation_credit, clock, deletion, email, package_hours
from app.auth import require_admin
from app.booking_validity import (
    MAX_BOOKING_DURATION,
    expire_stale_holds,
    has_conflicting_booking,
    is_lost_slot_race,
    is_within_open_hours,
    violated_constraint,
)
from app.config import settings
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import (
    LockGateway,
    attach_access_codes,
    get_lock_gateway,
    try_issue_access_code,
    try_revoke_access_code,
)
from app.models.audit import AdminAction
from app.models.booking import PAID_AT_CHECKOUT, Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember
from app.models.package import BookingPackageDebit
from app.models.space import Room
from app.models.user import User
from app.payments import (
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.audit import AdminActionOut
from app.schemas.booking import (
    AdminBookingCreate,
    AdminBookingDetailOut,
    AdminBookingOut,
    BookingStatusUpdate,
    CancellationCreditOut,
    MarkPaidBody,
)

from ._common import _WITH_DEBITS, _locked_booking, _room_in_org

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ─── Bookings ─────────────────────────────────────────────────────────────────


BookingSort = Literal["start_time", "-start_time", "created_at", "-created_at"]


@router.get("/bookings")
async def admin_list_bookings(
    org_id: uuid.UUID = Query(...),
    room_id: uuid.UUID | None = Query(None),
    booking_status: BookingStatus | None = Query(None, alias="status"),
    payment_method: PaymentMethod | None = Query(None),
    q: str | None = Query(None, max_length=200),
    from_date: AwareDatetime | None = Query(None, alias="from"),
    to_date: AwareDatetime | None = Query(None, alias="to"),
    include_cancelled: bool = Query(True),
    sort: BookingSort = Query("-start_time"),
    page: int = Query(1, ge=1, le=1_000_000),
    page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """The org's bookings (G04 filters): `q` matches the customer's name or
    email, or the booking's short id; `include_cancelled=false` hides the
    cancelled rows; `sort` is start_time|created_at, `-` for newest first."""
    filters = [Booking.org_id == org_id]
    if room_id:
        filters.append(Booking.room_id == room_id)
    if booking_status:
        filters.append(Booking.status == booking_status)
    if payment_method:
        filters.append(Booking.payment_method == payment_method)
    if from_date:
        filters.append(Booking.start_time >= from_date)
    if to_date:
        filters.append(Booking.end_time <= to_date)
    if not include_cancelled:
        filters.append(Booking.status != BookingStatus.cancelled)
    query = select(Booking)
    if q and q.strip():
        needle = q.strip().lower()
        query = query.join(User, User.id == Booking.user_id)
        filters.append(
            or_(
                func.lower(User.email).like(f"%{needle}%"),
                func.lower(User.name).like(f"%{needle}%"),
                func.replace(func.cast(Booking.id, String), "-", "").like(f"{needle}%"),
            )
        )
    column = Booking.created_at if sort.endswith("created_at") else Booking.start_time
    order = column.asc() if not sort.startswith("-") else column.desc()

    total_result = await db.execute(
        select(func.count()).select_from(query.where(and_(*filters)).subquery())
    )
    total = total_result.scalar_one()

    result = await db.execute(
        query.options(selectinload(Booking.room), selectinload(Booking.user), _WITH_DEBITS)
        .where(and_(*filters))
        .order_by(order, Booking.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    bookings = result.scalars().all()
    attach_access_codes(lock_gateway, bookings)
    return {
        "bookings": [AdminBookingOut.model_validate(b) for b in bookings],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/bookings/{booking_id}")
async def admin_get_booking(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """One booking for its page (G04): customer, room, payment (method,
    amount, pack debits, Stripe session id), access code, both notes, the
    hold deadline, and its last twenty trail rows."""
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking_id, Booking.org_id == org_id)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    attach_access_codes(lock_gateway, booking)
    history = (
        (
            await db.execute(
                select(AdminAction)
                .options(selectinload(AdminAction.actor))
                .where(
                    AdminAction.org_id == org_id,
                    AdminAction.entity_type == "booking",
                    AdminAction.entity_id == booking.id,
                )
                .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
                .limit(20)
            )
        )
        .scalars()
        .all()
    )
    out = AdminBookingDetailOut.model_validate(booking)
    credit = await cancellation_credit.existing_credit(db, booking.id)
    if credit is not None:
        out.cancellation_credit = CancellationCreditOut.model_validate(credit)
    return {
        "booking": out,
        "history": [AdminActionOut.model_validate(a) for a in history],
    }


async def _validate_slot(
    db: AsyncSession,
    room_id: uuid.UUID,
    start: datetime,
    end: datetime,
    now: datetime,
    *,
    original_start: datetime | None = None,
) -> None:
    """The same rules a customer booking passes — minus the 24h rule, which is
    a customer's, not an operator's (A01), and minus the booking window (H01).

    The past rule is an operator's (H03 b): a booking that has already
    started may keep its start (or be said to have started later) while the
    end or the room changes; only moving the START to before both now and
    where it was is refused. The end must still lie ahead. Without an
    `original_start` (a new booking) the start itself must lie ahead.
    """
    if end <= start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time must be after start_time"
        )
    floor = now if original_start is None else min(now, original_start)
    if start < floor:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="start_time cannot be in the past"
        )
    if end <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="end_time cannot be in the past"
        )
    if end - start > MAX_BOOKING_DURATION:
        max_hours = int(MAX_BOOKING_DURATION.total_seconds() // 3600)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Booking duration cannot exceed {max_hours} hours",
        )
    if not await is_within_open_hours(db, room_id, start, end):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Requested time is outside the room's opening hours",
        )


def _duration(start: datetime, end: datetime) -> Decimal:
    return Decimal(str(round((end - start).total_seconds() / 3600, 2)))


async def _confirm_side_effects(
    booking: Booking,
    *,
    background_tasks: BackgroundTasks,
    email_gateway: EmailGateway,
    lock_gateway: LockGateway,
    changed: bool = False,
) -> None:
    """What every confirmation does: the email and the access code.

    Shared by a customer-paid confirmation (webhook), an operator confirm, a
    manual booking and mark-paid, so none of them can drift.
    """
    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.booking_confirmation_email(
            to=booking.user.email,
            space_name=booking.room.space.name,
            room_name=booking.room.name,
            start_time=booking.start_time,
            end_time=booking.end_time,
            changed=changed,
        ),
    )
    # Best-effort — a Seam outage must not block an operator (Epic 3.3).
    await try_issue_access_code(
        lock_gateway,
        booking_id=booking.id,
        room_id=booking.room_id,
        name=f"Reserva {booking.id} — {booking.room.name}",
        starts_at=booking.start_time,
        ends_at=booking.end_time,
    )


@router.put("/bookings/{booking_id}")
async def admin_update_booking(
    booking_id: uuid.UUID,
    body: BookingStatusUpdate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Change a booking's status, move it (time and/or room), or note it (A01).

    A move on a paid booking changes NO money: the old and new hour counts are
    returned as `hours` and the operator settles the difference with the
    customer outside the platform. Known limitation, recorded in TODO A01.
    The PACK share does follow the new length (H03): shrinking credits the
    surplus back to the purchases it came from, growing draws the extra from
    the customer's hour bank, and `hours.uncovered` says what the bank could
    not give.
    """
    booking = await _locked_booking(db, booking_id, org_id)
    now = clock.utcnow()
    previous_status = booking.status
    hours_before = booking.duration_hours
    before = audit.snapshot(booking)
    response: dict = {}

    if body.admin_note is not None or "admin_note" in body.model_fields_set:
        booking.admin_note = body.admin_note
    if "notes" in body.model_fields_set:
        booking.notes = body.notes
    overridden = False
    if "total_amount" in body.model_fields_set:
        # The price override (G04): the recorded amount changes, no charge and
        # no refund is made; the reason goes to the trail.
        overridden = booking.total_amount != body.total_amount
        booking.total_amount = body.total_amount

    moved = False
    if body.moves:
        room = booking.room
        if body.room_id is not None and body.room_id != booking.room_id:
            room = await _room_in_org(db, body.room_id, org_id)
        start = body.start_time or booking.start_time
        end = body.end_time or booking.end_time
        await _validate_slot(db, room.id, start, end, now, original_start=booking.start_time)
        if booking.status in (BookingStatus.confirmed, BookingStatus.pending):
            await expire_stale_holds(db, room.id, start, end, now)
            # That bulk update may have flipped THIS row: a lapsed hold that
            # still read `pending` and overlaps its own new slot. Its pack
            # share is back on the purchases now; the settle below and the
            # status logic must see what the row really is, or the hours
            # would be credited twice (shrink) or drawn for a row that holds
            # nothing (grow), and the row written back as `pending`.
            await db.refresh(booking, attribute_names=["status", "hold_expires_at"])
            previous_status = booking.status
            if await has_conflicting_booking(
                db, room.id, start, end, exclude_booking_id=booking.id, now=now
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
                )
        booking.room_id = room.id
        booking.start_time = start
        booking.end_time = end
        new_duration = _duration(start, end)
        # The pack share follows the new length through the hour bank (H03);
        # `total_amount` deliberately does not: no charge and no credit is ever
        # created here (O02 owns money movement). `hours` tells the operator
        # what changed and what the bank could not cover.
        try:
            uncovered = await package_hours.settle_moved_booking(
                db, booking, new_duration=new_duration, now=now
            )
        except DBAPIError as exc:
            # Losing a lock race with a concurrent walk is a retry, not a 500.
            if not is_lost_slot_race(exc):
                raise
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The customer's packs are being used right now; try again",
            ) from None
        booking.duration_hours = new_duration
        moved = True
        response["hours"] = {
            "before": f"{hours_before:.2f}",
            "after": f"{booking.duration_hours:.2f}",
        }
        if uncovered > 0:
            response["hours"]["uncovered"] = f"{uncovered:.2f}"

    new_status = body.status if body.status is not None else previous_status
    slot_holding = (BookingStatus.confirmed, BookingStatus.pending)
    entering_slot = (
        new_status != previous_status
        and new_status in slot_holding
        and previous_status not in slot_holding
    )
    if entering_slot:
        # Same reconciliation every slot-acquiring write does (C03): a lapsed
        # unpaid hold is free to us but still counted by the EXCLUDE
        # constraint until it is flipped to `expired`.
        await expire_stale_holds(db, booking.room_id, booking.start_time, booking.end_time, now)
        if await has_conflicting_booking(
            db,
            booking.room_id,
            booking.start_time,
            booking.end_time,
            exclude_booking_id=booking.id,
            now=now,
        ):
            # A cancelled/completed booking's slot may have been sold again
            # since it let go of it. Reinstating must not silently create the
            # double-booking the customer-facing path would have rejected.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
            )

    # An admin status change moves the pack's share exactly like every other
    # transition does (`package_hours.settle_status_change`): returned when the
    # booking stops holding its slot, taken again when it is reinstated — or an
    # admin-cancelled booking would silently burn the customer's hours, and a
    # cancel/re-confirm round trip would hand out a free one. Re-debiting can
    # fail honestly: the returned hours may already be spent elsewhere.
    if not await package_hours.settle_status_change(
        db, booking, previous=previous_status, new=new_status, now=now
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=("The package no longer has enough hours to reinstate this booking"),
        )

    # K01: a cancelled booking's paid hours live in the bank. Reinstating it
    # takes them back — unless the customer already spent some, in which case
    # the reinstatement is refused and a new booking is the way.
    if previous_status is BookingStatus.cancelled and new_status in (
        BookingStatus.confirmed,
        BookingStatus.completed,
        BookingStatus.pending,
    ):
        try:
            await cancellation_credit.reverse_credit(db, booking.id)
        except cancellation_credit.CreditSpentError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "The hours credited for this cancellation were already used; "
                    "make a new booking instead"
                ),
            ) from None

    booking.status = new_status
    # Keep the hold marker consistent with the new status (C03): a one-off
    # revived as `pending` is an unpaid hold again and needs a fresh deadline
    # (a series occurrence stays deadline-less for the operator); any other
    # status holds no checkout hold.
    if new_status is BookingStatus.pending:
        payable_hold = (
            booking.payment_method in PAID_AT_CHECKOUT and booking.recurrence_rule_id is None
        )
        if payable_hold and previous_status is not BookingStatus.pending:
            booking.hold_expires_at = now + timedelta(minutes=settings.BOOKING_HOLD_MINUTES)
        elif not payable_hold:
            booking.hold_expires_at = None
        # An already-pending hold keeps its deadline: re-asserting `pending`
        # must not let an operator keep an abandoned hold alive indefinitely.
    else:
        booking.hold_expires_at = None

    try:
        await db.flush()
    except DBAPIError as exc:
        # The EXCLUDE constraint is the last line against a concurrent write
        # into the slot this move or reinstatement is taking. Any other
        # constraint is a refused write, reported by name (H03) — never a 500.
        constraint = violated_constraint(exc)
        if constraint is not None:
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"The change violates a constraint ({constraint})",
            ) from None
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    await db.refresh(booking)
    # Re-attach the relationships the refresh expired (the email needs them),
    # against the room the booking is in NOW.
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()

    if new_status != previous_status and new_status is BookingStatus.confirmed:
        await _confirm_side_effects(
            booking,
            background_tasks=background_tasks,
            email_gateway=email_gateway,
            lock_gateway=lock_gateway,
        )
    elif new_status != previous_status and new_status is BookingStatus.cancelled:
        # The paid hours go to the customer's bank (K01) unless the operator
        # unticked it, with a reason the trail keeps.
        credit = None
        if body.credit_hours:
            try:
                credit = await cancellation_credit.create_credit(
                    db, booking, previous=previous_status, now=now
                )
            except cancellation_credit.CreditTooLargeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"The credit ({exc.hours} h) exceeds what the hour bank can hold "
                        f"({cancellation_credit.MAX_LEDGER_HOURS} h); lower the booking's "
                        "amount first, or cancel with credit_hours: false and a reason"
                    ),
                ) from None
        if credit is not None:
            response["credit"] = {
                "id": str(credit.id),
                "hours": f"{credit.hours_total:.2f}",
                "expires_at": credit.expires_at.isoformat(),
            }
        email.enqueue_email(
            background_tasks,
            email_gateway,
            email.booking_cancellation_email(
                to=booking.user.email,
                space_name=booking.room.space.name,
                room_name=booking.room.name,
                start_time=booking.start_time,
                end_time=booking.end_time,
                credit_hours=credit.hours_total if credit is not None else None,
                credit_expires_at=credit.expires_at if credit is not None else None,
            ),
        )
        await try_revoke_access_code(lock_gateway, booking_id=booking.id)
    elif moved and booking.status is BookingStatus.confirmed:
        # A confirmed booking that changed time or room: the confirmation
        # again, with the new details and one line saying it was altered, and
        # an access code for the new window.
        await try_revoke_access_code(lock_gateway, booking_id=booking.id)
        await _confirm_side_effects(
            booking,
            background_tasks=background_tasks,
            email_gateway=email_gateway,
            lock_gateway=lock_gateway,
            changed=True,
        )

    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action=_booking_action(previous_status, new_status, moved, overridden),
        before=before,
        after=audit.snapshot(booking),
        reason=body.reason,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking), **response}


def _booking_action(
    previous: BookingStatus, new: BookingStatus, moved: bool, overridden: bool = False
) -> str:
    """The verb the trail shows for a generic booking update."""
    if overridden and new == previous and not moved:
        return "price.override"
    if new != previous:
        return {
            BookingStatus.cancelled: "cancel",
            BookingStatus.confirmed: "confirm",
            BookingStatus.completed: "complete",
        }.get(new, f"status.{new.value}")
    return "move" if moved else "update"


@router.post("/bookings", status_code=status.HTTP_201_CREATED)
async def admin_create_booking(
    body: AdminBookingCreate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """A booking made by the operator for a customer, paid or arranged outside
    the platform (`manual`): confirmed at once, with code and email (A01)."""
    room = await _room_in_org(db, body.room_id, org_id)
    # The customer must be a member of THIS org: the same rule the customer
    # path applies to itself, and the only link between a user and a tenant.
    member = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == body.user_id, OrganizationMember.org_id == org_id
        )
    )
    if member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found in this organization"
        )
    now = clock.utcnow()
    await _validate_slot(db, room.id, body.start_time, body.end_time, now)
    await expire_stale_holds(db, room.id, body.start_time, body.end_time, now)
    if await has_conflicting_booking(db, room.id, body.start_time, body.end_time, now=now):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        )

    duration = _duration(body.start_time, body.end_time)
    booking = Booking(
        org_id=org_id,
        room_id=room.id,
        user_id=body.user_id,
        start_time=body.start_time,
        end_time=body.end_time,
        duration_hours=duration,
        # The slot's value, for the record; nothing is charged through here.
        total_amount=duration * room.hourly_rate,
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.manual,
        notes=body.notes,
        admin_note=body.admin_note,
        hold_expires_at=None,
    )
    db.add(booking)
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="create.manual",
        after=audit.snapshot(booking),
    )
    await _confirm_side_effects(
        booking,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking)}


@router.post("/bookings/{booking_id}/mark-paid")
async def admin_mark_booking_paid(
    booking_id: uuid.UUID,
    body: MarkPaidBody,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """An unpaid hourly/mixed hold the customer paid some other way (cash, MB
    WAY): confirmed as `manual`, with code and email (A01). The open Checkout
    Session is expired at the provider first, and the row loses its session
    id, so a late `checkout.session.completed` can no longer match it — the
    webhook looks bookings up by session id.
    """
    booking = await _locked_booking(db, booking_id, org_id)
    now = clock.utcnow()
    before = audit.snapshot(booking)
    live_or_lapsed_hold = booking.status in (BookingStatus.pending, BookingStatus.expired) and (
        booking.hold_expires_at is not None or booking.status is BookingStatus.expired
    )
    if booking.payment_method not in PAID_AT_CHECKOUT or not live_or_lapsed_hold:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Booking is {booking.status.value} ({booking.payment_method.value})"
                " and cannot be marked as paid"
            ),
        )
    if booking.status is BookingStatus.expired:
        # Its slot was released; take it again, like "Pagar agora" does.
        await expire_stale_holds(db, booking.room_id, booking.start_time, booking.end_time, now)
        if await has_conflicting_booking(
            db,
            booking.room_id,
            booking.start_time,
            booking.end_time,
            exclude_booking_id=booking.id,
            now=now,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
            )
    if booking.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not close the payment session",
            ) from exc
        booking.stripe_checkout_session_id = None

    # A lapsed mixed hold gave its pack hours back; confirming takes them again.
    if not await package_hours.settle_status_change(
        db, booking, previous=booking.status, new=BookingStatus.confirmed, now=now
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The package no longer has the hours this booking reserved",
        )
    booking.status = BookingStatus.confirmed
    booking.payment_method = PaymentMethod.manual
    booking.hold_expires_at = None
    stamp = f"Marcada como paga: {body.reason}"
    booking.admin_note = f"{booking.admin_note}\n{stamp}" if booking.admin_note else stamp
    try:
        await db.flush()
    except DBAPIError as exc:
        if not is_lost_slot_race(exc):
            raise
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This time slot is already booked"
        ) from None
    result = await db.execute(
        select(Booking)
        .options(
            selectinload(Booking.room).selectinload(Room.space),
            selectinload(Booking.user),
            _WITH_DEBITS,
        )
        .where(Booking.id == booking.id)
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="mark_paid",
        before=before,
        after=audit.snapshot(booking),
        reason=body.reason,
    )
    await _confirm_side_effects(
        booking,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    attach_access_codes(lock_gateway, booking)
    return {"booking": AdminBookingOut.model_validate(booking)}


@router.delete("/bookings/{booking_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_booking(
    booking_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    reason: str | None = Query(default=None, max_length=2000),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    """Hard delete (G02): "delete" is cancel. Only a booking that never held
    money and holds no pack hours may go: an expired hold; a cancelled one
    with amount 0 and no debit rows; or an operator's `manual` booking, with
    a reason. Anything else is a 409 "cancel instead". An expired hold's
    Checkout Session is still payable (the webhook accepts a late payment,
    C03), so it is expired at the provider first — a session that already
    completed keeps the row (409). The trail keeps the whole booking."""
    booking = await _locked_booking(db, booking_id, org_id)
    deletion.require_confirm(confirm, booking.id)
    debits = await db.scalar(
        select(func.count())
        .select_from(BookingPackageDebit)
        .where(BookingPackageDebit.booking_id == booking.id)
    )
    if booking.payment_method is PaymentMethod.manual:
        if not (reason or "").strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A reason is required to delete a manual booking",
            )
        allowed = debits == 0
    else:
        allowed = booking.status is BookingStatus.expired or (
            booking.status is BookingStatus.cancelled and booking.total_amount == 0 and debits == 0
        )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This booking held money or pack hours; cancel it instead",
        )
    if booking.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(booking.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this booking; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not close the payment session",
            ) from exc
    before = audit.snapshot(booking)
    await db.delete(booking)
    await db.flush()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=booking,
        action="delete",
        before=before,
        reason=(reason or "").strip() or None,
    )
    await try_revoke_access_code(lock_gateway, booking_id=booking.id)
