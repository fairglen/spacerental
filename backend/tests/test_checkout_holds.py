"""C03 slice: unpaid holds expire, can be resumed or retried, and a payment
that arrives late is never dropped.

Every test pins the clock through `app.clock.utcnow` instead of sleeping.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest_asyncio
from app import clock
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.user import User
from app.payments import CheckoutKind
from sqlalchemy import select

from tests.conftest import checkout_completed_event

WEBHOOK_URL = "/api/v1/webhooks/stripe"


def _monday(days_out: int = 14) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days_ahead + days_out), time(10, 0), tzinfo=UTC)


def _pin(monkeypatch, at: datetime) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: at)


async def _book(client, headers, room, start: datetime, hours: int = 1) -> dict:
    resp = await client.post(
        "/api/v1/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": "hourly",
        },
        headers=headers,
    )
    return resp


async def _mine(client, headers, booking_id: str) -> dict:
    resp = await client.get("/api/v1/bookings/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return next(b for b in resp.json()["bookings"] if b["id"] == booking_id)


async def _availability(client, room, day: datetime) -> dict[int, bool]:
    resp = await client.get(
        f"/api/v1/rooms/{room.id}/availability", params={"date": day.date().isoformat()}
    )
    assert resp.status_code == 200, resp.text
    return {datetime.fromisoformat(s["start"]).hour: s["available"] for s in resp.json()["slots"]}


async def _post_webhook(client, payments, booking: dict, org_id) -> dict:
    # The stub's session id is derived from the booking id (app/payments.py).
    payload = checkout_completed_event(
        session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
        kind=CheckoutKind.booking,
        reference_id=booking["id"],
        org_id=org_id,
    )
    resp = await client.post(
        WEBHOOK_URL, content=payload, headers={"Stripe-Signature": payments.sign_payload(payload)}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _db_booking(db_session, booking_id: str) -> Booking:
    result = await db_session.execute(
        select(Booking)
        .where(Booking.id == uuid.UUID(booking_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


@pytest_asyncio.fixture
async def other_headers(db_session, test_org):
    u = User(email="other@test.com", name="Other", password_hash=hash_password("password123"))
    db_session.add(u)
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.member))
    await db_session.commit()
    token = create_access_token(
        {"sub": str(u.id), "email": u.email, "name": u.name, "role": "member"}
    )
    return {"Authorization": f"Bearer {token}"}


class TestCancelUnpaidHold:
    async def test_owner_can_cancel_a_pending_hold_inside_24h(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(hours=2))  # well inside the 24h window
        created = await _book(client, auth_headers, test_room, start)
        assert created.status_code == 201, created.text
        booking = created.json()["booking"]
        assert booking["status"] == "pending"
        assert booking["hold_expires_at"] is not None

        resp = await client.delete(f"/api/v1/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "cancelled"
        assert (await _availability(client, test_room, start))[10] is True

    async def test_paid_booking_inside_24h_is_still_refused(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(hours=2))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        await _post_webhook(client, payments, booking, test_room.org_id)
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "confirmed"

        resp = await client.delete(f"/api/v1/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 400
        assert "24" in resp.json()["detail"]


class TestHoldExpiry:
    async def test_expired_hold_releases_the_slot_without_a_sweeper(
        self,
        client,
        auth_headers,
        other_headers,
        test_room,
        test_member,
        payments,
        monkeypatch,
        db_session,
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        deadline = datetime.fromisoformat(booking["hold_expires_at"])
        assert deadline == t0 + timedelta(minutes=15)

        _pin(monkeypatch, t0 + timedelta(minutes=14))
        assert (await _availability(client, test_room, start))[10] is False
        second = await _book(client, other_headers, test_room, start)
        assert second.status_code == 409

        _pin(monkeypatch, t0 + timedelta(minutes=16))
        assert (await _availability(client, test_room, start))[10] is True
        second = await _book(client, other_headers, test_room, start)
        assert second.status_code == 201, second.text

        # The stale hold was flipped on the way past the EXCLUDE constraint.
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.expired
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "expired"

    async def test_reading_my_bookings_expires_my_stale_holds(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        _pin(monkeypatch, t0 + timedelta(minutes=16))
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "expired"

    async def test_series_occurrences_and_package_bookings_never_expire(
        self, client, db_session, test_org, test_user, test_room, monkeypatch
    ):
        start = _monday()
        db_session.add(
            Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                duration_hours=Decimal("1.00"),
                total_amount=Decimal("11.00"),
                status=BookingStatus.pending,
                payment_method=PaymentMethod.hourly,
                hold_expires_at=None,
            )
        )
        await db_session.commit()
        _pin(monkeypatch, start - timedelta(hours=1))
        assert (await _availability(client, test_room, start))[10] is False


class TestPayNow:
    async def test_valid_hold_returns_a_checkout_url_and_no_second_booking(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]

        resp = await client.post(f"/api/v1/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["booking"]["id"] == booking["id"]
        assert body["booking"]["status"] == "pending"
        assert body["checkout_url"].startswith("http://test/checkout/stub/")
        mine = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert len(mine.json()["bookings"]) == 1

    async def test_expired_hold_is_retried_when_the_slot_is_free(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "expired"

        resp = await client.post(f"/api/v1/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()["booking"]
        assert body["status"] == "pending"
        assert datetime.fromisoformat(body["hold_expires_at"]) == t0 + timedelta(minutes=45)
        assert (await _availability(client, test_room, start))[10] is False

    async def test_expired_hold_cannot_be_retried_once_the_slot_is_taken(
        self, client, auth_headers, other_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        assert (await _book(client, other_headers, test_room, start)).status_code == 201

        resp = await client.post(f"/api/v1/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert resp.status_code == 409, resp.text
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "expired"

    async def test_only_the_owner_can_pay_and_only_unpaid_rows(
        self, client, auth_headers, other_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        resp = await client.post(
            f"/api/v1/bookings/{booking['id']}/checkout", headers=other_headers
        )
        assert resp.status_code == 403

        await _post_webhook(client, payments, booking, test_room.org_id)
        resp = await client.post(f"/api/v1/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert resp.status_code == 409
        resp = await client.post(f"/api/v1/bookings/{uuid.uuid4()}/checkout", headers=auth_headers)
        assert resp.status_code == 404


class TestLatePayment:
    async def test_late_payment_confirms_when_the_slot_is_still_free(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "expired"

        assert (await _post_webhook(client, payments, booking, test_room.org_id))["handled"] is True
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "confirmed"
        assert (await _availability(client, test_room, start))[10] is False

    async def test_late_payment_for_a_taken_slot_is_kept_as_paid_unfulfilled(
        self, client, auth_headers, other_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        winner = (await _book(client, other_headers, test_room, start)).json()["booking"]

        assert (await _post_webhook(client, payments, booking, test_room.org_id))["handled"] is True
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "paid_unfulfilled"
        assert (await _mine(client, other_headers, winner["id"]))["status"] == "pending"

    async def test_duplicate_completion_is_a_no_op(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch, emails
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        assert (await _post_webhook(client, payments, booking, test_room.org_id))["handled"] is True
        assert (await _post_webhook(client, payments, booking, test_room.org_id))[
            "handled"
        ] is False
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "confirmed"
        assert len(emails.sent) == 1


class TestStubCancel:
    async def test_cancel_on_the_stub_page_releases_the_hold_immediately(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        created = (await _book(client, auth_headers, test_room, start)).json()
        session_id = created["checkout_url"].rsplit("/", 1)[-1]

        resp = await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        assert resp.status_code == 303
        assert (await _mine(client, auth_headers, created["booking"]["id"]))["status"] == "expired"
        assert (await _availability(client, test_room, start))[10] is True

        # Same state machine as a lapsed hold: it can be paid again from the dashboard.
        resp = await client.post(
            f"/api/v1/bookings/{created['booking']['id']}/checkout", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["status"] == "pending"


class TestReviewFindings:
    """Copilot review on PR #46: the C03 paths must be race-safe."""

    async def test_concurrent_duplicate_completions_confirm_once(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch, emails, locks
    ):
        import asyncio

        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        payload = checkout_completed_event(
            session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_room.org_id,
        )
        headers = {"Stripe-Signature": payments.sign_payload(payload)}
        responses = await asyncio.gather(
            *[client.post(WEBHOOK_URL, content=payload, headers=headers) for _ in range(3)]
        )
        assert [r.status_code for r in responses] == [200, 200, 200]
        assert sorted(r.json()["handled"] for r in responses) == [False, False, True]
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "confirmed"
        assert len(emails.sent) == 1

    async def test_stub_cancel_after_payment_does_not_expire_a_paid_booking(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        created = (await _book(client, auth_headers, test_room, start)).json()
        session_id = created["checkout_url"].rsplit("/", 1)[-1]
        assert (
            await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        ).status_code == 303
        # A stale checkout tab pressing Cancelar after paying must be a no-op.
        assert (
            await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        ).status_code == 303
        assert (await _mine(client, auth_headers, created["booking"]["id"]))[
            "status"
        ] == "confirmed"

    async def test_resume_refuses_to_replace_a_session_the_provider_reports_completed(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        from app.payments import CheckoutSessionCompletedError

        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]

        async def completed(session_id: str) -> None:
            raise CheckoutSessionCompletedError(session_id)

        # Live Stripe reports the old session as complete (paid, webhook not
        # yet delivered): the booking must keep its session id so that
        # webhook still matches, instead of minting a replacement. Both
        # provider lookups can report it, whichever the route reaches first.
        monkeypatch.setattr(payments, "get_checkout_url", completed)
        monkeypatch.setattr(payments, "expire_checkout_session", completed)
        resp = await client.post(f"/api/v1/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert resp.status_code == 409, resp.text
        assert "already" in resp.json()["detail"].lower()
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "pending"
        # And the original session can still be completed by its webhook.
        assert (await _post_webhook(client, payments, booking, test_room.org_id))["handled"] is True


async def _admin_headers(db_session, test_org):
    u = User(email="op@test.com", name="Operator", password_hash=hash_password("password123"))
    db_session.add(u)
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.owner))
    await db_session.commit()
    token = create_access_token(
        {"sub": str(u.id), "email": u.email, "name": u.name, "role": "owner"}
    )
    return {"Authorization": f"Bearer {token}"}


class TestSecondReview:
    """Copilot's second pass on PR #46: every slot-acquiring path agrees on holds."""

    async def test_admin_write_reconciles_a_stale_hold_it_overlaps(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        monkeypatch,
        db_session,
        test_org,
        test_user,
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        hold = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        # A cancelled one-off of the same customer the operator reinstates.
        other = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=start,
            end_time=start + timedelta(hours=1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.cancelled,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(other)
        await db_session.commit()
        await db_session.refresh(other)
        admin = await _admin_headers(db_session, test_org)

        _pin(monkeypatch, t0 + timedelta(minutes=30))
        resp = await client.put(
            f"/api/v1/admin/bookings/{other.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["hold_expires_at"] is None
        # The lapsed hold was flipped before the write, so the EXCLUDE
        # constraint (present in real databases) cannot trip on it.
        assert (await _db_booking(db_session, hold["id"])).status is BookingStatus.expired

    async def test_admin_reviving_a_one_off_as_pending_gets_a_fresh_deadline(
        self, client, test_room, monkeypatch, db_session, test_org, test_user
    ):
        start = _monday()
        now = start - timedelta(days=3)
        _pin(monkeypatch, now)
        row = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=start,
            end_time=start + timedelta(hours=1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.cancelled,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        admin = await _admin_headers(db_session, test_org)
        resp = await client.put(
            f"/api/v1/admin/bookings/{row.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "pending"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert datetime.fromisoformat(resp.json()["booking"]["hold_expires_at"]) == now + timedelta(
            minutes=15
        )

    async def test_late_webhook_is_detected_by_deadline_not_only_by_status(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        monkeypatch,
        db_session,
        test_org,
        test_user,
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        hold = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        # Nobody read or wrote the slot after the deadline, so the row is still
        # `pending`; another confirmed booking now owns the hour (inserted
        # directly, as a series or admin write could).
        winner = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=start,
            end_time=start + timedelta(hours=1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        db_session.add(winner)
        await db_session.commit()
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        assert (await _post_webhook(client, payments, hold, test_room.org_id))["handled"] is True
        assert (await _mine(client, auth_headers, hold["id"]))["status"] == "paid_unfulfilled"

    async def test_duplicate_completion_cannot_resurrect_a_cancelled_paid_booking(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch, emails
    ):
        start = _monday()
        _pin(monkeypatch, start - timedelta(days=3))
        booking = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        assert (await _post_webhook(client, payments, booking, test_room.org_id))["handled"] is True
        assert (
            await client.delete(f"/api/v1/bookings/{booking['id']}", headers=auth_headers)
        ).status_code == 204
        # Stripe retries the same completion after the customer cancelled.
        assert (await _post_webhook(client, payments, booking, test_room.org_id))[
            "handled"
        ] is False
        assert (await _mine(client, auth_headers, booking["id"]))["status"] == "cancelled"
        assert (await _availability(client, test_room, start))[10] is True
        assert len(emails.sent) == 2  # the confirmation and the cancellation, nothing more


class TestThirdReview:
    """Copilot's third pass on PR #46."""

    def test_hold_minutes_must_be_positive(self):
        import pytest
        from app.config import Settings
        from pydantic import ValidationError

        for bad in (0, -5):
            with pytest.raises(ValidationError):
                Settings(BOOKING_HOLD_MINUTES=bad)
        assert Settings(BOOKING_HOLD_MINUTES=1).BOOKING_HOLD_MINUTES == 1

    async def test_admin_pending_to_pending_keeps_the_deadline_and_packages_stay_free(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        monkeypatch,
        db_session,
        test_org,
        test_user,
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        hold = (await _book(client, auth_headers, test_room, start)).json()["booking"]
        admin = await _admin_headers(db_session, test_org)
        _pin(monkeypatch, t0 + timedelta(minutes=10))
        # Re-asserting `pending` must not extend an abandoned hold's life.
        resp = await client.put(
            f"/api/v1/admin/bookings/{hold['id']}",
            params={"org_id": str(test_org.id)},
            json={"status": "pending"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["hold_expires_at"] == hold["hold_expires_at"]

        # A package-paid booking is never a checkout hold, whatever its status.
        pkg_row = Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=test_user.id,
            start_time=start + timedelta(hours=2),
            end_time=start + timedelta(hours=3),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.cancelled,
            payment_method=PaymentMethod.package,
        )
        db_session.add(pkg_row)
        await db_session.commit()
        await db_session.refresh(pkg_row)
        resp = await client.put(
            f"/api/v1/admin/bookings/{pkg_row.id}",
            params={"org_id": str(test_org.id)},
            json={"status": "pending"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["hold_expires_at"] is None

    async def test_pay_now_on_a_live_hold_returns_the_open_session_without_expiring_it(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        start = _monday()
        t0 = start - timedelta(days=3)
        _pin(monkeypatch, t0)
        created = (await _book(client, auth_headers, test_room, start)).json()
        expired_ids: list[str] = []
        original = payments.expire_checkout_session

        async def recording(session_id: str) -> None:
            expired_ids.append(session_id)
            await original(session_id)

        monkeypatch.setattr(payments, "expire_checkout_session", recording)
        # Two tabs press "Pagar agora" while the hold is live: neither may
        # invalidate the session the other was just sent to.
        first = await client.post(
            f"/api/v1/bookings/{created['booking']['id']}/checkout", headers=auth_headers
        )
        second = await client.post(
            f"/api/v1/bookings/{created['booking']['id']}/checkout", headers=auth_headers
        )
        assert first.status_code == second.status_code == 200
        assert (
            first.json()["checkout_url"] == second.json()["checkout_url"] == created["checkout_url"]
        )
        assert expired_ids == []

        # Once lapsed, the retry really does replace the session.
        _pin(monkeypatch, t0 + timedelta(minutes=30))
        retry = await client.post(
            f"/api/v1/bookings/{created['booking']['id']}/checkout", headers=auth_headers
        )
        assert retry.status_code == 200, retry.text
        assert expired_ids == [created["checkout_url"].rsplit("/", 1)[-1]]
