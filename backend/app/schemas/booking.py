import uuid
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict
from app.models.booking import BookingStatus, PaymentMethod
from app.schemas.space import RoomOut
from app.schemas.user import UserOut


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    duration_hours: Decimal
    total_amount: Decimal
    status: BookingStatus
    payment_method: PaymentMethod
    notes: str | None
    created_at: datetime
    updated_at: datetime
    room: RoomOut | None = None
    user: UserOut | None = None
    # Not a DB column (see app/locks.py's module docstring on persistence).
    # Populated from the lock gateway's in-memory table by
    # `app.locks.attach_access_codes` before validation; `None` if this
    # booking has no code issued (not confirmed yet, or Seam best-effort
    # issuance failed — Epic 3.3).
    access_code: str | None = None


class BookingCreate(BaseModel):
    room_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    notes: str | None = None
    payment_method: PaymentMethod = PaymentMethod.hourly


class BookingCheckoutOut(BaseModel):
    """POST /bookings response: the created booking plus the Checkout URL the
    client must send the user to in order to confirm it.

    `checkout_url` is null when nothing is left to pay — a booking redeemed
    against prepaid package hours comes back already `confirmed`.
    """

    booking: BookingOut
    checkout_url: str | None = None


class BookingStatusUpdate(BaseModel):
    status: BookingStatus
