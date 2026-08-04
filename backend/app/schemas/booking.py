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


class BookingCreate(BaseModel):
    room_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    notes: str | None = None
    payment_method: PaymentMethod = PaymentMethod.hourly


class BookingCheckoutOut(BaseModel):
    """POST /bookings response: the pending booking plus the Checkout URL the
    client must send the user to in order to confirm it."""

    booking: BookingOut
    checkout_url: str


class BookingStatusUpdate(BaseModel):
    status: BookingStatus
