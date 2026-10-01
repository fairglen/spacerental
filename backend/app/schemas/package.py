import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.models.package import PurchaseSource, PurchaseStatus
from app.schemas.bounds import Money, Name, PackageHours, RejectExplicitNull, ValidityDays


class PackageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    hours: int
    price: Decimal
    validity_days: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PackageCreate(BaseModel):
    name: Name
    hours: PackageHours
    price: Money
    validity_days: ValidityDays = 365


class PackageUpdate(RejectExplicitNull):
    name: Name | None = None
    hours: PackageHours | None = None
    price: Money | None = None
    validity_days: ValidityDays | None = None
    is_active: bool | None = None


class PackagePurchaseCounts(BaseModel):
    total: int
    active: int


class PackageDetailOut(BaseModel):
    """GET /admin/packages/{id} (G04)."""

    package: PackageOut
    purchases: PackagePurchaseCounts
    # Hours still spendable across the active, unexpired purchases.
    hours_outstanding: Decimal


class UserPackagePurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    # None for a cancellation credit (K01).
    package_id: uuid.UUID | None = None
    org_id: uuid.UUID
    hours_total: Decimal
    hours_used: Decimal
    hours_remaining: Decimal
    # 0,00 for complimentary hours (A05); the package's price when bought.
    amount_paid: Decimal = Decimal(0)
    status: PurchaseStatus
    # K01: bought, granted, or the paid hours of a cancelled booking.
    source: PurchaseSource = PurchaseSource.purchase
    source_booking_id: uuid.UUID | None = None
    purchased_at: datetime
    expires_at: datetime
    # Callers (the dashboard, B12) show the package name next to the balance —
    # without this the frontend has nothing to render but a generic "Pacote".
    # Requires the router to eager-load `.package` (it's `lazy="noload"`).
    # None for a cancellation credit, which belongs to no package.
    package: PackageOut | None = None


def validate_return_to(value: str | None) -> str | None:
    """A relative path on our own frontend (K02): starts with "/", never
    "//" or a backslash (browsers read those as another host), no scheme,
    no fragment, no whitespace or control characters, at most 512 chars."""
    if value is None:
        return None
    if len(value) > 512:
        raise ValueError("return_to is too long (max 512)")
    if not value.startswith("/") or value.startswith("//") or value.startswith("/\\"):
        raise ValueError("return_to must be a relative path starting with a single '/'")
    if "://" in value or "#" in value:
        raise ValueError("return_to must not carry a scheme, host or fragment")
    if any(ch.isspace() or ord(ch) < 32 or ch == "\x7f" for ch in value):
        raise ValueError("return_to must not contain whitespace or control characters")
    return value


class PackagePurchaseBody(BaseModel):
    org_id: uuid.UUID
    # K02: where Checkout sends the customer back to — the booking page with
    # the slot in its query — instead of the dashboard.
    return_to: str | None = None

    @field_validator("return_to")
    @classmethod
    def _return_to(cls, value: str | None) -> str | None:
        return validate_return_to(value)


class PackagePurchaseCheckoutOut(BaseModel):
    """POST /packages/{id}/purchase response: the pending purchase plus the
    Checkout URL that activates it once paid."""

    purchase: UserPackagePurchaseOut
    checkout_url: str


class AdminPurchaseOut(UserPackagePurchaseOut):
    """The operator's view: plus the private note (A05)."""

    admin_note: str | None = None


class ExpiringNextOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    hours: Decimal
    expires_at: datetime


class PackageBalanceOut(BaseModel):
    """The hour bank as one number (H02): every active, unexpired hour the
    customer holds, and the slice that lapses first."""

    model_config = ConfigDict(from_attributes=True)

    hours_available: Decimal
    hours_expiring_next: ExpiringNextOut | None = None


class BookingPackageDebitOut(BaseModel):
    """One purchase's share of a booking (H02), for the operator's split view."""

    model_config = ConfigDict(from_attributes=True)

    purchase_id: uuid.UUID
    hours: Decimal
    package_name: str | None = None
    expires_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def _flatten(cls, value):
        # From the ORM row: the purchase and its package, when loaded.
        purchase = getattr(value, "purchase", None)
        if purchase is None:
            return value
        return {
            "purchase_id": value.purchase_id,
            "hours": value.hours,
            "package_name": getattr(getattr(purchase, "package", None), "name", None),
            "expires_at": purchase.expires_at,
        }
