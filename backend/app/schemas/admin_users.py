import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app import nif
from app.models.organization import MemberRole
from app.schemas.booking import _require_timezone
from app.schemas.bounds import PersonName
from app.schemas.user import BillingAddress, BillingName

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
    # "Suspender" (G02): set while the account cannot sign in.
    disabled_at: datetime | None = None
    created_at: datetime
    # Billing details (I04).
    tax_id: str | None = None
    billing_name: str | None = None
    billing_address: str | None = None


class AdminUserCreate(BaseModel):
    """POST /admin/users (G04): an account made by the operator, enrolled as
    a member. Without `password` the person gets a "Defina a sua password"
    link; with one, nothing is sent."""

    email: EmailStr
    name: PersonName | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class AdminUserUpdate(BaseModel):
    """PUT /admin/users/{id} (G04): name, email, and `disabled_at` — an instant
    suspends, an explicit null reactivates. Omitted = unchanged."""

    email: EmailStr | None = None
    name: PersonName | None = None
    disabled_at: datetime | None = None
    # Billing details (I04); an explicit null clears one.
    tax_id: str | None = Field(default=None, max_length=32)
    billing_name: BillingName | None = None
    billing_address: BillingAddress | None = None

    @field_validator("disabled_at")
    @classmethod
    def _tz(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _require_timezone(value)

    @field_validator("tax_id")
    @classmethod
    def _nif(cls, value: str | None) -> str | None:
        return nif.validate(value)

    @field_validator("billing_name", "billing_address")
    @classmethod
    def _blank(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _something_to_do(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        return self


class PurchaseAdjust(BaseModel):
    """POST /admin/purchases/{id}/adjust (G04): hours added (+) or taken (-)."""

    hours: Decimal = Field(max_digits=5, decimal_places=2)
    reason: Reason

    @field_validator("hours")
    @classmethod
    def _not_zero(cls, value: Decimal) -> Decimal:
        if value == 0:
            raise ValueError("hours must not be zero")
        return value


class PurchaseUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    email: str


class PurchaseDebitOut(BaseModel):
    """One booking's draw on the purchase (G04), for the detail page."""

    booking_id: uuid.UUID
    hours: Decimal
    start_time: datetime
    end_time: datetime
    status: str
    room_name: str | None


class AuditUserOut(BaseModel):
    """A user as the audit trail snapshots them (G01): the account's public
    fields only — never the password hash, a reset token or the token
    version, which is what `tests/test_audit.py` checks."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None
    disabled_at: datetime | None = None
    created_at: datetime
    # Billing details (I04): an operator's edit of a NIF is visible in history.
    tax_id: str | None = None
    billing_name: str | None = None
    billing_address: str | None = None


class ConfirmBody(BaseModel):
    """Type-to-confirm for an action that cannot be undone (G02)."""

    confirm: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    reason: Reason | None = None


class AnonymisedUserOut(BaseModel):
    """What is left of an account after anonymisation (G02)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    disabled_at: datetime | None


class PurchaseUpdate(BaseModel):
    """PUT /admin/purchases/{id} (G02/G04): `cancelled` with a reason is the
    delete (the balance goes to 0, debits stay); `active` brings it back."""

    status: Literal["active", "cancelled"] | None = None
    admin_note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = (
        None
    )
    reason: Reason | None = None

    @model_validator(mode="after")
    def _status_change_needs_a_reason(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if self.status is not None and self.reason is None:
            raise ValueError("a reason is required to change the status")
        return self


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
