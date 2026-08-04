"""Payments boundary.

Everything payment-provider-specific lives here — the Stripe SDK, the
Decimal→cents conversion, and webhook signature verification — so routers stay
free of provider details. **Nothing outside this module may import `stripe`.**

Two implementations sit behind `PaymentGateway`, chosen by `STRIPE_MODE`:

* `stub` (default) — `StubPaymentGateway`: no account, no network, no
  credentials. Deterministic checkout URLs and Stripe's real HMAC signature
  scheme, so the booking → checkout → webhook → confirmed flow can be walked
  end to end on a laptop.
* `live` — `StripeGateway`: the real SDK. Missing keys raise at import time
  rather than degrading to the stub; a stub silently running in production
  would be far worse than a crash.
"""

import enum
import hashlib
import hmac
import json
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache

import stripe

from app.config import settings

STUB_MODE = "stub"
LIVE_MODE = "live"

# Stub mode must work with zero configuration, so it falls back to this known
# local secret. Live mode never falls back — see validate_payment_settings().
DEFAULT_STUB_WEBHOOK_SECRET = "whsec_stub_local_secret"

# Stripe rejects signatures older than this; the stub mirrors it.
SIGNATURE_TOLERANCE_SECONDS = 300


class PaymentsNotConfigured(RuntimeError):
    """Live mode is selected but the Stripe configuration is incomplete."""


class InvalidWebhookSignature(ValueError):
    """A webhook payload failed signature verification."""


class InvalidWebhookPayload(ValueError):
    """A webhook payload was correctly signed but is not parseable."""


class PaymentProviderError(RuntimeError):
    """The payment provider rejected or could not serve the request."""


class CheckoutKind(str, enum.Enum):
    """What a Checkout Session is paying for; travels in the session metadata."""

    booking = "booking"
    package_purchase = "package_purchase"


@dataclass(frozen=True)
class CheckoutSession:
    id: str
    url: str


@dataclass(frozen=True)
class CheckoutSessionInfo:
    """The fields we care about from a Checkout Session in a webhook event."""

    id: str
    payment_status: str | None
    kind: str | None
    reference_id: str | None
    org_id: str | None


@dataclass(frozen=True)
class WebhookEvent:
    """Provider-agnostic view of a verified webhook event."""

    type: str
    checkout_session: CheckoutSessionInfo | None


def to_cents(amount: Decimal) -> int:
    """Convert a money Decimal to the provider's integer minor units.

    Money is Decimal everywhere else in the app; this is the only place it
    becomes an int, and floats are rejected outright because they cannot
    represent cents exactly.
    """
    if isinstance(amount, bool) or not isinstance(amount, Decimal):
        raise TypeError("amount must be a Decimal")
    if not amount.is_finite():
        raise ValueError("amount must be a finite Decimal")
    if amount < 0:
        raise ValueError("amount must not be negative")
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _session_info(raw_session: dict) -> CheckoutSessionInfo:
    metadata = raw_session.get("metadata") or {}
    return CheckoutSessionInfo(
        id=raw_session.get("id") or "",
        payment_status=raw_session.get("payment_status"),
        kind=metadata.get("kind"),
        reference_id=metadata.get("reference_id"),
        org_id=metadata.get("org_id"),
    )


def _event_from_payload(payload: bytes) -> WebhookEvent:
    try:
        raw = json.loads(payload)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InvalidWebhookPayload("webhook body is not valid JSON") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("type"), str):
        raise InvalidWebhookPayload("webhook body is not a Stripe event")

    raw_session = (raw.get("data") or {}).get("object")
    session = (
        _session_info(raw_session)
        if isinstance(raw_session, dict) and raw_session.get("object") == "checkout.session"
        else None
    )
    return WebhookEvent(type=raw["type"], checkout_session=session)


def _signed_payload_digest(payload: bytes, secret: str, timestamp: int) -> str:
    return hmac.new(
        secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256
    ).hexdigest()


class PaymentGateway(ABC):
    """The interface routers depend on. Neither implementation leaks a
    provider type past this module."""

    def __init__(self, currency: str, success_url: str, cancel_url: str) -> None:
        self._currency = currency
        self._success_url = success_url
        self._cancel_url = cancel_url

    @abstractmethod
    async def create_checkout_session(
        self,
        *,
        amount: Decimal,
        description: str,
        kind: CheckoutKind,
        reference_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> CheckoutSession:
        """Create a one-off payment session for `amount`.

        `org_id` rides along in the metadata so the webhook can scope its
        lookup to the paying tenant (CLAUDE.md §4).
        """

    @abstractmethod
    def _verify_signature(self, payload: bytes, signature_header: str) -> None:
        """Raise InvalidWebhookSignature unless the payload is authentic."""

    def parse_webhook_event(self, payload: bytes, signature_header: str | None) -> WebhookEvent:
        if not signature_header:
            raise InvalidWebhookSignature("missing Stripe-Signature header")
        self._verify_signature(payload, signature_header)
        return _event_from_payload(payload)


class StripeGateway(PaymentGateway):
    """Real Stripe. Selected by STRIPE_MODE=live."""

    def __init__(
        self,
        secret_key: str,
        webhook_secret: str,
        currency: str,
        success_url: str,
        cancel_url: str,
    ) -> None:
        super().__init__(currency, success_url, cancel_url)
        self._webhook_secret = webhook_secret
        self._client = stripe.StripeClient(secret_key)

    async def create_checkout_session(
        self,
        *,
        amount: Decimal,
        description: str,
        kind: CheckoutKind,
        reference_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> CheckoutSession:
        try:
            session = await self._client.v1.checkout.sessions.create_async(
                params={
                    "mode": "payment",
                    "success_url": self._success_url,
                    "cancel_url": self._cancel_url,
                    "client_reference_id": str(reference_id),
                    "metadata": {
                        "kind": kind.value,
                        "reference_id": str(reference_id),
                        "org_id": str(org_id),
                    },
                    "line_items": [
                        {
                            "quantity": 1,
                            "price_data": {
                                "currency": self._currency,
                                "unit_amount": to_cents(amount),
                                "product_data": {"name": description},
                            },
                        }
                    ],
                }
            )
        except stripe.StripeError as exc:
            raise PaymentProviderError(str(exc)) from exc

        if not session.id or not session.url:
            raise PaymentProviderError("Stripe returned a Checkout Session without a URL")
        return CheckoutSession(id=session.id, url=session.url)

    def _verify_signature(self, payload: bytes, signature_header: str) -> None:
        try:
            stripe.Webhook.construct_event(payload, signature_header, self._webhook_secret)
        except (stripe.SignatureVerificationError, ValueError) as exc:
            raise InvalidWebhookSignature(str(exc)) from exc


class StubPaymentGateway(PaymentGateway):
    """Credential-free local stand-in. Selected by STRIPE_MODE=stub (default).

    Checkout URLs are deterministic and signature verification implements
    Stripe's documented `t=<ts>,v1=<hmac>` scheme, so a forged webhook is
    rejected here exactly as it would be in live mode. `sign_payload` is the
    counterpart used by tests and by the local `curl` flow in the README of
    this feature's PR.
    """

    def __init__(
        self,
        webhook_secret: str,
        currency: str = "eur",
        success_url: str = "",
        cancel_url: str = "",
    ) -> None:
        super().__init__(currency, success_url, cancel_url)
        self._webhook_secret = webhook_secret
        # What the gateway was asked to charge, keyed by session id. Lets tests
        # and local debugging assert the amount without a Stripe dashboard.
        self.sessions: dict[str, dict] = {}

    async def create_checkout_session(
        self,
        *,
        amount: Decimal,
        description: str,
        kind: CheckoutKind,
        reference_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> CheckoutSession:
        session_id = f"cs_stub_{reference_id.hex}"
        self.sessions[session_id] = {
            "amount_cents": to_cents(amount),
            "currency": self._currency,
            "description": description,
            "kind": kind.value,
            "reference_id": str(reference_id),
            "org_id": str(org_id),
        }
        return CheckoutSession(
            id=session_id, url=f"https://checkout.stripe.stub/{session_id}"
        )

    def sign_payload(self, payload: bytes, timestamp: int | None = None) -> str:
        """Build a `Stripe-Signature` header for `payload`."""
        ts = int(time.time()) if timestamp is None else timestamp
        return f"t={ts},v1={_signed_payload_digest(payload, self._webhook_secret, ts)}"

    def _verify_signature(self, payload: bytes, signature_header: str) -> None:
        parts = dict(
            piece.split("=", 1)
            for piece in signature_header.split(",")
            if "=" in piece
        )
        try:
            timestamp = int(parts["t"])
        except (KeyError, ValueError) as exc:
            raise InvalidWebhookSignature("malformed Stripe-Signature header") from exc

        if abs(int(time.time()) - timestamp) > SIGNATURE_TOLERANCE_SECONDS:
            raise InvalidWebhookSignature("signature timestamp outside tolerance")

        expected = _signed_payload_digest(payload, self._webhook_secret, timestamp)
        if not hmac.compare_digest(expected, parts.get("v1", "")):
            raise InvalidWebhookSignature("signature does not match payload")


def validate_payment_settings() -> None:
    """Fail loudly on an unusable payments configuration.

    Called at import time so a live deployment missing its Stripe keys dies at
    boot instead of quietly running on the stub.
    """
    mode = settings.STRIPE_MODE
    if mode not in (STUB_MODE, LIVE_MODE):
        raise PaymentsNotConfigured(
            f"STRIPE_MODE must be '{STUB_MODE}' or '{LIVE_MODE}', got {mode!r}"
        )
    if mode == STUB_MODE:
        return
    missing = [
        name
        for name, value in (
            ("STRIPE_SECRET_KEY", settings.STRIPE_SECRET_KEY),
            ("STRIPE_WEBHOOK_SECRET", settings.STRIPE_WEBHOOK_SECRET),
        )
        if not value
    ]
    if missing:
        raise PaymentsNotConfigured(
            f"STRIPE_MODE={LIVE_MODE} but " + " and ".join(missing) + " is not set"
        )


@lru_cache(maxsize=None)
def _build_gateway(
    mode: str,
    secret_key: str | None,
    webhook_secret: str | None,
    currency: str,
    success_url: str,
    cancel_url: str,
) -> PaymentGateway:
    if mode == LIVE_MODE:
        return StripeGateway(
            secret_key=secret_key,
            webhook_secret=webhook_secret,
            currency=currency,
            success_url=success_url,
            cancel_url=cancel_url,
        )
    return StubPaymentGateway(
        webhook_secret=webhook_secret or DEFAULT_STUB_WEBHOOK_SECRET,
        currency=currency,
        success_url=success_url,
        cancel_url=cancel_url,
    )


def get_payment_gateway() -> PaymentGateway:
    """FastAPI dependency returning the configured gateway."""
    validate_payment_settings()
    return _build_gateway(
        settings.STRIPE_MODE,
        settings.STRIPE_SECRET_KEY,
        settings.STRIPE_WEBHOOK_SECRET,
        settings.STRIPE_CURRENCY,
        settings.STRIPE_SUCCESS_URL,
        settings.STRIPE_CANCEL_URL,
    )


validate_payment_settings()
