"""The operator's dashboard shape (A04, I03).

A Pydantic model rather than a dict so `total_revenue` leaves as the
`Decimal` string every other money field uses — FastAPI's dict encoder would
turn a bare `Decimal` into a float.
"""

from decimal import Decimal

from pydantic import BaseModel

from app.schemas.billing import BillingSummaryOut


class AdminDashboardOut(BaseModel):
    total_bookings: int
    total_revenue: Decimal
    occupancy_rate: float
    active_users: int
    this_month: BillingSummaryOut
