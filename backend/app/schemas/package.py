import uuid
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict
from app.models.package import PurchaseStatus


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
    name: str
    hours: int
    price: Decimal
    validity_days: int = 365


class PackageUpdate(BaseModel):
    name: str | None = None
    hours: int | None = None
    price: Decimal | None = None
    validity_days: int | None = None
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
