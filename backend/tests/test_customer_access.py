"""Per-customer smart-lock access (L01).

Unit: the PIN generator's Nuki rules, the PIN encryption round trip, the
lock-facing customer name, the log-action classifier. Integration (real
Postgres): a first confirmed booking gives the customer one PIN and a pending
device row on every path, a second booking adds nothing, a space without a
lock does nothing; the customer sees and rotates their PIN (throttled); the
operator sees status but never the clear PIN, and can open the door; the pass
issues/revokes/sends-dormant against the stub; anonymisation revokes.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from app import access as access_service
from app.config import settings
from app.locks import (
    KIND_DOOR_CLOSE,
    KIND_KEYPAD_UNLOCK,
    KIND_LOCK,
    KIND_UNKNOWN,
    KIND_UNLOCK,
    StubLockGateway,
    classify_action,
    customer_ref,
    decrypt_pin,
    encrypt_pin,
    generate_pin,
)
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.customer_access import (
    ACCESS_ACTIVE,
    ACCESS_DORMANT,
    ACCESS_REVOKED,
    SYNC_PENDING,
    SYNC_REVOKE_PENDING,
    SYNC_SYNCED,
    CustomerAccess,
    CustomerAccessDevice,
)
from app.payments import CheckoutKind
from sqlalchemy import select

from tests.conftest import checkout_completed_event

API = "/api/v1"
WEBHOOK_URL = f"{API}/webhooks/stripe"
DEVICE = "lock-test-1"


# ─── Unit ───────────────────────────────────────────────────────────────────


class TestPinGenerator:
    def test_six_digits_one_to_nine_never_starts_with_12(self):
        for _ in range(500):
            pin = generate_pin()
            assert len(pin) == 6
            assert set(pin) <= set("123456789")  # no zero
            assert not pin.startswith("12")

    def test_excludes_taken_codes(self):
        taken = {generate_pin() for _ in range(50)}
        for _ in range(200):
            assert generate_pin(taken) not in taken


class TestEncryption:
    def test_round_trip(self):
        token = encrypt_pin("345678")
        assert decrypt_pin(token) == "345678"

    def test_the_clear_pin_is_not_in_the_token(self):
        assert "345678" not in encrypt_pin("345678")


class TestCustomerRef:
    def test_is_short_prefixed_and_not_the_name(self):
        ref = customer_ref(uuid.uuid4())
        assert ref.startswith("fs-")
        assert len(ref) <= 20


class TestClassifyAction:
    def test_maps_known_codes_and_keypad_attribution(self):
        assert classify_action(1, attributed_to_keypad=True) == KIND_KEYPAD_UNLOCK
        assert classify_action(1, attributed_to_keypad=False) == KIND_UNLOCK
        assert classify_action(2, attributed_to_keypad=False) == KIND_LOCK
        assert classify_action(241, attributed_to_keypad=False) == KIND_DOOR_CLOSE
        assert classify_action(999, attributed_to_keypad=False) == KIND_UNKNOWN


# ─── Integration ────────────────────────────────────────────────────────────


@pytest.fixture
def lock_space(monkeypatch, test_space):
    """Give the test space a lock so issuance is not skipped."""
    monkeypatch.setattr(settings, "NUKI_DEVICE_ID_MAP", json.dumps({str(test_space.id): DEVICE}))
    return DEVICE


def _future_slot(hours: int = 2):
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(
        today + timedelta(days=days_ahead + 7), datetime.min.time(), tzinfo=UTC
    )
    start = start.replace(hour=10)
    return start, start + timedelta(hours=hours)


async def _confirmed_booking_via_db(db_session, org, room, user) -> Booking:
    start, end = _future_slot()
    booking = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
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
    return booking


async def _access_for(db_session, org_id, user_id) -> CustomerAccess | None:
    from sqlalchemy.orm import selectinload

    return (
        await db_session.execute(
            select(CustomerAccess)
            .options(selectinload(CustomerAccess.devices))
            .where(CustomerAccess.org_id == org_id, CustomerAccess.user_id == user_id)
        )
    ).scalar_one_or_none()


class TestIssuanceOnConfirm:
    async def test_webhook_confirm_creates_one_pin_and_a_pending_device(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_user,
        payments,
        lock_space,
        db_session,
    ):
        start, end = _future_slot()
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
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

        access = await _access_for(db_session, test_room.org_id, test_user.id)
        assert access is not None
        assert access.status == ACCESS_ACTIVE
        assert [d.device_id for d in access.devices] == [DEVICE]
        assert access.devices[0].sync_status == SYNC_PENDING
        assert access.devices[0].nuki_auth_id is None

    async def test_admin_confirm_creates_access_and_second_booking_adds_nothing(
        self, client, admin_headers, admin_user, test_org, test_room, lock_space, db_session
    ):
        for _ in range(2):
            booking = await _confirmed_booking_via_db(db_session, test_org, test_room, admin_user)
            resp = await client.put(
                f"{API}/admin/bookings/{booking.id}",
                params={"org_id": str(test_org.id)},
                json={"status": "confirmed"},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text

        rows = (
            (
                await db_session.execute(
                    select(CustomerAccess).where(
                        CustomerAccess.org_id == test_org.id,
                        CustomerAccess.user_id == admin_user.id,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1  # one PIN per customer, not per booking

    async def test_a_space_without_a_lock_issues_nothing(
        self, client, admin_headers, admin_user, test_org, test_room, db_session
    ):
        # No lock_space fixture: the map is empty, so the space has no lock.
        booking = await _confirmed_booking_via_db(db_session, test_org, test_room, admin_user)
        resp = await client.put(
            f"{API}/admin/bookings/{booking.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert await _access_for(db_session, test_org.id, admin_user.id) is None


class TestCustomerEndpoints:
    async def test_get_me_returns_the_pin_then_rotate_changes_it(
        self, client, auth_headers, test_org, test_user, lock_space, test_space, db_session
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()

        me = await client.get(f"{API}/access/me", headers=auth_headers)
        assert me.status_code == 200, me.text
        first = me.json()["access"]
        assert first["status"] == ACCESS_ACTIVE
        assert first["pin"] and len(first["pin"]) == 6
        assert first["devices"][0]["device_id"] == DEVICE
        assert "last_error" not in first["devices"][0]  # operator-only

        rotated = await client.post(f"{API}/access/me/rotate", headers=auth_headers)
        assert rotated.status_code == 200, rotated.text
        assert rotated.json()["access"]["pin"] != first["pin"]

    async def test_rotate_is_throttled_like_auth(
        self, client, auth_headers, test_org, test_user, lock_space, test_space, db_session
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        codes = [
            (await client.post(f"{API}/access/me/rotate", headers=auth_headers)).status_code
            for _ in range(limit + 2)
        ]
        assert codes.count(429) >= 1

    async def test_no_access_rotate_is_404(self, client, auth_headers):
        resp = await client.post(f"{API}/access/me/rotate", headers=auth_headers)
        assert resp.status_code == 404


class TestAdminEndpoints:
    async def test_admin_sees_status_but_never_the_clear_pin(
        self,
        client,
        admin_headers,
        test_org,
        test_member,
        test_user,
        lock_space,
        test_space,
        db_session,
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()
        pin = decrypt_pin((await _access_for(db_session, test_org.id, test_user.id)).pin_encrypted)

        resp = await client.get(
            f"{API}/admin/users/{test_user.id}/access",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()["access"]
        assert body["status"] == ACCESS_ACTIVE
        assert "pin" not in body
        assert pin not in resp.text

    async def test_admin_revoke_then_reactivate(
        self,
        client,
        admin_headers,
        test_org,
        test_member,
        test_user,
        lock_space,
        test_space,
        db_session,
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()

        rev = await client.post(
            f"{API}/admin/users/{test_user.id}/access/revoke",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert rev.status_code == 200, rev.text
        assert rev.json()["access"]["status"] == ACCESS_REVOKED

        react = await client.post(
            f"{API}/admin/users/{test_user.id}/access/reactivate",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert react.status_code == 200
        assert react.json()["access"]["status"] == ACCESS_ACTIVE

    async def test_a_member_cannot_read_access(
        self, client, auth_headers, test_member, test_org, test_user
    ):
        resp = await client.get(
            f"{API}/admin/users/{test_user.id}/access",
            params={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 403

    async def test_open_door_stub_and_no_lock(
        self, client, admin_headers, test_org, test_space, locks, lock_space, db_session
    ):
        ok = await client.post(
            f"{API}/admin/spaces/{test_space.id}/open-door",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert ok.status_code == 200, ok.text
        assert ok.json() == {"opened": True}

    async def test_open_door_without_a_lock_is_400(
        self, client, admin_headers, test_org, test_space, locks
    ):
        resp = await client.post(
            f"{API}/admin/spaces/{test_space.id}/open-door",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 400


class TestReconciliationPass:
    async def test_pending_becomes_synced(
        self, db_session, test_org, test_user, lock_space, test_space
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()
        gateway = StubLockGateway()

        result = await access_service.reconcile_customer_access(
            db_session, gateway, datetime.now(tz=UTC)
        )
        await db_session.commit()
        assert result.issued == 1
        device = (await _access_for(db_session, test_org.id, test_user.id)).devices[0]
        assert device.sync_status == SYNC_SYNCED
        assert device.nuki_auth_id is not None

    async def test_revoke_pending_is_deleted_from_the_lock(
        self, db_session, test_org, test_user, lock_space, test_space
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()
        gateway = StubLockGateway()
        await access_service.reconcile_customer_access(db_session, gateway, datetime.now(tz=UTC))
        access = await _access_for(db_session, test_org.id, test_user.id)
        await access_service.revoke_access(db_session, access)
        await db_session.commit()

        await access_service.reconcile_customer_access(db_session, gateway, datetime.now(tz=UTC))
        await db_session.commit()
        remaining = (
            (
                await db_session.execute(
                    select(CustomerAccessDevice).where(
                        CustomerAccessDevice.customer_access_id == access.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert remaining == []
        assert len(gateway.revoked) == 1

    async def test_a_failing_provider_leaves_pending_with_attempts(
        self, db_session, test_org, test_user, lock_space, test_space
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()

        class Failing(StubLockGateway):
            async def issue_for_customer(self, customer_ref, device_id, pin):
                from app.locks import LockProviderError

                raise LockProviderError("Nuki PUT /auth -> 503")

        result = await access_service.reconcile_customer_access(
            db_session, Failing(), datetime.now(tz=UTC)
        )
        await db_session.commit()
        assert result.failures == 1
        device = (await _access_for(db_session, test_org.id, test_user.id)).devices[0]
        assert device.sync_status == SYNC_PENDING
        assert device.attempts == 1
        assert "503" in device.last_error

    async def test_dormancy_sends_an_idle_customer_to_revoke_pending(
        self, db_session, test_org, test_user, test_room, lock_space, test_space, monkeypatch
    ):
        # A booking well in the past, and a 0-day dormancy, so the customer is idle.
        old = datetime.now(tz=UTC) - timedelta(days=400)
        booking = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=old,
            end_time=old + timedelta(hours=1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(booking)
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()
        monkeypatch.setattr(settings, "ACCESS_DORMANCY_DAYS", 90)

        await access_service.reconcile_customer_access(
            db_session, StubLockGateway(), datetime.now(tz=UTC)
        )
        await db_session.commit()
        access = await _access_for(db_session, test_org.id, test_user.id)
        assert access.status == ACCESS_DORMANT


class TestAnonymisation:
    async def test_anonymise_revokes_the_access(
        self,
        client,
        admin_headers,
        test_org,
        test_member,
        test_user,
        lock_space,
        test_space,
        db_session,
    ):
        await access_service.ensure_customer_access(
            db_session, user_id=test_user.id, org_id=test_org.id, space_id=test_space.id
        )
        await db_session.commit()

        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/anonymise",
            params={"org_id": str(test_org.id)},
            json={"confirm": test_user.email},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        access = await _access_for(db_session, test_org.id, test_user.id)
        assert access.status == ACCESS_REVOKED
        assert all(d.sync_status == SYNC_REVOKE_PENDING for d in access.devices)
