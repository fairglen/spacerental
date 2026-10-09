"""The operator's dashboard numbers (A04)."""

import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import distinct, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import billing, clock
from app.auth import require_admin
from app.database import get_db
from app.models.booking import Booking, BookingStatus
from app.models.user import User
from app.schemas.billing import BillingSummaryOut
from app.schemas.dashboard import AdminDashboardOut

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

    # Money received, on the statement's basis (I03): every booking paid by
    # card or recorded with an amount, and every pack sold, counted once at
    # `paid_at`. A package booking is settled with hours bought earlier, so
    # its rack-rate `total_amount` is not money; the pack sale is.
    total_revenue = await billing.received_all_time(db, org_id)
    this_month = billing.month_of(clock.utcnow())
    month_summary = billing.summarise(await billing.load_transactions(db, org_id, this_month))

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

    return AdminDashboardOut(
        total_bookings=total_bookings,
        total_revenue=total_revenue,
        occupancy_rate=round(occupancy_rate, 1),
        active_users=active_users,
        this_month=BillingSummaryOut.build(this_month, month_summary),
    )
