import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.organization import MemberRole
from app.schemas.booking import _require_timezone

# A reason someone will read later: whitespace alone is not one.
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class OrgUserOut(BaseModel):
    """A member of the operator's organisation, as the list shows them (A05)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    role: MemberRole
    joined_at: datetime
    bookings_count: int
    created_at: datetime


class RoleUpdate(BaseModel):
    # `owner` is deliberately not grantable here: ownership transfer is a
    # different decision with different consequences (billing, deletion).
    role: Literal["admin", "member"]


class ComplimentaryHoursCreate(BaseModel):
    # Numeric(5, 2): 999.99 is the column's ceiling.
    hours: Decimal = Field(gt=0, le=999, max_digits=5, decimal_places=2)
    package_id: uuid.UUID
    reason: Reason
    # Defaults to now + the package's validity.
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _tz(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _require_timezone(value)


class ExpiryUpdate(BaseModel):
    """ "Prolongar validade" (A06): a later expiry and why."""

    expires_at: datetime
    reason: Reason

    @field_validator("expires_at")
    @classmethod
    def _tz(cls, value: datetime) -> datetime:
        return _require_timezone(value)
