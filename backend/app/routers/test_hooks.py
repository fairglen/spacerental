"""Local-only test hooks (G03).

`GET /__test__/emails` shows what the stub email gateway "sent" — the last
20 messages with their links — so a browser test can follow a reset link
without a mailbox. It is mounted ONLY when `EMAIL_MODE=stub` and `APP_ENV`
is not `production` (`should_mount`), and `tests/test_password_reset.py`
proves an app built for production has no such route.
"""

import re

from fastapi import APIRouter, Depends, FastAPI

from app.email import EmailGateway, StubEmailGateway, get_email_gateway

router = APIRouter(prefix="/__test__", tags=["test-hooks"])

_LINK = re.compile(r"https?://[^\s<>\"']+")
LAST = 20


def should_mount(*, email_mode: str, app_env: str) -> bool:
    return email_mode == "stub" and app_env != "production"


def mount(app: FastAPI, *, email_mode: str, app_env: str) -> bool:
    if not should_mount(email_mode=email_mode, app_env=app_env):
        return False
    app.include_router(router)
    return True


@router.get("/emails")
async def stub_emails(gateway: EmailGateway = Depends(get_email_gateway)):
    sent = gateway.sent if isinstance(gateway, StubEmailGateway) else []
    return {
        "emails": [
            {
                "to": m.to,
                "subject": m.subject,
                "links": _LINK.findall(m.text_body),
            }
            for m in sent[-LAST:]
        ]
    }
