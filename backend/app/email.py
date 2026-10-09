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
import re
import uuid
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from functools import cache
from html import escape
from zoneinfo import ZoneInfo

import httpx
from fastapi import BackgroundTasks

from app.config import BRAND_NAME, settings

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
    # Who a reply should go to, when that is not the sender (C17: a help
    # request is sent to support but answered to the customer).
    reply_to: str | None = None


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
                        **({"reply_to": message.reply_to} if message.reply_to else {}),
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


def format_datetime_pt(start: datetime, end: datetime) -> tuple[str, str]:
    """`_format_datetime_pt` for callers outside this module (K03)."""
    return _format_datetime_pt(start, end)


def _format_date_pt(when: datetime) -> str:
    local = when.astimezone(LISBON_TZ)
    return f"{local.day} de {_MONTHS_PT[local.month - 1]} de {local.year}"


# Every customer email ends the same way; the operator-facing support mail
# (an internal forward) does not.
SIGN_OFF_TEXT = f"Até breve,\nA equipa {BRAND_NAME}\n"
SIGN_OFF_HTML = f"<p>Até breve,<br />A equipa {escape(BRAND_NAME)}</p>"


def _branded(html_body: str) -> str:
    """Every HTML email opens with the logo (B50): an absolute URL on the
    frontend, where the brand set is served, 200 px wide so mail clients
    that ignore CSS still size it. The text part carries no header."""
    logo = f"{settings.FRONTEND_URL.rstrip('/')}/brand/logo-email.png"
    header = (
        f'<p><img src="{escape(logo)}" width="200" height="182" alt="{escape(BRAND_NAME)}" '
        'style="display:block;width:200px;height:auto" /></p>'
    )
    return header + html_body


def booking_confirmation_email(
    *,
    to: str,
    space_name: str,
    room_name: str,
    start_time: datetime,
    end_time: datetime,
    changed: bool = False,
) -> EmailMessage:
    """The confirmation; with `changed`, the same message for a booking an
    operator moved (A01) — one added line, not a second template."""
    date_str, time_str = _format_datetime_pt(start_time, end_time)
    cancel_url = f"{settings.FRONTEND_URL}/dashboard"
    subject = f"Reserva {'alterada' if changed else 'confirmada'} — {room_name}"
    lead = (
        "A sua reserva foi alterada. Estes são os novos dados:"
        if changed
        else "A sua reserva foi confirmada!"
    )
    text_body = (
        f"{lead}\n\n"
        f"Espaço: {space_name}\n"
        f"Sala: {room_name}\n"
        f"Data: {date_str}\n"
        f"Horário: {time_str}\n\n"
        "Pode cancelar esta reserva (até 24 horas antes do início) em:\n"
        f"{cancel_url}\n\n"
        f"{SIGN_OFF_TEXT}"
    )
    safe_space_name = escape(space_name)
    safe_room_name = escape(room_name)
    safe_date_str = escape(date_str)
    safe_time_str = escape(time_str)
    safe_cancel_url = escape(cancel_url, quote=True)

    html_body = (
        f"<p>{escape(lead)}</p>"
        "<ul>"
        f"<li><strong>Espaço:</strong> {safe_space_name}</li>"
        f"<li><strong>Sala:</strong> {safe_room_name}</li>"
        f"<li><strong>Data:</strong> {safe_date_str}</li>"
        f"<li><strong>Horário:</strong> {safe_time_str}</li>"
        "</ul>"
        f'<p><a href="{safe_cancel_url}">Cancelar reserva</a></p>'
        f"{SIGN_OFF_HTML}"
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


def _format_hours_pt(hours: Decimal) -> str:
    text = f"{hours:.2f}".rstrip("0").rstrip(".").replace(".", ",")
    return f"{text} hora" if text == "1" else f"{text} horas"


def booking_cancellation_email(
    *,
    to: str,
    space_name: str,
    room_name: str,
    start_time: datetime,
    end_time: datetime,
    credit_hours: Decimal | None = None,
    credit_expires_at: datetime | None = None,
) -> EmailMessage:
    date_str, time_str = _format_datetime_pt(start_time, end_time)
    browse_url = f"{settings.FRONTEND_URL}/spaces"
    bank_url = f"{settings.FRONTEND_URL}/dashboard"
    subject = f"Reserva cancelada — {room_name}"
    # K01: the paid hours are in the bank, not refunded — say so, with the
    # expiry, so the customer knows what to do with them.
    credit_text = credit_html = ""
    if credit_hours is not None and credit_hours > 0 and credit_expires_at is not None:
        hours_str = _format_hours_pt(credit_hours)
        until = _format_date_pt(credit_expires_at)
        credit_text = (
            f"As {hours_str} pagas ficaram no seu banco de horas, válidas até {until}. "
            f"Pode usá-las numa nova reserva, sem novo pagamento:\n{bank_url}\n\n"
        )
        credit_html = (
            f"<p>As {hours_str} pagas ficaram no seu banco de horas, válidas até {until}. "
            f'<a href="{bank_url}">Pode usá-las numa nova reserva</a>, sem novo pagamento.</p>'
        )
    text_body = (
        "A sua reserva foi cancelada.\n\n"
        f"Espaço: {space_name}\n"
        f"Sala: {room_name}\n"
        f"Data: {date_str}\n"
        f"Horário: {time_str}\n\n"
        f"{credit_text}"
        f"Pode fazer uma nova reserva em:\n{browse_url}\n\n"
        f"{SIGN_OFF_TEXT}"
    )
    html_body = (
        "<p>A sua reserva foi cancelada.</p>"
        "<ul>"
        f"<li><strong>Espaço:</strong> {space_name}</li>"
        f"<li><strong>Sala:</strong> {room_name}</li>"
        f"<li><strong>Data:</strong> {date_str}</li>"
        f"<li><strong>Horário:</strong> {time_str}</li>"
        "</ul>"
        f"{credit_html}"
        f'<p><a href="{browse_url}">Fazer nova reserva</a></p>'
        f"{SIGN_OFF_HTML}"
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


SUPPORT_CATEGORY_LABELS_PT = {
    "technical": "Problema técnico",
    "booking": "Reserva",
    "payment": "Pagamento",
    "package": "Pack",
    "other": "Outro",
}


def support_request_email(
    *,
    request_id: uuid.UUID,
    category: str,
    message: str,
    contact_email: str,
    context: dict,
    user_id: uuid.UUID | None,
    booking_id: uuid.UUID | None,
) -> EmailMessage:
    """A help-form request, sent to the support mailbox (C17).

    Reply-To is the customer, so whoever reads it just hits reply. Every value
    below came from a public form: the HTML part escapes all of it.
    """
    reference = request_id.hex[:8].upper()
    label = SUPPORT_CATEGORY_LABELS_PT.get(str(category), str(category))
    facts = [
        ("Referência", f"#{reference}"),
        ("Assunto", label),
        ("Email", contact_email),
        ("Utilizador", str(user_id) if user_id else "sem sessão iniciada"),
        ("Reserva", str(booking_id) if booking_id else "—"),
        ("Página", context.get("page_url", "—")),
        ("Ecrã", context.get("viewport", "—")),
        ("Browser", context.get("user_agent", "—")),
        ("Versão", context.get("app_version", "—")),
        ("Enviado às", context.get("timestamp", "—")),
    ]
    # K03: straight to the request in the admin inbox.
    admin_url = f"{settings.FRONTEND_URL}/admin/support/{request_id}"
    text_body = (
        f"Novo pedido de ajuda #{reference}\n\n{message}\n\n"
        + "\n".join(f"{name}: {value}" for name, value in facts)
        + f"\n\nAbrir no painel: {admin_url}\n"
        + "Responda a este email para falar com o cliente.\n"
    )
    html_body = (
        f"<p>Novo pedido de ajuda <strong>#{escape(reference)}</strong></p>"
        f'<p style="white-space:pre-wrap">{escape(message)}</p>'
        "<ul>"
        + "".join(f"<li><strong>{escape(n)}:</strong> {escape(str(v))}</li>" for n, v in facts)
        + f'</ul><p><a href="{escape(admin_url)}">Abrir no painel</a></p>'
        "<p>Responda a este email para falar com o cliente.</p>"
    )
    return EmailMessage(
        to=settings.SUPPORT_INBOX_EMAIL,
        subject=f"[Ajuda] {label} — #{reference}",
        html_body=_branded(html_body),
        text_body=text_body,
        reply_to=contact_email,
    )


def support_request_received_email(
    *,
    to: str,
    reference: str,
    category: str,
    message: str,
    booking_summary: str | None,
) -> EmailMessage:
    """The requester's copy of their own help request (K03): what they sent,
    quoted verbatim but escaped, and where the answer will come from. Reply-To
    is the support inbox so a reply lands next to the original."""
    label = SUPPORT_CATEGORY_LABELS_PT.get(str(category), str(category))
    subject = f"[{BRAND_NAME}] Recebemos o seu pedido #{reference}"
    booking_text = f"Reserva: {booking_summary}\n" if booking_summary else ""
    booking_html = (
        f"<li><strong>Reserva:</strong> {escape(booking_summary)}</li>" if booking_summary else ""
    )
    text_body = (
        f"Obrigado por nos contactar. Recebemos o seu pedido #{reference} e vamos "
        "responder o mais depressa possível.\n\n"
        f"Assunto: {label}\n"
        f"{booking_text}"
        f"\nA sua mensagem:\n{message}\n\n"
        f"Respondemos por email para {to}. Se quiser acrescentar algo, "
        "responda a este email.\n\n"
        f"{SIGN_OFF_TEXT}"
    )
    html_body = (
        f"<p>Obrigado por nos contactar. Recebemos o seu pedido <strong>#{escape(reference)}"
        "</strong> e vamos responder o mais depressa possível.</p>"
        "<ul>"
        f"<li><strong>Assunto:</strong> {escape(label)}</li>"
        f"{booking_html}"
        "</ul>"
        "<p>A sua mensagem:</p>"
        f'<blockquote style="white-space:pre-wrap">{escape(message)}</blockquote>'
        f"<p>Respondemos por email para {escape(to)}. Se quiser acrescentar algo, "
        "responda a este email.</p>"
        f"{SIGN_OFF_HTML}"
    )
    return EmailMessage(
        to=to,
        subject=subject,
        html_body=_branded(html_body),
        text_body=text_body,
        reply_to=settings.SUPPORT_INBOX_EMAIL,
    )


def password_reset_email(*, to: str, link: str) -> EmailMessage:
    """The self-service reset link (G03), also what an operator sends from the
    customer's page. Valid for one hour, single use."""
    subject = f"Repor a password — {BRAND_NAME}"
    text_body = (
        "Recebemos um pedido para repor a password da sua conta.\n\n"
        "Para escolher uma nova password, abra esta ligação (válida durante 60 minutos):\n"
        f"{link}\n\n"
        "Se não fez este pedido, ignore este email: a sua password mantém-se.\n\n"
        f"{SIGN_OFF_TEXT}"
    )
    safe_link = escape(link, quote=True)
    html_body = (
        "<p>Recebemos um pedido para repor a password da sua conta.</p>"
        "<p>Para escolher uma nova password, abra esta ligação (válida durante 60 minutos):</p>"
        f'<p><a href="{safe_link}">Escolher uma nova password</a></p>'
        "<p>Se não fez este pedido, ignore este email: a sua password mantém-se.</p>"
        f"{SIGN_OFF_HTML}"
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


def set_password_email(*, to: str, link: str) -> EmailMessage:
    """An account an operator created without a password (G04): the same link,
    worded as a welcome rather than a recovery."""
    subject = f"Defina a sua password — {BRAND_NAME}"
    text_body = (
        f"Foi criada uma conta {BRAND_NAME} para si com este email.\n\n"
        "Para definir a sua password e começar a reservar, abra esta ligação "
        "(válida durante 60 minutos):\n"
        f"{link}\n\n"
        "Se a ligação expirar, pode pedir uma nova em "
        f"{settings.FRONTEND_URL}/forgot-password\n\n"
        f"{SIGN_OFF_TEXT}"
    )
    safe_link = escape(link, quote=True)
    html_body = (
        f"<p>Foi criada uma conta {escape(BRAND_NAME)} para si com este email.</p>"
        "<p>Para definir a sua password e começar a reservar, abra esta ligação "
        "(válida durante 60 minutos):</p>"
        f'<p><a href="{safe_link}">Definir a minha password</a></p>'
        "<p>Se a ligação expirar, pode pedir uma nova em "
        f'<a href="{escape(settings.FRONTEND_URL, quote=True)}/forgot-password">'
        f"{escape(settings.FRONTEND_URL)}/forgot-password</a>.</p>"
        f"{SIGN_OFF_HTML}"
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


def invoice_available_email(
    *, to: str, number: str, issued_at: date, amount: Decimal, has_pdf: bool
) -> EmailMessage:
    """ "Fatura disponível" (I08): the operator registered an invoice issued
    to the customer; the customer finds it — and the PDF, when there is
    one — on their billing page. No attachment: the PDF stays behind the
    sign-in."""
    link = f"{settings.FRONTEND_URL}/dashboard/billing"
    when = issued_at.strftime("%d/%m/%Y")
    amount_str = f"{amount:.2f}".replace(".", ",") + " €"
    where = (
        "Pode consultar e transferir o PDF na sua área de faturação"
        if has_pdf
        else "Pode consultá-la na sua área de faturação"
    )
    subject = f"Fatura {number} disponível — {BRAND_NAME}"
    text_body = (
        f"Foi emitida a fatura {number}, de {when}, no valor de {amount_str}.\n\n"
        f"{where}: {link}\n\n"
        f"Obrigado por escolher o {BRAND_NAME}.\n\n" + SIGN_OFF_TEXT
    )
    html_body = (
        f"<p>Foi emitida a fatura <strong>{escape(number)}</strong>, de {when}, "
        f"no valor de <strong>{escape(amount_str)}</strong>.</p>"
        f'<p>{escape(where)}: <a href="{escape(link)}">{escape(link)}</a></p>'
        f"<p>Obrigado por escolher o {escape(BRAND_NAME)}.</p>" + SIGN_OFF_HTML
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


def test_email(*, to: str) -> EmailMessage:
    """The operator's own test message (B61): short, formal, and saying
    which gateway sent it, so a stub-mode send is recognisable as such."""
    if settings.EMAIL_MODE == STUB_MODE:
        mode_line = (
            "Este envio foi feito em modo de teste: o email ficou registado nesta "
            "máquina e não saiu para a Internet."
        )
    else:
        mode_line = "Este envio foi feito pelo fornecedor de email configurado."
    subject = f"Email de teste — {BRAND_NAME}"
    text_body = (
        f"Este é um email de teste enviado a partir do painel de administração do "
        f"{BRAND_NAME}.\n\n"
        f"{mode_line}\n\n"
        "Se recebeu esta mensagem na sua caixa de correio, o envio de emails está a funcionar."
    )
    html_body = (
        f"<p>Este é um email de teste enviado a partir do painel de administração do "
        f"{escape(BRAND_NAME)}.</p>"
        f"<p>{escape(mode_line)}</p>"
        "<p>Se recebeu esta mensagem na sua caixa de correio, o envio de emails está a "
        "funcionar.</p>"
    )
    return EmailMessage(to=to, subject=subject, html_body=_branded(html_body), text_body=text_body)


# ─── Delivery failures, visible to the operator (B61) ───────────────────────


@dataclass(frozen=True)
class DeliveryFailure:
    at: datetime
    to: str
    subject: str
    error: str


# Process-local and bounded: the last 20 failures, newest last. No queue means
# no durable record either (O01); this is what an operator can see today.
RECENT_FAILURES_KEPT = 20
recent_failures: deque[DeliveryFailure] = deque(maxlen=RECENT_FAILURES_KEPT)

_SECRET = re.compile(r"(?i)(bearer\s+)\S+|re_[A-Za-z0-9_]+")


def sanitise_provider_error(text: str) -> str:
    """A provider's message without anything that looks like a credential."""
    return _SECRET.sub(r"\1[redacted]", text).strip() or "sem detalhe"


def record_failure(message: EmailMessage, error: Exception) -> DeliveryFailure:
    failure = DeliveryFailure(
        at=datetime.now(UTC),
        to=message.to,
        subject=message.subject,
        error=sanitise_provider_error(str(error) or error.__class__.__name__),
    )
    recent_failures.append(failure)
    return failure


def email_status() -> dict:
    """The gateway's state for `GET /admin/email/status`: never the key."""
    return {
        "mode": settings.EMAIL_MODE,
        "from_address": settings.EMAIL_FROM_ADDRESS,
        "support_inbox": settings.SUPPORT_INBOX_EMAIL,
        "test_hooks_enabled": settings.TEST_HOOKS_ENABLED
        and settings.EMAIL_MODE == STUB_MODE
        and settings.APP_ENV != "production",
        "recent_failures": [
            {"at": f.at, "to": f.to, "subject": f.subject, "error": f.error}
            for f in reversed(recent_failures)
        ],
    }


def describe_mode() -> str:
    """The one startup line (B61): which gateway, from whom."""
    if settings.EMAIL_MODE == STUB_MODE:
        return (
            f"Email mode=stub from={settings.EMAIL_FROM_ADDRESS!r}: messages are kept on "
            "this machine (STUB EMAIL lines below; GET /__test__/emails when the test "
            "hooks are on) and never leave it"
        )
    return f"Email mode=live from={settings.EMAIL_FROM_ADDRESS!r}: sending through Resend"


# ─── Queueing ───────────────────────────────────────────────────────────────


async def _deliver(gateway: EmailGateway, message: EmailMessage) -> None:
    try:
        await gateway.send(message)
    except Exception as exc:
        # No real queue means no retry either — a real broker would redrive
        # this. Logging is the honest floor for a "queue" that is a single
        # in-process background task; the ring buffer (B61) is what the
        # operator sees of it. Any exception, not only the provider's: a
        # failure of ours must not vanish into the task either.
        record_failure(message, exc)
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
