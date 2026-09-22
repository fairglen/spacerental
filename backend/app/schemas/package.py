import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.package import PurchaseStatus
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


class UserPackagePurchaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    package_id: uuid.UUID
    org_id: uuid.UUID
    hours_total: Decimal
    hours_used: Decimal
    hours_remaining: Decimal
    # 0,00 for complimentary hours (A05); the package's price when bought.
    amount_paid: Decimal = Decimal(0)
    status: PurchaseStatus
    purchased_at: datetime
    expires_at: datetime
    # Callers (the dashboard, B12) show the package name next to the balance —
    # without this the frontend has nothing to render but a generic "Pacote".
    # Requires the router to eager-load `.package` (it's `lazy="noload"`).
    package: PackageOut


class PackagePurchaseBody(BaseModel):
    org_id: uuid.UUID


class PackagePurchaseCheckoutOut(BaseModel):
    """POST /packages/{id}/purchase response: the pending purchase plus the
    Checkout URL that activates it once paid."""

    purchase: UserPackagePurchaseOut
    checkout_url: str


class AdminPurchaseOut(UserPackagePurchaseOut):
    """The operator's view: plus the private note (A05)."""

    admin_note: str | None = None
