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


class PackagePurchaseBody(BaseModel):
    org_id: uuid.UUID


class PackagePurchaseCheckoutOut(BaseModel):
    """POST /packages/{id}/purchase response: the pending purchase plus the
    Checkout URL that activates it once paid."""

    purchase: UserPackagePurchaseOut
    checkout_url: str
