"""The email gateway's state for the operator (B61)."""

from datetime import datetime

from pydantic import BaseModel


class EmailFailureOut(BaseModel):
    at: datetime
    to: str
    subject: str
    error: str


class EmailStatusOut(BaseModel):
    """What the operator can see. Never the API key: the model has no field
    for it, so nothing can serialise it by accident."""

    mode: str
    from_address: str
    support_inbox: str
    test_hooks_enabled: bool
    recent_failures: list[EmailFailureOut]


class EmailTestOut(BaseModel):
    delivered: bool
    to: str
