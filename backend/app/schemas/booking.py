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
    package_redemption_id: uuid.UUID | None
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


class BookingStatusUpdate(BaseModel):
    status: BookingStatus
