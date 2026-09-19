import uuid
from datetime import datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.bounds import (
    Address,
    Capacity,
    City,
    Color,
    Description,
    ImageUrls,
    Money,
    Name,
    RejectExplicitNull,
    Tags,
    Weekday,
)


class AvailabilityRuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    day_of_week: int
    open_time: time
    close_time: time
    is_active: bool


class AvailabilityRuleIn(BaseModel):
    day_of_week: Weekday
    open_time: time
    close_time: time

    @field_validator("open_time", "close_time")
    @classmethod
    def _require_hour_aligned_time(cls, value: time) -> time:
        if value.minute or value.second or value.microsecond:
            raise ValueError("must be on the hour")
        return value

    @model_validator(mode="after")
    def _require_opening_before_closing(self):
        if self.open_time >= self.close_time:
            raise ValueError("open_time must be before close_time")
        return self


class AvailabilityRulesSetBody(BaseModel):
    rules: list[AvailabilityRuleIn] = Field(max_length=50)


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
    name: Name
    description: Description | None = None
    capacity: Capacity = 1
    hourly_rate: Money
    color: Color = "#6366f1"
    amenities: Tags = []
    images: ImageUrls = []


class RoomUpdate(RejectExplicitNull):
    nullable_fields = frozenset({"description"})

    name: Name | None = None
    description: Description | None = None
    capacity: Capacity | None = None
    hourly_rate: Money | None = None
    color: Color | None = None
    amenities: Tags | None = None
    images: ImageUrls | None = None
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
    name: Name
    description: Description | None = None
    address: Address | None = None
    city: City | None = None
    images: ImageUrls = []
    amenities: Tags = []


class SpaceUpdate(RejectExplicitNull):
    nullable_fields = frozenset({"description", "address", "city"})

    name: Name | None = None
    description: Description | None = None
    address: Address | None = None
    city: City | None = None
    images: ImageUrls | None = None
    amenities: Tags | None = None
    is_active: bool | None = None
