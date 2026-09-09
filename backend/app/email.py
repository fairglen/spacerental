"""Email notifications boundary.

Mirrors `app/payments.py`'s shape: an `EmailGateway` interface with two
implementations chosen by `EMAIL_MODE`, so routers never know which one is
live. **Nothing outside this module may know about Resend.**

* `stub` (default) — `StubEmailGateway`: no account, no network, no
  credentials. Every "sent" message is appended to an in-memory list and
  logged at INFO, so `docker-compose up` with zero credentials still lets a
  developer (or a test) see exactly what would have gone out.
* `live` — `ResendEmailGateway`: a plain HTTPS POST to Resend's API via
  `httpx` (already a dependency — no vendor SDK needed for a single
  endpoint). Missing `RESEND_API_KEY` raises at import time rather than
  degrading to the stub; a stub silently running in production would be far
  worse than a crash.

There is deliberately no real message broker here (no Redis/Celery anywhere
else in this stack — CLAUDE.md §11). `enqueue_email` schedules delivery on
FastAPI's built-in `BackgroundTasks`, which is an honest implementation of
"the HTTP response returns without waiting on delivery" at this project's
current scale. Call sites depend only on `enqueue_email`, so swapping in a
real queue later means changing the body of that one function, not every
router that sends an email.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from functools import cache
from html import escape
from zoneinfo import ZoneInfo

import httpx
from fastapi import BackgroundTasks

from app.config import settings

logger = logging.getLogger("app.email")

STUB_MODE = "stub"
LIVE_MODE = "live"

LISBON_TZ = ZoneInfo("Europe/Lisbon")

RESEND_API_URL = "https://api.resend.com/emails"


class EmailNotConfiguredError(RuntimeError):
    """Live mode is selected but the email configuration is incomplete."""


class EmailProviderError(RuntimeError):
    """The email provider rejected or could not serve the request."""


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    html_body: str
    text_body: str


class EmailGateway(ABC):
    """The interface routers depend on. Neither implementation leaks a
    provider type past this module."""

    @abstractmethod
    async def send(self, message: EmailMessage) -> None:
        """Send `message`. Raise EmailProviderError on failure."""


class ResendEmailGateway(EmailGateway):
    """Real Resend. Selected by EMAIL_MODE=live.

    Chosen over Postmark for this project: Resend's send call is a single
    POST with a JSON body and an API-key bearer header, with no prior
    domain/signature setup required to send a first test message, which
    keeps "live mode" reachable without extra account provisioning beyond
    the API key itself.
    """

    def __init__(self, api_key: str, from_address: str) -> None:
        self._api_key = api_key
        self._from = from_address

    async def send(self, message: EmailMessage) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json={
                        "from": self._from,
                        "to": [message.to],
                        "subject": message.subject,
                        "html": message.html_body,
                        "text": message.text_body,
                    },
                )
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise EmailProviderError(str(exc)) from exc


class StubEmailGateway(EmailGateway):
    """Credential-free local stand-in. Selected by EMAIL_MODE=stub (default).

    `sent` is the observable side effect tests and local debugging assert
    against instead of a Resend dashboard.
    """

    def __init__(self) -> None:
        self.sent: list[EmailMessage] = []

    async def send(self, message: EmailMessage) -> None:
        self.sent.append(message)
        logger.info(
            "STUB EMAIL to=%s subject=%r\n%s",
            message.to,
            message.subject,
            message.text_body,
        )


# ─── Portuguese content templates ──────────────────────────────────────────

_WEEKDAYS_PT = (
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
    "domingo",
)
_MONTHS_PT = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)


def _format_datetime_pt(start: datetime, end: datetime) -> tuple[str, str]:
    """Return (date, time-range) strings in Portuguese, Lisbon local time.

    Hand-rolled instead of relying on the system locale: slim Docker Python
    images don't ship `pt_PT`, and adding one is more moving parts than a
    12-entry lookup table.
    """
    local_start = start.astimezone(LISBON_TZ)
    local_end = end.astimezone(LISBON_TZ)
    date_str = (
        f"{_WEEKDAYS_PT[local_start.weekday()]}, {local_start.day} de "
        f"{_MONTHS_PT[local_start.month - 1]} de {local_start.year}"
    )
    time_str = f"{local_start.strftime('%H:%M')} às {local_end.strftime('%H:%M')}"
    return date_str, time_str


def booking_confirmation_email(
    *,
    to: str,
    space_name: str,
    room_name: str,
    start_time: datetime,
    end_time: datetime,
) -> EmailMessage:
    date_str, time_str = _format_datetime_pt(start_time, end_time)
    cancel_url = f"{settings.FRONTEND_URL}/dashboard"
    subject = f"Reserva confirmada — {room_name}"
    text_body = (
        "A sua reserva foi confirmada!\n\n"
        f"Espaço: {space_name}\n"
        f"Sala: {room_name}\n"
        f"Data: {date_str}\n"
        f"Horário: {time_str}\n\n"
        "Pode cancelar esta reserva (até 24 horas antes do início) em:\n"
        f"{cancel_url}\n"
    )
    safe_space_name = escape(space_name)
    safe_room_name = escape(room_name)
    safe_date_str = escape(date_str)
    safe_time_str = escape(time_str)
    safe_cancel_url = escape(cancel_url, quote=True)

    html_body = (
        "<p>A sua reserva foi confirmada!</p>"
        "<ul>"
        f"<li><strong>Espaço:</strong> {safe_space_name}</li>"
        f"<li><strong>Sala:</strong> {safe_room_name}</li>"
        f"<li><strong>Data:</strong> {safe_date_str}</li>"
        f"<li><strong>Horário:</strong> {safe_time_str}</li>"
        "</ul>"
        f'<p><a href="{safe_cancel_url}">Cancelar reserva</a></p>'
    )
    return EmailMessage(to=to, subject=subject, html_body=html_body, text_body=text_body)


def booking_cancellation_email(
    *,
    to: str,
    space_name: str,
    room_name: str,
    start_time: datetime,
    end_time: datetime,
) -> EmailMessage:
    date_str, time_str = _format_datetime_pt(start_time, end_time)
    browse_url = f"{settings.FRONTEND_URL}/spaces"
    subject = f"Reserva cancelada — {room_name}"
    text_body = (
        "A sua reserva foi cancelada.\n\n"
        f"Espaço: {space_name}\n"
        f"Sala: {room_name}\n"
        f"Data: {date_str}\n"
        f"Horário: {time_str}\n\n"
        f"Pode fazer uma nova reserva em:\n{browse_url}\n"
    )
    html_body = (
        "<p>A sua reserva foi cancelada.</p>"
        "<ul>"
        f"<li><strong>Espaço:</strong> {space_name}</li>"
        f"<li><strong>Sala:</strong> {room_name}</li>"
        f"<li><strong>Data:</strong> {date_str}</li>"
        f"<li><strong>Horário:</strong> {time_str}</li>"
        "</ul>"
        f'<p><a href="{browse_url}">Fazer nova reserva</a></p>'
    )
    return EmailMessage(to=to, subject=subject, html_body=html_body, text_body=text_body)


# ─── Queueing ───────────────────────────────────────────────────────────────


async def _deliver(gateway: EmailGateway, message: EmailMessage) -> None:
    try:
        await gateway.send(message)
    except EmailProviderError:
        # No real queue means no retry either — a real broker would redrive
        # this. Logging is the honest floor for a "queue" that is a single
        # in-process background task.
        logger.exception("Failed to deliver email to %s (%s)", message.to, message.subject)


def enqueue_email(
    background_tasks: BackgroundTasks, gateway: EmailGateway, message: EmailMessage
) -> None:
    """Schedule `message` for delivery without blocking the response."""
    background_tasks.add_task(_deliver, gateway, message)


# ─── Mode selection ─────────────────────────────────────────────────────────


def validate_email_settings() -> None:
    """Fail loudly on an unusable email configuration.

    Called at import time so a live deployment missing its Resend key dies
    at boot instead of quietly running on the stub.
    """
    mode = settings.EMAIL_MODE
    if mode not in (STUB_MODE, LIVE_MODE):
        raise EmailNotConfiguredError(
            f"EMAIL_MODE must be '{STUB_MODE}' or '{LIVE_MODE}', got {mode!r}"
        )
    if mode == STUB_MODE:
        return
    if not settings.RESEND_API_KEY:
        raise EmailNotConfiguredError(f"EMAIL_MODE={LIVE_MODE} but RESEND_API_KEY is not set")


@cache
def _build_gateway(mode: str, api_key: str | None, from_address: str) -> EmailGateway:
    if mode == LIVE_MODE:
        return ResendEmailGateway(api_key=api_key, from_address=from_address)
    return StubEmailGateway()


def get_email_gateway() -> EmailGateway:
    """FastAPI dependency returning the configured gateway."""
    validate_email_settings()
    return _build_gateway(settings.EMAIL_MODE, settings.RESEND_API_KEY, settings.EMAIL_FROM_ADDRESS)


validate_email_settings()
