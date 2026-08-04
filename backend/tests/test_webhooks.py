"""Story 2.2 — the Stripe webhook is what confirms a booking or a purchase.

Everything here runs against the stub gateway: real HMAC signature
verification, zero Stripe credentials, zero network.
"""

import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio

from app.config import settings
from app.models.package import Package
from app.payments import (
    CheckoutKind,
    PaymentsNotConfigured,
    StubPaymentGateway,
    to_cents,
    validate_payment_settings,
)
from tests.conftest import TEST_STRIPE_WEBHOOK_SECRET, checkout_completed_event

WEBHOOK_URL = "/api/v1/webhooks/stripe"


def _future_slot(duration_hours: int = 2):
    today = datetime.now(tz=timezone.utc).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(
        today + timedelta(days=days_ahead + 7), time(10, 0), tzinfo=timezone.utc
    )
    return start.isoformat(), (start + timedelta(hours=duration_hours)).isoformat()


async def _create_pending_booking(client, auth_headers, room) -> dict:
    start, end = _future_slot()
    resp = await client.post(
        "/api/v1/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start,
            "end_time": end,
            "payment_method": "hourly",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    booking = resp.json()["booking"]
    assert booking["status"] == "pending"
    return booking


async def _booking_status(client, auth_headers, booking_id: str) -> str:
    resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
    assert resp.status_code == 200
    return next(b["status"] for b in resp.json()["bookings"] if b["id"] == booking_id)


@pytest_asyncio.fixture
async def test_package(db_session, test_org) -> Package:
    p = Package(
        org_id=test_org.id,
        name="Starter Pack",
        hours=10,
        price=Decimal("99.00"),
        validity_days=180,
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


class TestBookingWebhook:
    async def test_valid_signature_confirms_pending_booking(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"received": True, "handled": True}
        assert await _booking_status(client, auth_headers, booking["id"]) == "confirmed"

    async def test_invalid_signature_is_rejected_without_writing(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )
        forged = StubPaymentGateway(webhook_secret="whsec_attacker_guess")

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": forged.sign_payload(payload)},
        )
        assert resp.status_code == 400, resp.text
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_missing_signature_header_is_rejected(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )

        resp = await client.post(WEBHOOK_URL, content=payload)
        assert resp.status_code == 400, resp.text
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_replayed_event_is_idempotent(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )
        headers = {"Stripe-Signature": payments.sign_payload(payload)}

        first = await client.post(WEBHOOK_URL, content=payload, headers=headers)
        second = await client.post(WEBHOOK_URL, content=payload, headers=headers)

        assert first.json()["handled"] is True
        assert second.status_code == 200
        assert second.json()["handled"] is False
        assert await _booking_status(client, auth_headers, booking["id"]) == "confirmed"

    async def test_event_for_another_org_does_not_confirm(
        self, client, auth_headers, test_room, test_member, payments
    ):
        """The org_id in the metadata scopes the lookup (CLAUDE.md §4)."""
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=uuid.uuid4(),
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 200
        assert resp.json()["handled"] is False
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_unpaid_session_does_not_confirm(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
            payment_status="unpaid",
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 200
        assert resp.json()["handled"] is False
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_unrelated_event_type_is_acknowledged_only(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
            event_type="checkout.session.expired",
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.json() == {"received": True, "handled": False}
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_unknown_session_is_acknowledged_not_applied(
        self, client, auth_headers, test_room, test_member, payments
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        payload = checkout_completed_event(
            session_id="cs_stub_never_seen",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 200
        assert resp.json()["handled"] is False
        assert await _booking_status(client, auth_headers, booking["id"]) == "pending"

    async def test_malformed_body_with_valid_signature_is_rejected(
        self, client, payments
    ):
        payload = b"not json"
        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 400, resp.text


class TestPackagePurchaseWebhook:
    async def test_webhook_activates_pending_purchase(
        self, client, auth_headers, test_org, test_package, test_member, payments
    ):
        bought = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert bought.status_code == 201, bought.text
        purchase = bought.json()["purchase"]
        assert purchase["status"] == "pending"

        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(purchase['id']).hex}",
            kind=CheckoutKind.package_purchase,
            reference_id=purchase["id"],
            org_id=test_org.id,
        )
        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": payments.sign_payload(payload)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["handled"] is True

        mine = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert mine.json()["purchases"][0]["status"] == "active"

    async def test_invalid_signature_leaves_purchase_pending(
        self, client, auth_headers, test_org, test_package, test_member, payments
    ):
        bought = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        purchase = bought.json()["purchase"]
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(purchase['id']).hex}",
            kind=CheckoutKind.package_purchase,
            reference_id=purchase["id"],
            org_id=test_org.id,
        )

        resp = await client.post(
            WEBHOOK_URL,
            content=payload,
            headers={"Stripe-Signature": "t=1,v1=deadbeef"},
        )
        assert resp.status_code == 400, resp.text

        mine = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert mine.json()["purchases"][0]["status"] == "pending"


class TestDecimalToCents:
    """Unit — money is Decimal end to end and only becomes int at the boundary."""

    @pytest.mark.parametrize(
        "amount,expected",
        [
            (Decimal("0"), 0),
            (Decimal("0.01"), 1),
            (Decimal("22.00"), 2200),
            (Decimal("99.99"), 9999),
            (Decimal("1234.56"), 123456),
            (Decimal("10"), 1000),
            # Half-up at the sub-cent boundary, never truncation.
            (Decimal("1.005"), 101),
            (Decimal("1.004"), 100),
        ],
    )
    def test_converts_decimal_to_cents(self, amount, expected):
        assert to_cents(amount) == expected

    def test_rejects_float(self):
        with pytest.raises(TypeError):
            to_cents(22.0)

    def test_rejects_negative(self):
        with pytest.raises(ValueError):
            to_cents(Decimal("-1.00"))


class TestPaymentSettingsValidation:
    """Unit — live mode never degrades to the stub."""

    def test_stub_mode_needs_no_credentials(self, monkeypatch):
        monkeypatch.setattr(settings, "STRIPE_MODE", "stub")
        monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", None)
        monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", None)
        validate_payment_settings()

    @pytest.mark.parametrize(
        "secret_key,webhook_secret",
        [(None, "whsec_x"), ("sk_live_x", None), (None, None)],
    )
    def test_live_mode_without_keys_raises(
        self, monkeypatch, secret_key, webhook_secret
    ):
        monkeypatch.setattr(settings, "STRIPE_MODE", "live")
        monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", secret_key)
        monkeypatch.setattr(settings, "STRIPE_WEBHOOK_SECRET", webhook_secret)
        with pytest.raises(PaymentsNotConfigured):
            validate_payment_settings()

    def test_unknown_mode_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "STRIPE_MODE", "sandbox")
        with pytest.raises(PaymentsNotConfigured):
            validate_payment_settings()


class TestStubSignature:
    """Unit — the stub enforces Stripe's scheme, not a rubber stamp."""

    def test_signature_outside_tolerance_is_rejected(self):
        from app.payments import InvalidWebhookSignature

        gateway = StubPaymentGateway(webhook_secret=TEST_STRIPE_WEBHOOK_SECRET)
        payload = b'{"type":"ping"}'
        stale = gateway.sign_payload(payload, timestamp=1)
        with pytest.raises(InvalidWebhookSignature):
            gateway.parse_webhook_event(payload, stale)

    def test_payload_tampering_is_rejected(self):
        from app.payments import InvalidWebhookSignature

        gateway = StubPaymentGateway(webhook_secret=TEST_STRIPE_WEBHOOK_SECRET)
        header = gateway.sign_payload(b'{"type":"ping"}')
        with pytest.raises(InvalidWebhookSignature):
            gateway.parse_webhook_event(b'{"type":"pong"}', header)
