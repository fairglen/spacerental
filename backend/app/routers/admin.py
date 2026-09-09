import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import and_, distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import email, package_hours
from app.auth import require_admin
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import (
    LockGateway,
    attach_access_codes,
    get_lock_gateway,
    try_issue_access_code,
    try_revoke_access_code,
)
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.package import Package
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.schemas.booking import BookingOut, BookingStatusUpdate
from app.schemas.package import PackageCreate, PackageOut, PackageUpdate
from app.schemas.space import (
    AvailabilityRuleOut,
    AvailabilityRulesSetBody,
    RoomCreate,
    RoomOut,
    RoomUpdate,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)
from app.schemas.user import UserOut

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Dashboard ────────────────────────────────────────────────────────────────


@router.get("/dashboard")
async def dashboard(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    total_bookings_result = await db.execute(
        select(func.count(Booking.id)).where(Booking.org_id == org_id)
    )
    total_bookings = total_bookings_result.scalar_one()

    # Booking revenue is money charged *for the booking*. A package booking is
    # settled with hours bought earlier, so counting its `total_amount` here
    # would bill the same customer twice over — and at the rack rate, which is
    # not even what a discounted pack cost them. Revenue from package sales
    # belongs to the purchase, which this dashboard does not total yet.
    revenue_result = await db.execute(
        select(func.coalesce(func.sum(Booking.total_amount), 0)).where(
            Booking.org_id == org_id,
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.completed]),
            Booking.payment_method == PaymentMethod.hourly,
        )
    )
    total_revenue = float(revenue_result.scalar_one())

    active_users_result = await db.execute(
        select(func.count(distinct(Booking.user_id))).where(Booking.org_id == org_id)
    )
    active_users = active_users_result.scalar_one()

    # Occupancy: confirmed+completed bookings / total confirmed+completed+cancelled bookings
    total_non_pending_result = await db.execute(
        select(func.count(Booking.id)).where(
            Booking.org_id == org_id,
            Booking.status.in_(
                [BookingStatus.confirmed, BookingStatus.completed, BookingStatus.cancelled]
            ),
        )
    )
    total_non_pending = total_non_pending_result.scalar_one()

    confirmed_result = await db.execute(
        select(func.count(Booking.id)).where(
            Booking.org_id == org_id,
            Booking.status.in_([BookingStatus.confirmed, BookingStatus.completed]),
        )
    )
    confirmed = confirmed_result.scalar_one()

    occupancy_rate = (confirmed / total_non_pending * 100) if total_non_pending > 0 else 0.0

    return {
        "total_bookings": total_bookings,
        "total_revenue": total_revenue,
        "occupancy_rate": round(occupancy_rate, 1),
        "active_users": active_users,
    }


# ─── Spaces ───────────────────────────────────────────────────────────────────


@router.get("/spaces")
async def admin_list_spaces(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Space)
        .options(selectinload(Space.rooms))
        .where(Space.org_id == org_id)
        .order_by(Space.created_at.desc())
    )
    spaces = result.scalars().all()
    return {"spaces": [SpaceOut.model_validate(s) for s in spaces]}


@router.post("/spaces", status_code=status.HTTP_201_CREATED)
async def admin_create_space(
    body: SpaceCreate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    space = Space(
        org_id=org_id,
        name=body.name,
        description=body.description,
        address=body.address,
        city=body.city,
        images=body.images,
        amenities=body.amenities,
    )
    db.add(space)
    await db.flush()
    await db.refresh(space)
    return {"space": SpaceOut.model_validate(space)}


@router.put("/spaces/{space_id}")
async def admin_update_space(
    space_id: uuid.UUID,
    body: SpaceUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(space, field, value)

    await db.flush()
    await db.refresh(space)
    return {"space": SpaceOut.model_validate(space)}


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_space(
    space_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    space.is_active = False


# ─── Rooms ────────────────────────────────────────────────────────────────────


@router.post("/spaces/{space_id}/rooms", status_code=status.HTTP_201_CREATED)
async def admin_create_room(
    space_id: uuid.UUID,
    body: RoomCreate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Space).where(Space.id == space_id, Space.org_id == org_id))
    space = result.scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Space not found")

    room = Room(
        space_id=space_id,
        org_id=org_id,
        name=body.name,
        description=body.description,
        capacity=body.capacity,
        hourly_rate=body.hourly_rate,
        color=body.color,
        amenities=body.amenities,
        images=body.images,
    )
    db.add(room)
    await db.flush()
    await db.refresh(room)
    return {"room": RoomOut.model_validate(room)}


@router.put("/rooms/{room_id}")
async def admin_update_room(
    room_id: uuid.UUID,
    body: RoomUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(room, field, value)

    await db.flush()
    await db.refresh(room)
    return {"room": RoomOut.model_validate(room)}


@router.get("/rooms/{room_id}/availability")
async def admin_get_availability(
    room_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Current availability rules for a room, for pre-filling the admin edit form."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    rules_result = await db.execute(
        select(AvailabilityRule)
        .where(AvailabilityRule.room_id == room_id)
        .order_by(AvailabilityRule.day_of_week)
    )
    rules = rules_result.scalars().all()
    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in rules]}


@router.post("/rooms/{room_id}/availability")
async def admin_set_availability(
    room_id: uuid.UUID,
    body: AvailabilityRulesSetBody,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Replace all availability rules for a room."""
    result = await db.execute(select(Room).where(Room.id == room_id, Room.org_id == org_id))
    room = result.scalar_one_or_none()
    if room is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")

    # Delete existing rules
    existing_result = await db.execute(
        select(AvailabilityRule).where(AvailabilityRule.room_id == room_id)
    )
    for rule in existing_result.scalars().all():
        await db.delete(rule)

    # Insert new rules
    new_rules = []
    for rule_in in body.rules:
        rule = AvailabilityRule(
            room_id=room_id,
            day_of_week=rule_in.day_of_week,
            open_time=rule_in.open_time,
            close_time=rule_in.close_time,
        )
        db.add(rule)
        new_rules.append(rule)

    await db.flush()
    for r in new_rules:
        await db.refresh(r)

    return {"rules": [AvailabilityRuleOut.model_validate(r) for r in new_rules]}


# ─── Bookings ─────────────────────────────────────────────────────────────────


@router.get("/bookings")
async def admin_list_bookings(
    org_id: uuid.UUID = Query(...),
    room_id: uuid.UUID | None = Query(None),
    booking_status: BookingStatus | None = Query(None, alias="status"),
    from_date: datetime | None = Query(None, alias="from"),
    to_date: datetime | None = Query(None, alias="to"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    filters = [Booking.org_id == org_id]
    if room_id:
        filters.append(Booking.room_id == room_id)
    if booking_status:
        filters.append(Booking.status == booking_status)
    if from_date:
        filters.append(Booking.start_time >= from_date)
    if to_date:
        filters.append(Booking.end_time <= to_date)

    total_result = await db.execute(select(func.count(Booking.id)).where(and_(*filters)))
    total = total_result.scalar_one()

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room), selectinload(Booking.user))
        .where(and_(*filters))
        .order_by(Booking.start_time.desc(), Booking.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    bookings = result.scalars().all()
    attach_access_codes(lock_gateway, bookings)
    return {
        "bookings": [BookingOut.model_validate(b) for b in bookings],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.put("/bookings/{booking_id}")
async def admin_update_booking(
    booking_id: uuid.UUID,
    body: BookingStatusUpdate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
):
    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.room).selectinload(Room.space), selectinload(Booking.user))
        .where(Booking.id == booking_id, Booking.org_id == org_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    # Captured before the status mutation and the refresh below expire the
    # relationships — app.email has no DB session and cannot lazy-load them.
    previous_status = booking.status
    recipient_email = booking.user.email
    space_name = booking.room.space.name
    room_name = booking.room.name
    start_time = booking.start_time
    end_time = booking.end_time

    if booking.package_purchase_id is not None and body.status != previous_status:
        # An admin status change moves prepaid hours exactly like a member
        # cancellation does. Without this an admin-cancelled package booking
        # would silently burn the customer's hours.
        was_cancelled = previous_status is BookingStatus.cancelled
        now_cancelled = body.status is BookingStatus.cancelled
        if now_cancelled and not was_cancelled:
            await package_hours.credit_hours(
                db,
                purchase_id=booking.package_purchase_id,
                hours=booking.duration_hours,
            )
        elif was_cancelled and not now_cancelled:
            # Reinstating a refunded booking has to take the hours back, or the
            # cancel/re-confirm round trip hands out a free booking. It can fail
            # honestly: the refunded hours may already be spent elsewhere.
            reinstated = await package_hours.debit_purchase(
                db,
                purchase_id=booking.package_purchase_id,
                hours=booking.duration_hours,
                now=datetime.now(tz=UTC),
            )
            if not reinstated:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=("The package no longer has enough hours to reinstate this booking"),
                )

    booking.status = body.status
    await db.flush()
    await db.refresh(booking)

    if body.status != previous_status and body.status in (
        BookingStatus.confirmed,
        BookingStatus.cancelled,
    ):
        build_message = (
            email.booking_confirmation_email
            if body.status == BookingStatus.confirmed
            else email.booking_cancellation_email
        )
        email.enqueue_email(
            background_tasks,
            email_gateway,
            build_message(
                to=recipient_email,
                space_name=space_name,
                room_name=room_name,
                start_time=start_time,
                end_time=end_time,
            ),
        )

        # Epic 3.1/3.2/3.3: this is the "direct-confirm" path (as opposed to
        # the Stripe webhook in app/routers/webhooks.py). Best-effort either
        # way — a Seam outage must not block an admin from confirming or
        # cancelling a booking.
        if body.status == BookingStatus.confirmed:
            await try_issue_access_code(
                lock_gateway,
                booking_id=booking.id,
                room_id=booking.room_id,
                name=f"Reserva {booking.id} — {room_name}",
                starts_at=start_time,
                ends_at=end_time,
            )
        else:
            await try_revoke_access_code(lock_gateway, booking_id=booking.id)

    attach_access_codes(lock_gateway, booking)
    return {"booking": BookingOut.model_validate(booking)}


# ─── Users ────────────────────────────────────────────────────────────────────


@router.get("/users")
async def admin_list_users(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all users who have booked in this org."""
    result = await db.execute(
        select(User)
        .join(Booking, Booking.user_id == User.id)
        .where(Booking.org_id == org_id)
        .distinct()
    )
    users = result.scalars().all()
    return {"users": [UserOut.model_validate(u) for u in users]}


# ─── Packages ─────────────────────────────────────────────────────────────────


@router.get("/packages")
async def admin_list_packages(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Package).where(Package.org_id == org_id).order_by(Package.hours.asc())
    )
    packages = result.scalars().all()
    return {"packages": [PackageOut.model_validate(p) for p in packages]}


@router.post("/packages", status_code=status.HTTP_201_CREATED)
async def admin_create_package(
    body: PackageCreate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    package = Package(
        org_id=org_id,
        name=body.name,
        hours=body.hours,
        price=body.price,
        validity_days=body.validity_days,
    )
    db.add(package)
    await db.flush()
    await db.refresh(package)
    return {"package": PackageOut.model_validate(package)}


@router.put("/packages/{package_id}")
async def admin_update_package(
    package_id: uuid.UUID,
    body: PackageUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a package's price/hours/validity, or soft-deactivate it via is_active=false."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(package, field, value)

    await db.flush()
    await db.refresh(package)
    return {"package": PackageOut.model_validate(package)}
