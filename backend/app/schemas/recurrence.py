import uuid
from datetime import date, datetime, timezone

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.recurrence import RecurrenceFrequency
from app.schemas.booking import BookingOut


def _as_utc(value: datetime) -> datetime:
    """Treat a tz-naive instant as UTC.

    Series expansion does date arithmetic and compares against `now`, both of
    which raise on a naive/aware mix. The API contract is UTC everywhere
    (CLAUDE.md §9), so a client that omits the offset is taken at its word
    rather than silently producing a series in the server's local time.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class RecurrenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    room_id: uuid.UUID
    user_id: uuid.UUID
    frequency: RecurrenceFrequency
    start_time: datetime
    end_time: datetime
    until_date: date
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class RecurrenceCreate(BaseModel):
    room_id: uuid.UUID
    start_time: datetime
    end_time: datetime
    until_date: date
    frequency: RecurrenceFrequency = RecurrenceFrequency.weekly
    notes: str | None = None

    _normalize = field_validator("start_time", "end_time")(_as_utc)


class RecurrenceUpdate(BaseModel):
    """PUT body. `until_date` is optional — omitting it keeps the current end."""

    start_time: datetime
    end_time: datetime
    until_date: date | None = None

    _normalize = field_validator("start_time", "end_time")(_as_utc)


class RecurrenceWithBookingsOut(BaseModel):
    """Response for create and edit: the rule plus the occurrences it expanded to."""

    recurrence: RecurrenceOut
    bookings: list[BookingOut]


class RecurrenceConflictOut(BaseModel):
    """409 body. `conflicts` lists the start of every occurrence that is taken.

    Documented as a schema even though it is returned as a plain JSONResponse,
    so the OpenAPI spec carries the shape the frontend has to branch on.
    """

    detail: str
    conflicts: list[datetime]
