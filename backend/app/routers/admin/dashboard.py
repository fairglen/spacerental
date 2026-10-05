"""The operator's dashboard numbers (A04)."""

import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.database import get_db
from app.models.booking import PAID_AT_CHECKOUT, Booking, BookingStatus
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


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
            Booking.payment_method.in_(PAID_AT_CHECKOUT),
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
