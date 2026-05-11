import uuid
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from app.models.organization import OrgPlan, MemberRole


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    plan: OrgPlan
    settings: dict
    created_at: datetime
    updated_at: datetime


class OrganizationCreate(BaseModel):
    name: str
    slug: str
    plan: OrgPlan = OrgPlan.starter
    settings: dict = {}


class OrganizationUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    plan: OrgPlan | None = None
    settings: dict | None = None


class OrgMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    org_id: uuid.UUID
    role: MemberRole
