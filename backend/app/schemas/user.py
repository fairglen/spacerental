import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

from app import nif
from app.schemas.bounds import PersonName


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None
    created_at: datetime


class BillingDetailsOut(BaseModel):
    """What an invoice to this customer names (I04)."""

    model_config = ConfigDict(from_attributes=True)

    tax_id: str | None
    billing_name: str | None
    billing_address: str | None


BillingName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
BillingAddress = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


def _blank_is_none(value: str | None) -> str | None:
    return value or None


class BillingDetailsUpdate(BaseModel):
    """PUT /auth/me/billing: every field is sent; blank clears it. The NIF
    must pass the check digit (`app.nif`) or the whole request is refused."""

    tax_id: str | None = Field(default=None, max_length=32)
    billing_name: BillingName | None = None
    billing_address: BillingAddress | None = None

    @field_validator("tax_id")
    @classmethod
    def _nif(cls, value: str | None) -> str | None:
        return nif.validate(value)

    @field_validator("billing_name", "billing_address")
    @classmethod
    def _blank(cls, value: str | None) -> str | None:
        return _blank_is_none(value)


class UserRegister(BaseModel):
    email: EmailStr
    # NIST SP 800-63B: min 8, accept up to at least 64 (we allow 128)
    password: str = Field(min_length=8, max_length=128)
    name: PersonName | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=128)


class PasswordSet(BaseModel):
    """An operator setting a customer's password directly (G03)."""

    password: str = Field(min_length=8, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    role: str  # owner | admin | member
