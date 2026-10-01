"""Local-only test hooks (G03).

`GET /__test__/emails` shows what the stub email gateway "sent" — the last
20 messages with their links — so a browser test can follow a reset link
without a mailbox. It is mounted ONLY with an explicit opt-in
(`TEST_HOOKS_ENABLED=true`, off by default; the dev Compose stack turns it
on) AND `EMAIL_MODE=stub` AND `APP_ENV` not `production` (`should_mount`):
a staging or preview deployment that forgets the flag has no such route,
and `tests/test_password_reset.py` proves a production app never does.
"""

import re

from fastapi import APIRouter, Depends, FastAPI

from app.email import EmailGateway, StubEmailGateway, get_email_gateway

router = APIRouter(prefix="/__test__", tags=["test-hooks"])

_LINK = re.compile(r"https?://[^\s<>\"']+")
LAST = 20


def should_mount(*, enabled: bool, email_mode: str, app_env: str) -> bool:
    return enabled and email_mode == "stub" and app_env != "production"


def mount(app: FastAPI, *, enabled: bool, email_mode: str, app_env: str) -> bool:
    if not should_mount(enabled=enabled, email_mode=email_mode, app_env=app_env):
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
                "reply_to": m.reply_to,
                "links": _LINK.findall(m.text_body),
            }
            for m in sent[-LAST:]
        ]
    }
