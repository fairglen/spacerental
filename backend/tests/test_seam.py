"""Epic 3 — Seam smart-lock access codes.

Mirrors test_email.py's shape: both paths that confirm a booking (the Stripe
webhook and the admin direct-confirm) issue a code through the same
StubLockGateway that SEAM_MODE=stub serves in dev, and `DELETE /bookings/{id}`
revokes it. `.issued_code_for()` / `.revoked_booking_ids` are the observable
side effects these tests assert against instead of a Seam dashboard — no
network, no credentials required to run the suite (CLAUDE.md §10.3).
"""

import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from app.config import settings
from app.locks import (
    LockNotConfigured,
    LockProviderError,
    StubLockGateway,
    validate_lock_settings,
)
from app.models.booking import Booking, BookingStatus, PaymentMethod
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


def _expected_stub_code(booking_id: uuid.UUID) -> str:
    return f"{booking_id.int % 1_000_000:06d}"


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
    assert booking["access_code"] is None
    return booking


async def _make_confirmed_booking(db_session, *, org, room, user, offset_days=7) -> Booking:
    start, end = _future_slot()
    start += timedelta(days=offset_days)
    end += timedelta(days=offset_days)
    booking = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
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
    return booking


class TestLockSettingsValidation:
    """Unit — live mode never degrades to the stub (mirrors payments/email)."""

    def test_stub_mode_needs_no_credentials(self, monkeypatch):
        monkeypatch.setattr(settings, "SEAM_MODE", "stub")
        monkeypatch.setattr(settings, "SEAM_API_KEY", None)
        validate_lock_settings()

    def test_live_mode_without_key_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "SEAM_MODE", "live")
        monkeypatch.setattr(settings, "SEAM_API_KEY", None)
        with pytest.raises(LockNotConfigured):
            validate_lock_settings()

    def test_unknown_mode_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "SEAM_MODE", "sandbox")
        with pytest.raises(LockNotConfigured):
            validate_lock_settings()


class TestStubLockGatewayBookkeeping:
    """Unit — the in-memory table the routers rely on."""

    async def test_issue_then_lookup_then_revoke(self):
        gateway = StubLockGateway()
        booking_id = uuid.uuid4()
        room_id = uuid.uuid4()
        start, end = _future_slot()

        code = await gateway.issue_access_code(
            booking_id=booking_id,
            room_id=room_id,
            name="test",
            starts_at=start,
            ends_at=end,
        )
        assert code.code == _expected_stub_code(booking_id)
        assert gateway.issued_code_for(booking_id) == code

        await gateway.revoke_access_code(booking_id=booking_id)
        assert gateway.issued_code_for(booking_id) is None
        assert gateway.revoked_booking_ids == [booking_id]

    async def test_revoke_without_issue_is_a_noop(self):
        gateway = StubLockGateway()
        booking_id = uuid.uuid4()
        await gateway.revoke_access_code(booking_id=booking_id)
        assert gateway.revoked_booking_ids == []


class TestAccessCodeIssuedOnConfirm:
    """Integration — both paths that confirm a booking issue a code (Epic 3.1)."""

    async def test_webhook_confirmation_issues_code(
        self, client, auth_headers, test_room, test_member, payments, locks
    ):
        booking = await _create_pending_booking(client, auth_headers, test_room)
        booking_id = uuid.UUID(booking["id"])
        payload = checkout_completed_event(
            session_id=f"cs_stub_{booking_id.hex}",
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

        issued = locks.issued_code_for(booking_id)
        assert issued is not None
        assert issued.code == _expected_stub_code(booking_id)

        # The dashboard picks the code up from the gateway's memory on the
        # next read — the webhook itself has no booking-shaped response.
        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert listed.status_code == 200
        confirmed = next(b for b in listed.json()["bookings"] if b["id"] == booking["id"])
        assert confirmed["status"] == "confirmed"
        assert confirmed["access_code"] == issued.code

    async def test_admin_direct_confirm_issues_code(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, locks
    ):
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
        body = resp.json()["booking"]
        assert body["status"] == "confirmed"
        assert body["access_code"] == _expected_stub_code(booking.id)
        assert locks.issued_code_for(booking.id) is not None

    async def test_admin_confirming_already_confirmed_booking_does_not_reissue(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, locks
    ):
        booking = await _make_confirmed_booking(
            db_session, org=test_org, room=test_room, user=admin_user
        )

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert locks.issued_code_for(booking.id) is None


class TestAccessCodeRevokedOnCancel:
    """Integration — Epic 3.2: DELETE /bookings/{id} revokes an issued code."""

    async def test_user_cancel_revokes_code(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member, locks
    ):
        booking = await _make_confirmed_booking(
            db_session, org=test_org, room=test_room, user=test_user
        )
        # Simulate a code having been issued when this booking was confirmed.
        await locks.issue_access_code(
            booking_id=booking.id,
            room_id=test_room.id,
            name="test",
            starts_at=booking.start_time,
            ends_at=booking.end_time,
        )

        resp = await client.delete(f"/api/v1/bookings/{booking.id}", headers=auth_headers)
        assert resp.status_code == 204, resp.text

        assert locks.revoked_booking_ids == [booking.id]
        assert locks.issued_code_for(booking.id) is None

    async def test_admin_cancel_revokes_code(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, locks
    ):
        booking = await _make_confirmed_booking(
            db_session, org=test_org, room=test_room, user=admin_user
        )
        await locks.issue_access_code(
            booking_id=booking.id,
            room_id=test_room.id,
            name="test",
            starts_at=booking.start_time,
            ends_at=booking.end_time,
        )

        resp = await client.put(
            f"/api/v1/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert locks.revoked_booking_ids == [booking.id]

    async def test_cancel_with_no_issued_code_still_succeeds(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member, locks
    ):
        """No code on file (e.g. issuance itself already failed) is not an error."""
        booking = await _make_confirmed_booking(
            db_session, org=test_org, room=test_room, user=test_user
        )

        resp = await client.delete(f"/api/v1/bookings/{booking.id}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert locks.revoked_booking_ids == []


class TestSeamBestEffort:
    """Integration — Epic 3.3: Seam failures never turn into a 500."""

    async def test_issue_failure_still_confirms_booking(
        self, client, auth_headers, test_room, test_member, payments, locks, monkeypatch, caplog
    ):
        async def boom(**_kwargs):
            raise LockProviderError("Seam is down")

        monkeypatch.setattr(locks, "issue_access_code", boom)

        booking = await _create_pending_booking(client, auth_headers, test_room)
        booking_id = uuid.UUID(booking["id"])
        payload = checkout_completed_event(
            session_id=f"cs_stub_{booking_id.hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )

        with caplog.at_level("ERROR", logger="app.locks"):
            resp = await client.post(
                WEBHOOK_URL,
                content=payload,
                headers={"Stripe-Signature": payments.sign_payload(payload)},
            )
        # The webhook still 2xxs and confirms the booking despite Seam blowing up.
        assert resp.status_code == 200, resp.text
        assert resp.json()["handled"] is True
        assert "Failed to issue Seam access code" in caplog.text

        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        confirmed = next(b for b in listed.json()["bookings"] if b["id"] == booking["id"])
        assert confirmed["status"] == "confirmed"
        assert confirmed["access_code"] is None

    async def test_unexpected_exception_during_issue_is_swallowed(
        self, client, auth_headers, test_room, test_member, payments, locks, monkeypatch
    ):
        """Even a bug that raises something other than LockProviderError must
        not 500 the webhook — Epic 3.3 says "the failure is logged, not
        raised as a 500" with no carve-out for what kind of failure it is."""

        async def boom(**_kwargs):
            raise RuntimeError("programming error inside the gateway")

        monkeypatch.setattr(locks, "issue_access_code", boom)

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

    async def test_revoke_failure_still_cancels_booking(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member,
        locks, monkeypatch, caplog,
    ):
        booking = await _make_confirmed_booking(
            db_session, org=test_org, room=test_room, user=test_user
        )
        await locks.issue_access_code(
            booking_id=booking.id,
            room_id=test_room.id,
            name="test",
            starts_at=booking.start_time,
            ends_at=booking.end_time,
        )

        async def boom(**_kwargs):
            raise LockProviderError("Seam is down")

        monkeypatch.setattr(locks, "revoke_access_code", boom)

        with caplog.at_level("ERROR", logger="app.locks"):
            resp = await client.delete(f"/api/v1/bookings/{booking.id}", headers=auth_headers)
        # The user must still be able to cancel their booking despite Seam
        # blowing up on revocation.
        assert resp.status_code == 204, resp.text
        assert "Failed to revoke Seam access code" in caplog.text

    async def test_admin_update_survives_issue_failure(
        self, client, admin_headers, db_session, test_org, test_room, admin_user, locks, monkeypatch
    ):
        async def boom(**_kwargs):
            raise LockProviderError("Seam is down")

        monkeypatch.setattr(locks, "issue_access_code", boom)

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
        assert resp.json()["booking"]["access_code"] is None


async def test_failed_revoke_retains_identifier_until_successful_retry(monkeypatch):
    gateway = StubLockGateway()
    booking_id = uuid.uuid4()
    start, end = _future_slot()
    code = await gateway.issue_access_code(booking_id=booking_id, room_id=uuid.uuid4(), name="test", starts_at=start, ends_at=end)
    original = gateway._revoke

    async def fail(**kwargs):
        raise LockProviderError("temporarily unavailable")

    monkeypatch.setattr(gateway, "_revoke", fail)
    with pytest.raises(LockProviderError):
        await gateway.revoke_access_code(booking_id=booking_id)
    assert gateway.issued_code_for(booking_id) == code
    monkeypatch.setattr(gateway, "_revoke", original)
    await gateway.revoke_access_code(booking_id=booking_id)
    assert gateway.issued_code_for(booking_id) is None
    assert gateway.revoked_booking_ids == [booking_id]


async def test_repeat_issue_does_not_create_another_code(monkeypatch):
    gateway = StubLockGateway()
    start, end = _future_slot()
    args = dict(booking_id=uuid.uuid4(), room_id=uuid.uuid4(), name="test", starts_at=start, ends_at=end)
    first = await gateway.issue_access_code(**args)

    async def unexpected(**kwargs):
        pytest.fail("issuing twice must reuse the existing identifier")

    monkeypatch.setattr(gateway, "_issue", unexpected)
    assert await gateway.issue_access_code(**args) == first


def test_live_mode_with_credentials_is_gated_until_codes_are_durable(monkeypatch):
    monkeypatch.setattr(settings, "SEAM_MODE", "live")
    monkeypatch.setattr(settings, "SEAM_API_KEY", "test-only")
    with pytest.raises(LockNotConfigured, match="persisted"):
        validate_lock_settings()


async def test_cancelled_booking_hides_code_after_failed_revocation(
    client, auth_headers, db_session, test_org, test_room, test_user, test_member, locks, monkeypatch,
):
    booking = await _make_confirmed_booking(db_session, org=test_org, room=test_room, user=test_user)
    await locks.issue_access_code(booking_id=booking.id, room_id=test_room.id, name="test", starts_at=booking.start_time, ends_at=booking.end_time)

    async def fail(**kwargs):
        raise LockProviderError("temporarily unavailable")

    monkeypatch.setattr(locks, "_revoke", fail)
    response = await client.delete(f"/api/v1/bookings/{booking.id}", headers=auth_headers)
    assert response.status_code == 204, response.text
    assert locks.issued_code_for(booking.id) is not None
    response = await client.get("/api/v1/bookings/me", headers=auth_headers)
    row = next(b for b in response.json()["bookings"] if b["id"] == str(booking.id))
    assert row["status"] == "cancelled"
    assert row["access_code"] is None
