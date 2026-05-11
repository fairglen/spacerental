import uuid
from datetime import datetime
from decimal import Decimal
from pydantic import BaseModel, ConfigDict


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
    purchased_at: datetime
    expires_at: datetime


class PackagePurchaseBody(BaseModel):
    org_id: uuid.UUID
