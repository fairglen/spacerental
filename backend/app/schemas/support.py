import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field

from app.models.support import SupportCategory, SupportStatus
from app.schemas.bounds import _text

SupportMessage = _text(2000, min_length=20)


def short_reference(request_id: uuid.UUID) -> str:
    """What a person quotes in an email: "#3F9A12BC"."""
    return request_id.hex[:8].upper()


class SupportContext(BaseModel):
    """What the browser says about where the problem happened.

    A whitelist: anything else the client sends is dropped rather than stored,
    and each value is bounded, so this column can never become a dumping ground.
    """

    model_config = ConfigDict(extra="ignore")

    page_url: _text(2000) | None = None
    viewport: _text(50) | None = None
    user_agent: _text(500) | None = None
    app_version: _text(100) | None = None
    timestamp: _text(50) | None = None


class SupportRequestCreate(BaseModel):
    category: SupportCategory
    message: SupportMessage
    # Required for a visitor; ignored for a signed-in customer, whose address
    # comes from their account.
    contact_email: EmailStr | None = None
    booking_id: uuid.UUID | None = None
    context: SupportContext = SupportContext()
    # Honeypot. Hidden from people, irresistible to form-filling bots: a value
    # here means the request is answered like a success and thrown away.
    website: str = Field(default="", max_length=500)


class SupportRequestReceipt(BaseModel):
    """What the sender gets back. Deliberately NOT the message: a public
    endpoint never reflects attacker-supplied text."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: SupportStatus
    created_at: datetime

    @computed_field
    @property
    def reference(self) -> str:
        return short_reference(self.id)
