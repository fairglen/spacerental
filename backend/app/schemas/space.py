import uuid
from datetime import datetime, time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.media import public_url
from app.schemas.bounds import (
    Address,
    Capacity,
    City,
    Color,
    Description,
    ImageUrls,
    Latitude,
    Longitude,
    Money,
    Name,
    PostalCode,
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


class PhotoOut(BaseModel):
    """One photo as clients see it: always absolute URLs, never storage keys."""

    id: str
    url: str
    thumb_url: str
    # Unknown for a photo carried over from an external `images` URL.
    width: int | None = None
    height: int | None = None

    @model_validator(mode="before")
    @classmethod
    def _resolve_stored_keys(cls, data):
        if isinstance(data, dict) and "key" in data:
            return {
                **data,
                "url": public_url(data["key"]),
                "thumb_url": public_url(data["thumb_key"]),
            }
        return data


class PhotoOrder(BaseModel):
    # The full list, in the order wanted; the first becomes the cover.
    order: list[uuid.UUID] = Field(max_length=50)


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
    photos: list[PhotoOut] = []
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


def _coordinates_come_together(latitude: Decimal | None, longitude: Decimal | None) -> None:
    if (latitude is None) != (longitude is None):
        raise ValueError("latitude and longitude must be given together, or both left empty")


class SpaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    description: str | None
    address: str | None
    city: str | None
    postal_code: str | None
    latitude: Decimal | None
    longitude: Decimal | None
    images: list[str]
    photos: list[PhotoOut] = []
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
    postal_code: PostalCode | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    images: ImageUrls = []
    amenities: Tags = []

    @model_validator(mode="after")
    def _require_both_coordinates(self):
        _coordinates_come_together(self.latitude, self.longitude)
        return self


class SpaceUpdate(RejectExplicitNull):
    nullable_fields = frozenset(
        {"description", "address", "city", "postal_code", "latitude", "longitude"}
    )

    name: Name | None = None
    description: Description | None = None
    address: Address | None = None
    city: City | None = None
    postal_code: PostalCode | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    images: ImageUrls | None = None
    amenities: Tags | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def _require_both_coordinates(self):
        # Omitted means "leave as is", so one coordinate alone would be judged
        # against a stored value this body cannot see. A point is one value:
        # it is sent whole, set or cleared, or not at all.
        sent = self.model_fields_set & {"latitude", "longitude"}
        if len(sent) == 1:
            raise ValueError("latitude and longitude must be sent together")
        _coordinates_come_together(self.latitude, self.longitude)
        return self
