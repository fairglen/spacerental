import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditActorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str | None
    email: str


class AdminActionOut(BaseModel):
    """One row of the trail (G01). `actor` is None for a system action or an
    actor whose account no longer exists."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    actor: AuditActorOut | None = None
    entity_type: str
    entity_id: uuid.UUID
    action: str
    before: dict | None
    after: dict | None
    reason: str | None
    request_id: str | None
    created_at: datetime
