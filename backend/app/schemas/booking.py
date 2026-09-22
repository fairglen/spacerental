import uuid
from datetime import UTC, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.booking import BookingStatus, PaymentMethod
from app.schemas.bounds import Notes, before_latest_instant
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
    # For `hourly` and `mixed`, the money charged; for `package`, the slot's
    # value (no charge — the pack was paid for earlier).
    total_amount: Decimal
    # Hours of this booking paid with prepaid pack hours (C13): 0 for
    # `hourly`, the whole duration for `package`, in between for `mixed`.
    package_hours_used: Decimal = Decimal(0)
    status: BookingStatus
    payment_method: PaymentMethod
    notes: str | None
    # Non-null when this booking is one occurrence of a recurring series.
    recurrence_rule_id: uuid.UUID | None = None
    # C03: deadline of an unpaid hold (see the model); None when it never expires.
    hold_expires_at: datetime | None = None
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
    notes: Notes | None = None
    payment_method: PaymentMethod = PaymentMethod.hourly

    @field_validator("start_time", "end_time")
    @classmethod
    def _require_timezone(cls, value: datetime) -> datetime:
        """Reject naive datetimes instead of silently assuming a zone.

        Unlike `RecurrenceCreate` (which treats a naive instant as UTC, C05
        left that path untouched), a booking is a paid, customer-facing
        commitment: a client that omits its offset is more likely confused
        about local vs. UTC than deliberately meaning UTC, so this makes the
        client be explicit rather than guessing on its behalf. Storage and
        comparisons remain UTC (CLAUDE.md §9); R01 will move wall-time
        semantics to Europe/Lisbon.
        """
        # `tzinfo is not None` isn't sufficient: some non-standard tzinfo
        # implementations attach a `tzinfo` object whose `utcoffset()` still
        # returns `None`. `astimezone(UTC)` treats that the same as a naive
        # datetime would deserve to be treated — reject it here with the same
        # clear message, rather than let it raise its own unrelated
        # `ValueError` inside `astimezone`.
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("must include timezone information (e.g. a UTC offset)")
        return before_latest_instant(value.astimezone(UTC))


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
