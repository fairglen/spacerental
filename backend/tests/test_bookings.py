import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.payments import PaymentProviderError


def _next_monday():
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return today + timedelta(days=days_ahead + 7)


def _future_slot(hours_offset_from_now: int = 24 * 7, duration_hours: int = 2):
    """Return (start, end) ISO strings on an upcoming Monday at 10:00 UTC."""
    target_date = _next_monday()
    start = datetime.combine(target_date, time(10, 0), tzinfo=UTC)
    end = start + timedelta(hours=duration_hours)
    return start.isoformat(), end.isoformat()


def _monday_slot(hour: int, duration_hours: int = 1):
    """Return (start, end) ISO strings on the same upcoming Monday `_future_slot` uses."""
    target_date = _next_monday()
    start = datetime.combine(target_date, time(hour, 0), tzinfo=UTC)
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

    async def test_create_booking_success(self, client, auth_headers, test_room, test_member):
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

    async def test_package_payment_without_hours_is_rejected(
        self, client, auth_headers, test_room, test_member, payments
    ):
        """Story 2.4 covers redemption; with no purchase there is nothing to
        redeem, and no Checkout Session is opened as a fallback."""
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
        assert resp.status_code == 409, resp.text
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
            OrganizationMember(org_id=test_org.id, user_id=other.id, role=MemberRole.member)
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
    async def test_cancel_booking_own_success(self, client, auth_headers, test_room, test_member):
        start, end = _future_slot()
        r = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        booking_id = r.json()["booking"]["id"]

        resp = await client.delete(f"/api/v1/bookings/{booking_id}", headers=auth_headers)
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
            OrganizationMember(org_id=test_org.id, user_id=intruder.id, role=MemberRole.member)
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
        start = datetime.now(tz=UTC) + timedelta(hours=1)
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

        resp = await client.delete(f"/api/v1/bookings/{booking.id}", headers=auth_headers)
        assert resp.status_code == 400, resp.text
        assert "24" in resp.json()["detail"]


class TestBookingValidityBoundary:
    """C05 — the API cannot be used to acquire a slot the calendar UI never offers."""

    async def test_overlap_with_two_existing_bookings_returns_409_not_500(
        self, client, db_session, auth_headers, test_org, test_room, test_user, test_member
    ):
        """The confirmed crash: `scalar_one_or_none()` on 2+ overlapping rows
        raised an unhandled `MultipleResultsFound` (500) instead of a 409."""
        target_date = _next_monday()
        first_start = datetime.combine(target_date, time(9, 0), tzinfo=UTC)
        second_start = datetime.combine(target_date, time(11, 0), tzinfo=UTC)
        for start in (first_start, second_start):
            db_session.add(
                Booking(
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
            )
        await db_session.commit()

        # 09:00-12:00 overlaps both the 09:00-10:00 and the 11:00-12:00 booking,
        # while the two existing bookings do not overlap each other.
        start = first_start.isoformat()
        end = (first_start + timedelta(hours=3)).isoformat()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        assert "already booked" in resp.json()["detail"]

    async def test_wrong_org_membership_is_denied(
        self, client, db_session, auth_headers, test_room
    ):
        """test_user is not a member of any org other than test_org's — booking
        against a room in a different org must be refused, not just scoped away."""
        other_org = Organization(
            name="Other Org", slug="other-org", plan=OrgPlan.starter, settings={}
        )
        db_session.add(other_org)
        await db_session.flush()
        other_space = Space(org_id=other_org.id, name="Other Space", images=[], amenities=[])
        db_session.add(other_space)
        await db_session.flush()
        other_room = Room(
            space_id=other_space.id,
            org_id=other_org.id,
            name="Other Room",
            hourly_rate=Decimal("10.00"),
            images=[],
            amenities=[],
        )
        db_session.add(other_room)
        await db_session.flush()
        for day in range(6):
            db_session.add(
                AvailabilityRule(
                    room_id=other_room.id,
                    day_of_week=day,
                    open_time=time(8, 0),
                    close_time=time(20, 0),
                )
            )
        await db_session.commit()
        await db_session.refresh(other_room)

        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(other_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 403, resp.text

    async def test_past_start_time_rejected(self, client, auth_headers, test_room, test_member):
        start = (datetime.now(tz=UTC) - timedelta(days=1)).isoformat()
        end = (datetime.now(tz=UTC) + timedelta(hours=1)).isoformat()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "past" in resp.json()["detail"]

    async def test_naive_datetime_is_rejected(self, client, auth_headers, test_room, test_member):
        target_date = _next_monday()
        naive_start = datetime.combine(target_date, time(10, 0)).isoformat()
        naive_end = datetime.combine(target_date, time(11, 0)).isoformat()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": naive_start, "end_time": naive_end},
            headers=auth_headers,
        )
        # Pydantic v2 field validation failures are 422s, not app-level 400s.
        assert resp.status_code == 422, resp.text

    async def test_range_spanning_a_closed_lunch_gap_is_rejected(
        self, client, db_session, auth_headers, test_org, test_space, test_user, test_member
    ):
        room = Room(
            space_id=test_space.id,
            org_id=test_org.id,
            name="Sala com Almoço",
            hourly_rate=Decimal("11.00"),
            images=[],
            amenities=[],
        )
        db_session.add(room)
        await db_session.flush()
        for day in range(6):
            db_session.add(
                AvailabilityRule(
                    room_id=room.id, day_of_week=day, open_time=time(8, 0), close_time=time(12, 0)
                )
            )
            db_session.add(
                AvailabilityRule(
                    room_id=room.id, day_of_week=day, open_time=time(13, 0), close_time=time(20, 0)
                )
            )
        await db_session.commit()
        await db_session.refresh(room)

        # 11:00-14:00 straddles the 12:00-13:00 closed gap.
        start, end = _monday_slot(11, duration_hours=3)
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "opening hours" in resp.json()["detail"]

    async def test_range_entirely_outside_open_hours_is_rejected(
        self, client, auth_headers, test_room, test_member
    ):
        # test_room only opens 08:00-20:00.
        start, end = _monday_slot(21, duration_hours=1)
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "opening hours" in resp.json()["detail"]

    async def test_misaligned_slot_is_rejected(self, client, auth_headers, test_room, test_member):
        """The calendar only ever offers hour-aligned slots (step=60, timeslots=1)."""
        target_date = _next_monday()
        start = datetime.combine(target_date, time(10, 15), tzinfo=UTC).isoformat()
        end = datetime.combine(target_date, time(11, 15), tzinfo=UTC).isoformat()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "opening hours" in resp.json()["detail"]

    async def test_inactive_room_is_rejected(
        self, client, db_session, auth_headers, test_room, test_member
    ):
        test_room.is_active = False
        db_session.add(test_room)
        await db_session.commit()

        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    async def test_inactive_space_is_rejected_even_if_room_is_active(
        self, client, db_session, auth_headers, test_space, test_room, test_member
    ):
        test_space.is_active = False
        db_session.add(test_space)
        await db_session.commit()

        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={"room_id": str(test_room.id), "start_time": start, "end_time": end},
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
