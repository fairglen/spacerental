"""Smart-lock access schemas (L01). The clear PIN is surfaced only to the
customer who owns it (`CustomerPinOut`); it is never in the audit snapshot or
the operator view.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class CustomerAccessOut(BaseModel):
    """The PUBLIC shape of a CustomerAccess row — the audit snapshot uses it,
    so it must never carry `pin_encrypted`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    user_id: uuid.UUID
    status: str
    created_at: datetime
    rotated_at: datetime | None = None
    last_used_at: datetime | None = None


class AccessDeviceOut(BaseModel):
    """One lock the customer is (or should be) on. `last_error` is operator-
    only; the customer view omits it."""

    model_config = ConfigDict(from_attributes=True)

    device_id: str
    sync_status: str
    synced_at: datetime | None = None
    last_error: str | None = None


class CustomerDeviceOut(BaseModel):
    """One lock in the customer's own view — no operator-only error text."""

    device_id: str
    sync_status: str
    synced_at: datetime | None = None


class CustomerPinOut(BaseModel):
    """What `GET /access/me` returns to the customer: their own PIN and where
    it stands on each lock."""

    status: str
    pin: str | None
    rotated_at: datetime | None = None
    devices: list[CustomerDeviceOut]


class AdminAccessOut(BaseModel):
    """The operator's view of a customer's access: status and per-lock sync,
    never the clear PIN."""

    status: str | None
    created_at: datetime | None = None
    rotated_at: datetime | None = None
    last_used_at: datetime | None = None
    devices: list[AccessDeviceOut]


# ─── L02: the trail ──────────────────────────────────────────────────────────


class AccessEventOut(BaseModel):
    """One entry in a customer's own access history."""

    occurred_at: datetime
    kind: str
    verdict: str | None = None


class VerdictRowOut(BaseModel):
    """One judged keypad entry for the operator report."""

    verdict: str
    delta_minutes: int | None = None
    entered_at: datetime
    departure_estimate_at: datetime | None = None
    departure_confidence: str
    device_id: str
    booking_id: uuid.UUID | None = None
    customer_name: str | None = None
    customer_email: str | None = None


class AccessReportOut(BaseModel):
    """A week of access verdicts and the counts per verdict."""

    week_start: datetime
    week_end: datetime
    counts: dict[str, int]
    verdicts: list[VerdictRowOut]


class BookingAccessOut(BaseModel):
    """The access verdict for one booking, for the admin booking view."""

    verdict: str | None = None
    entered_at: datetime | None = None
    departure_estimate_at: datetime | None = None
    departure_confidence: str | None = None
