import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, StringConstraints, model_validator

from app.models.organization import MemberRole, OrgPlan
from app.schemas.bounds import Name, TimeZoneName


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


class OrganizationSettingsOut(BaseModel):
    """GET /admin/organization (G04): what the panel edits. The contact and
    the timezone live in `organizations.settings` (Q-A12); `slug` is
    read-only here."""

    id: uuid.UUID
    name: str
    slug: str
    plan: OrgPlan
    contact_email: str | None = None
    contact_phone: str | None = None
    timezone: str = "Europe/Lisbon"
    created_at: datetime
    updated_at: datetime


class OrganizationSettingsUpdate(BaseModel):
    """PUT /admin/organization (G04), owner-only. Omitted = unchanged; an
    explicit null clears the contact email or phone."""

    name: Name | None = None
    contact_email: EmailStr | None = None
    contact_phone: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)] | None
    ) = None
    timezone: TimeZoneName | None = None

    @model_validator(mode="after")
    def _something_to_do(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be cleared")
        if "timezone" in self.model_fields_set and self.timezone is None:
            raise ValueError("timezone cannot be cleared")
        return self


class PublicContactOut(BaseModel):
    """The organisation's public contact on the space detail (G04): the
    customer-facing block reads it when set and falls back to its default."""

    email: str | None = None
    phone: str | None = None


class OrganizationUpdate(BaseModel):
    name: str | None = None
    slug: str | None = None
    plan: OrgPlan | None = None
    settings: dict | None = None


class OrgMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    org_id: uuid.UUID
    role: MemberRole


class OrgMembershipDetail(BaseModel):
    """Membership with denormalized org fields for the switcher UI."""

    model_config = ConfigDict(from_attributes=True)

    org_id: uuid.UUID
    org_name: str
    org_slug: str
    role: MemberRole


class EnrollmentOut(BaseModel):
    membership: OrgMembershipOut
