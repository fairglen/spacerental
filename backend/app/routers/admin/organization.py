"""The organisation's settings (G04): read for admins, written by the owner."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.auth import require_admin, require_owner
from app.database import get_db
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrganizationSettingsOut, OrganizationSettingsUpdate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ─── Organisation ─────────────────────────────────────────────────────────────

_ORG_SETTINGS_KEYS = ("contact_email", "contact_phone", "timezone")


def _org_out(org: Organization) -> OrganizationSettingsOut:
    values = org.settings or {}
    return OrganizationSettingsOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        plan=org.plan,
        contact_email=values.get("contact_email") or None,
        contact_phone=values.get("contact_phone") or None,
        timezone=values.get("timezone") or "Europe/Lisbon",
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


@router.get("/organization")
async def admin_get_organization(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The organisation's settings (G04): name, public contact, default
    timezone; `slug` is read-only. Admins read; the owner edits."""
    org = await db.scalar(select(Organization).where(Organization.id == org_id))
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {"organization": _org_out(org)}


@router.put("/organization")
async def admin_update_organization(
    body: OrganizationSettingsUpdate,
    org_id: uuid.UUID = Query(...),
    owner: User = Depends(require_owner),
    db: AsyncSession = Depends(get_db),
):
    org = await db.scalar(select(Organization).where(Organization.id == org_id).with_for_update())
    if org is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    before = _org_out(org).model_dump(mode="json")
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes:
        org.name = changes.pop("name")
    # JSON columns do not see in-place edits: always a new dict.
    values = dict(org.settings or {})
    for key in _ORG_SETTINGS_KEYS:
        if key in changes:
            values[key] = changes[key]
    org.settings = values
    await db.flush()
    await db.refresh(org)
    await audit.record(
        db,
        actor=owner,
        org_id=org_id,
        entity=org,
        action="update",
        before=before,
        after=_org_out(org).model_dump(mode="json"),
    )
    return {"organization": _org_out(org)}
