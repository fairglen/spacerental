"""Epic 4 — email notifications go through a queue, never synchronously.

Confirmation and cancellation both enqueue onto the same StubEmailGateway
used by EMAIL_MODE=stub in dev; `.sent` is the observable side effect these
tests assert against instead of a Resend dashboard or a mock of the whole
system.
"""

import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.config import settings
from app.email import (
    EmailNotConfigured,
    booking_cancellation_email,
    booking_confirmation_email,
    validate_email_settings,
)
from app.payments import CheckoutKind
from tests.conftest import checkout_completed_event

WEBHOOK_URL = "/api/v1/webhooks/stripe"


def _future_slot(duration_hours: int = 2):
    today = datetime.now(tz=timezone.utc).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(
        today + timedelta(days=days_ahead + 7), time(10, 0), tzinfo=timezone.utc
    )
    return start, start + timedelta(hours=duration_hours)


async def _create_pending_booking(client, auth_headers, room) -> dict:
    start, end = _future_slot()
    resp = await client.post(
        "/api/v1/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    booking = resp.json()["booking"]
    assert booking["status"] == "pending"
    return booking


class TestEmailContentTemplates:
    """Unit — pure content builders, no I/O."""

    def test_confirmation_email_is_portuguese_and_has_cancel_link(self):
        start = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)  # a Thursday
        end = start + timedelta(hours=2)
        message = booking_confirmation_email(
            to="cliente@example.com",
            space_name="Espaço Central",
            room_name="Sala A",
            start_time=start,
            end_time=end,
        )
        assert message.to == "cliente@example.com"
        assert "confirmada" in message.subject.lower()
        assert "Sala A" in message.text_body
        assert "Espaço Central" in message.text_body
        assert "quinta-feira" in message.text_body
        assert f"{settings.FRONTEND_URL}/dashboard" in message.text_body
        assert f"{settings.FRONTEND_URL}/dashboard" in message.html_body

    def test_cancellation_email_is_portuguese(self):
        start = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)
        end = start + timedelta(hours=2)
        message = booking_cancellation_email(
            to="cliente@example.com",
            space_name="Espaço Central",
            room_name="Sala A",
            start_time=start,
            end_time=end,
        )
        assert "cancelada" in message.subject.lower()
        assert "Sala A" in message.text_body
        assert f"{settings.FRONTEND_URL}/spaces" in message.text_body


class TestEmailSettingsValidation:
    """Unit — live mode never degrades to the stub (mirrors payments)."""

    def test_stub_mode_needs_no_credentials(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "stub")
        monkeypatch.setattr(settings, "RESEND_API_KEY", None)
        validate_email_settings()

    def test_live_mode_without_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "live")
        monkeypatch.setattr(settings, "RESEND_API_KEY", None)
        with pytest.raises(EmailNotConfigured):
            validate_email_settings()

    def test_unknown_mode_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "sandbox")
        with pytest.raises(EmailNotConfigured):
            validate_email_settings()


class TestBookingConfirmationEmail:
    """Integration — both paths that confirm a booking enqueue a message."""

    async def test_webhook_confirmation_sends_email(
        self, client, auth_headers, test_room, test_member, payments, emails
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
        assert resp.json()["handled"] is True

        assert len(emails.sent) == 1
        sent = emails.sent[0]
        assert sent.to == "user@test.com"
        assert test_room.name in sent.text_body
        assert "confirmada" in sent.subject.lower()

    async def test_admin_direct_confirm_sends_email(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, emails
    ):
        from app.models.booking import Booking, BookingStatus, PaymentMethod

        start, end = _future_slot()
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=admin_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.pending,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()
        await db_session.refresh(booking)

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        assert len(emails.sent) == 1
        sent = emails.sent[0]
        assert sent.to == admin_user.email
        assert "confirmada" in sent.subject.lower()

    async def test_admin_confirming_already_confirmed_booking_does_not_resend(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, emails
    ):
        from app.models.booking import Booking, BookingStatus, PaymentMethod

        start, end = _future_slot()
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=admin_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()
        await db_session.refresh(booking)

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert emails.sent == []


class TestBookingCancellationEmail:
    """Integration — both paths that cancel a booking enqueue a message."""

    async def test_user_cancel_sends_email(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member, emails
    ):
        from app.models.booking import Booking, BookingStatus, PaymentMethod

        start, end = _future_slot()
        start += timedelta(days=3)  # comfortably more than 24h out
        end += timedelta(days=3)
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()
        await db_session.refresh(booking)

        resp = await client.delete(
            f"/api/v1/bookings/{booking.id}", headers=auth_headers
        )
        assert resp.status_code == 204, resp.text

        assert len(emails.sent) == 1
        sent = emails.sent[0]
        assert sent.to == test_user.email
        assert test_room.name in sent.text_body
        assert "cancelada" in sent.subject.lower()

    async def test_admin_cancel_sends_email(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, emails
    ):
        from app.models.booking import Booking, BookingStatus, PaymentMethod

        start, end = _future_slot()
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=admin_user.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("2.00"),
            total_amount=Decimal("22.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await db_session.commit()
        await db_session.refresh(booking)

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text

        assert len(emails.sent) == 1
        sent = emails.sent[0]
        assert sent.to == admin_user.email
        assert "cancelada" in sent.subject.lower()
