import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.schemas.booking import _require_timezone
from app.schemas.bounds import _text

Reason = _text(500, min_length=1)


class RoomBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    room_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    reason: str
    created_by: uuid.UUID | None
    created_at: datetime


class RoomBlockCreate(BaseModel):
    start_time: datetime
    end_time: datetime
    reason: Reason

    @field_validator("start_time", "end_time")
    @classmethod
    def _tz(cls, value: datetime) -> datetime:
        return _require_timezone(value)


class RoomBlockUpdate(BaseModel):
    start_time: datetime | None = None
    end_time: datetime | None = None
    reason: Reason | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def _tz(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _require_timezone(value)

    @model_validator(mode="after")
    def _something_to_do(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        return self


class BlockedBookingOut(BaseModel):
    """A booking that stands in the way of a block: enough to find it."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    start_time: datetime
    end_time: datetime
    status: str
