import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    name: str | None
    avatar_url: str | None
    created_at: datetime


class UserRegister(BaseModel):
    email: EmailStr
    # NIST SP 800-63B: min 8, accept up to at least 64 (we allow 128)
    password: str = Field(min_length=8, max_length=128)
    name: str | None = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    role: str  # owner | admin | member
