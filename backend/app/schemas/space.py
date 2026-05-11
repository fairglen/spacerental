import uuid
from datetime import datetime, time
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


class AvailabilityRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    day_of_week: int
    open_time: time
    close_time: time
    is_active: bool


class AvailabilityRuleIn(BaseModel):
    day_of_week: int
    open_time: time
    close_time: time


class AvailabilityRulesSetBody(BaseModel):
    rules: list[AvailabilityRuleIn]


class AvailabilitySlot(BaseModel):
    start: datetime
    end: datetime
    available: bool


class RoomOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    space_id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    capacity: int
    hourly_rate: Decimal
    images: list[str]
    amenities: list[str]
    color: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RoomCreate(BaseModel):
    name: str
    description: str | None = None
    capacity: int = 1
    hourly_rate: Decimal
    color: str = "#6366f1"
    amenities: list[str] = []
    images: list[str] = []


class RoomUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    capacity: int | None = None
    hourly_rate: Decimal | None = None
    color: str | None = None
    amenities: list[str] | None = None
    images: list[str] | None = None
    is_active: bool | None = None


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    address: str | None
    city: str | None
    images: list[str]
    amenities: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime
    rooms: list[RoomOut] | None = None


class SpaceCreate(BaseModel):
    name: str
    description: str | None = None
    address: str | None = None
    city: str | None = None
    images: list[str] = []
    amenities: list[str] = []


class SpaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    address: str | None = None
    city: str | None = None
    images: list[str] | None = None
    amenities: list[str] | None = None
    is_active: bool | None = None
