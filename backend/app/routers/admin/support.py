"""The help-request inbox (C19, G04)."""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, deletion
from app.auth import require_admin
from app.database import get_db
from app.models.booking import Booking
from app.models.support import SupportRequest, SupportStatus
from app.models.user import User
from app.schemas.support import (
    SupportRequestDetailOut,
    SupportRequestOut,
    SupportStatusUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["admin-support"])


@router.get("/requests")
async def admin_list_support_requests(
    org_id: uuid.UUID = Query(...),
    status_filter: SupportStatus | None = Query(default=None, alias="status"),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Newest first. A request whose tenant could not be resolved (`org_id`
    NULL) appears in no organisation's inbox, by design."""
    where = [SupportRequest.org_id == org_id]
    if status_filter is not None:
        where.append(SupportRequest.status == status_filter)
    total = await db.scalar(select(func.count()).select_from(SupportRequest).where(*where))
    result = await db.execute(
        select(SupportRequest)
        .options(selectinload(SupportRequest.booking).selectinload(Booking.room))
        .where(*where)
        .order_by(SupportRequest.created_at.desc(), SupportRequest.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = result.scalars().all()
    return {
        "requests": [SupportRequestOut.model_validate(r) for r in rows],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


async def _request_in_org(db: AsyncSession, request_id: uuid.UUID, org_id: uuid.UUID):
    result = await db.execute(
        select(SupportRequest)
        .options(
            selectinload(SupportRequest.booking).selectinload(Booking.room),
            selectinload(SupportRequest.user),
        )
        .where(SupportRequest.id == request_id, SupportRequest.org_id == org_id)
    )
    request = result.scalar_one_or_none()
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    return request


@router.get("/requests/{request_id}")
async def admin_get_support_request(
    request_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One request for its page (G04): the full message and context, the
    linked booking and person, the operator's note."""
    request = await _request_in_org(db, request_id, org_id)
    return {"request": SupportRequestDetailOut.model_validate(request)}


@router.put("/requests/{request_id}")
async def admin_update_support_request(
    request_id: uuid.UUID,
    body: SupportStatusUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Status (`new`, `in_progress`, `closed`) and/or the private note (C19, G04)."""
    request = await _request_in_org(db, request_id, org_id)
    before = audit.snapshot(request)
    if body.status is not None:
        request.status = body.status
    if "admin_note" in body.model_fields_set:
        request.admin_note = body.admin_note
    await db.flush()
    await db.refresh(request)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=request,
        action="update",
        before=before,
        after=audit.snapshot(request),
    )
    return {"request": SupportRequestDetailOut.model_validate(request)}


@router.delete("/requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_support_request(
    request_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hard delete (G02), for spam; the trail keeps the whole request."""
    result = await db.execute(
        select(SupportRequest)
        .options(selectinload(SupportRequest.booking).selectinload(Booking.room))
        .where(SupportRequest.id == request_id, SupportRequest.org_id == org_id)
    )
    request = result.scalar_one_or_none()
    if request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    deletion.require_confirm(confirm, request.id)
    before = audit.snapshot(request)
    await db.delete(request)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=request, action="delete", before=before
    )
