"""Help / report a problem (C17).

Public on purpose: the person who cannot sign in is exactly who needs it. That
makes it a public write to a database and an inbox, so it is throttled tightly,
bounded, carries a honeypot, and never reflects what it was sent.
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import email
from app.auth import get_current_user, oauth2_scheme
from app.config import settings
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.models.booking import Booking
from app.models.organization import Organization, OrganizationMember
from app.models.support import SupportRequest, SupportStatus
from app.models.user import User
from app.ratelimit import SUPPORT_TIER, rate_limit
from app.schemas.support import SupportRequestCreate, SupportRequestReceipt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["support"])


async def _sender(
    token: str | None = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User | None:
    """The signed-in customer, or None for a visitor.

    Unlike `get_optional_user`, a token that is present but invalid is a 401:
    a customer whose session expired should be told so, not have their request
    quietly filed as an anonymous one with their booking dropped.
    """
    if token is None:
        return None
    return await get_current_user(token=token, db=db)


async def _resolve_org(db: AsyncSession, user: User | None, booking: Booking | None):
    """The tenant this request belongs to, or None when it cannot be known."""
    if booking is not None:
        return booking.org_id
    if user is not None:
        orgs = (
            (
                await db.execute(
                    select(OrganizationMember.org_id).where(OrganizationMember.user_id == user.id)
                )
            )
            .scalars()
            .all()
        )
        if len(orgs) == 1:
            return orgs[0]
    # The one organisation this deployment enrolls customers into, if any.
    if settings.CUSTOMER_ENROLLMENT_ORG_SLUG:
        return await db.scalar(
            select(Organization.id).where(
                Organization.slug == settings.CUSTOMER_ENROLLMENT_ORG_SLUG
            )
        )
    return None


@router.post("/requests", status_code=status.HTTP_201_CREATED)
@rate_limit(SUPPORT_TIER)
async def create_support_request(
    body: SupportRequestCreate,
    background_tasks: BackgroundTasks,
    user: User | None = Depends(_sender),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
):
    if body.website:
        # A bot filled the hidden field. Answer exactly like a success so it
        # learns nothing, and keep nothing.
        logger.info("Support request dropped by honeypot")
        fake = SupportRequestReceipt(
            id=uuid.uuid4(), status=SupportStatus.new, created_at=datetime.now(tz=UTC)
        )
        return {"request": fake}

    contact_email = user.email if user is not None else body.contact_email
    if contact_email is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="contact_email is required when not signed in",
        )

    booking: Booking | None = None
    if user is not None and body.booking_id is not None:
        booking = await db.scalar(
            select(Booking).where(Booking.id == body.booking_id, Booking.user_id == user.id)
        )
        if booking is None:
            # Same answer for someone else's booking and for one that does not
            # exist: this form must not confirm which ids are real.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    # A visitor's `booking_id` is ignored: there is no one to check it against.

    request = SupportRequest(
        org_id=await _resolve_org(db, user, booking),
        user_id=user.id if user is not None else None,
        booking_id=booking.id if booking is not None else None,
        category=body.category,
        message=body.message,
        contact_email=str(contact_email),
        context=body.context.model_dump(exclude_none=True),
    )
    db.add(request)
    await db.flush()
    await db.refresh(request)

    # After the row exists: if the mail provider is down the request is still
    # in the inbox (`enqueue_email` logs a failed delivery and moves on).
    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.support_request_email(
            request_id=request.id,
            category=request.category,
            message=request.message,
            contact_email=request.contact_email,
            context=request.context,
            user_id=request.user_id,
            booking_id=request.booking_id,
        ),
    )
    return {"request": SupportRequestReceipt.model_validate(request)}
