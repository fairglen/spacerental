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
