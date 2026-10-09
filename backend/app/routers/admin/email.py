"""Email delivery, visible to the operator (B61).

`GET /admin/email/status` says which gateway the API runs — the stub that
keeps messages on this machine, or Resend — and the last delivery failures;
`POST /admin/email/test` sends one short message to the calling admin's own
address, synchronously, so a mode or DNS problem answers right here instead
of in a background task's log line. No recipient parameter: this is not a
relay. The route sits under the `support` rate-limit tier (5 an hour per
client), because each call is a real send in live mode.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, email
from app.auth import require_admin
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.ratelimit import SUPPORT_TIER, rate_limit
from app.schemas.email import EmailStatusOut, EmailTestOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])

PROVIDER_REFUSED = "O fornecedor de email recusou o envio"


@router.get("/email/status")
async def admin_email_status(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
):
    """The gateway in use, its sender, and the last delivery failures (B61).
    The configuration is process-wide; the org is the admin check's scope."""
    return {"email": EmailStatusOut(**email.email_status())}


@router.post("/email/test")
@rate_limit(SUPPORT_TIER)
async def admin_send_test_email(
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    gateway: email.EmailGateway = Depends(email.get_email_gateway),
    db: AsyncSession = Depends(get_db),
):
    """One test message to the admin's own address, delivered before the
    answer: `{"delivered": true, "to": …}`, or 502 with what the provider
    said (sanitised — never the key). Audited either way, like the
    password-reset send: the admin is the entity, `email.test` the action."""
    message = email.test_email(to=admin.email)
    try:
        await gateway.send(message)
    except email.EmailProviderError as exc:
        failure = email.record_failure(message, exc)
        logger.warning("Test email to %s refused: %s", admin.email, failure.error)
        await audit.record(
            db,
            actor=admin,
            org_id=org_id,
            entity=admin,
            action="email.test",
            after={
                "to": admin.email,
                "mode": settings.EMAIL_MODE,
                "delivered": False,
                "error": failure.error,
            },
        )
        # The 502 below rolls the request's session back; the row is wanted.
        await db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"{PROVIDER_REFUSED}: {failure.error}",
        ) from None
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=admin,
        action="email.test",
        after={"to": admin.email, "mode": settings.EMAIL_MODE, "delivered": True},
    )
    logger.info("Test email delivered to %s via %s", admin.email, settings.EMAIL_MODE)
    return EmailTestOut(delivered=True, to=admin.email)
