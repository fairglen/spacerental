import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import OrganizationMember, MemberRole
from app.models.user import User
from app.payments import PaymentProviderError


def _future_slot(hours_offset_from_now: int = 24 * 7, duration_hours: int = 2):
    """Return (start, end) ISO strings on an upcoming Monday at 10:00 UTC."""
    today = datetime.now(tz=timezone.utc).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    target_date = today + timedelta(days=days_ahead + 7)
    start = datetime.combine(target_date, time(10, 0), tzinfo=timezone.utc)
    end = start + timedelta(hours=duration_hours)
    return start.isoformat(), end.isoformat()


class TestCreateBooking:
    async def test_create_booking_requires_auth(self, client, test_room):
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
        )
        assert resp.status_code == 401

    async def test_create_booking_success(
        self, client, auth_headers, test_room, test_member
    ):
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        b = body["booking"]
        assert b["room_id"] == str(test_room.id)
        # Payment-first: the webhook, not this request, confirms the booking.
        assert b["status"] == "pending"
        assert Decimal(b["duration_hours"]) == Decimal("2.00")
        # hourly_rate 11.00 * 2 hours
        assert Decimal(b["total_amount"]) == Decimal("22.00")

    async def test_create_booking_overlap_rejected(
        self, client, auth_headers, test_room, test_member
    ):
        start, end = _future_slot()
        first = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert first.status_code == 201, first.text
        second = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert second.status_code in (400, 409)
        # We expect 409 specifically per the router
        assert second.status_code == 409


class TestBookingCheckout:
    """Story 2.1 — checkout for hourly bookings."""

    async def test_returns_checkout_url_and_leaves_booking_pending(
        self, client, auth_headers, test_room, test_member, payments
    ):
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()

        booking = body["booking"]
        assert booking["status"] == "pending"
        assert body["checkout_url"].endswith(f"cs_stub_{uuid.UUID(booking['id']).hex}")

        # The session was opened for the booking's own total, in cents.
        session = payments.sessions[f"cs_stub_{uuid.UUID(booking['id']).hex}"]
        assert session["amount_cents"] == 2200
        assert Decimal(booking["total_amount"]) == Decimal("22.00")
        assert session["kind"] == "booking"
        assert session["org_id"] == str(test_room.org_id)

        # Still pending on read-back: nothing but the webhook confirms it.
        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert listed.json()["bookings"][0]["status"] == "pending"

    async def test_package_payment_method_rejected(
        self, client, auth_headers, test_room, test_member, payments
    ):
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "package",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert payments.sessions == {}

    async def test_checkout_failure_leaves_no_booking(
        self, client, auth_headers, test_room, test_member, payments, monkeypatch
    ):
        async def boom(**_kwargs):
            raise PaymentProviderError("card network down")

        monkeypatch.setattr(payments, "create_checkout_session", boom)

        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 502, resp.text

        # The slot must not stay locked by a booking nobody can pay for.
        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert listed.json()["bookings"] == []


class TestListMyBookings:
    async def test_list_my_bookings_returns_only_mine(
        self,
        client,
        db_session,
        test_org,
        test_room,
        test_user,
        test_member,
        auth_headers,
    ):
        # Create a second user who is also a member of the org
        other = User(
            email="other@test.com",
            name="Other",
            password_hash=hash_password("password123"),
        )
        db_session.add(other)
        await db_session.flush()
        db_session.add(
            OrganizationMember(
                org_id=test_org.id, user_id=other.id, role=MemberRole.member
            )
        )
        await db_session.commit()
        await db_session.refresh(other)

        # Each user books a different 2h slot
        start1, end1 = _future_slot(duration_hours=2)
        start2_dt = datetime.fromisoformat(start1) + timedelta(hours=3)
        end2_dt = start2_dt + timedelta(hours=2)
        start2, end2 = start2_dt.isoformat(), end2_dt.isoformat()

        # Test user books slot 1
        r1 = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start1, "end_time": end1},
            headers=auth_headers,
        )
        assert r1.status_code == 201, r1.text

        # Other user books slot 2
        other_token = create_access_token(
            {
                "sub": str(other.id),
                "email": other.email,
                "name": other.name,
                "role": "member",
            }
        )
        other_headers = {"Authorization": f"Bearer {other_token}"}
        r2 = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start2, "end_time": end2},
            headers=other_headers,
        )
        assert r2.status_code == 201, r2.text

        # Each user only sees their own bookings
        mine = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert mine.status_code == 200
        my_list = mine.json()["bookings"]
        assert len(my_list) == 1
        assert my_list[0]["user_id"] == str(test_user.id)

        theirs = await client.get("/api/v1/bookings/me", headers=other_headers)
        assert theirs.status_code == 200
        their_list = theirs.json()["bookings"]
        assert len(their_list) == 1
        assert their_list[0]["user_id"] == str(other.id)


class TestCancelBooking:
    async def test_cancel_booking_own_success(
        self, client, auth_headers, test_room, test_member
    ):
        start, end = _future_slot()
        r = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        booking_id = r.json()["booking"]["id"]

        resp = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert resp.status_code == 204

    async def test_cancel_booking_other_user_forbidden(
        self,
        client,
        db_session,
        test_org,
        test_room,
        auth_headers,
        test_member,
    ):
        # test_user creates booking
        start, end = _future_slot()
        r = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        booking_id = r.json()["booking"]["id"]

        # Different user tries to cancel
        intruder = User(
            email="intruder@test.com",
            name="Intruder",
            password_hash=hash_password("password123"),
        )
        db_session.add(intruder)
        await db_session.flush()
        db_session.add(
            OrganizationMember(
                org_id=test_org.id, user_id=intruder.id, role=MemberRole.member
            )
        )
        await db_session.commit()
        await db_session.refresh(intruder)

        token = create_access_token(
            {
                "sub": str(intruder.id),
                "email": intruder.email,
                "name": intruder.name,
                "role": "member",
            }
        )
        headers = {"Authorization": f"Bearer {token}"}
        resp = await client.delete(f"/api/v1/bookings/{booking_id}", headers=headers)
        assert resp.status_code == 403


class TestCancelBookingTooSoon:
    async def test_cancel_within_24h_returns_400(
        self,
        client,
        db_session,
        test_org,
        test_room,
        test_user,
        test_member,
        auth_headers,
    ):
        # Insert directly: create_booking enforces other rules we want to sidestep.
        start = datetime.now(tz=timezone.utc) + timedelta(hours=1)
        end = start + timedelta(hours=2)
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
        assert resp.status_code == 400, resp.text
        assert "24" in resp.json()["detail"]
