"""P2.2: a booking in a list carries its room as a summary and omits its null
optionals; a single booking still carries the whole room and every field."""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio
from app.models.booking import Booking, BookingStatus, PaymentMethod

SUMMARY_KEYS = {"id", "space_id", "name", "hourly_rate"}


@pytest_asyncio.fixture
async def booking_with_photos(db_session, test_room, test_user, test_member):
    test_room.photos = [
        {
            "id": str(uuid.uuid4()),
            "key": f"rooms/{test_room.id}/{uuid.uuid4().hex}.webp",
            "thumb_key": f"rooms/{test_room.id}/{uuid.uuid4().hex}_thumb.webp",
            "width": 1600,
            "height": 1200,
        }
        for _ in range(3)
    ]
    start = (datetime.now(UTC) + timedelta(days=2)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    booking = Booking(
        org_id=test_room.org_id,
        room_id=test_room.id,
        user_id=test_user.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.manual,
    )
    db_session.add(booking)
    await db_session.commit()
    return booking


class TestListsCarryARoomSummary:
    async def test_my_bookings(self, client, auth_headers, booking_with_photos, test_room):
        resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert resp.status_code == 200
        [row] = resp.json()["bookings"]
        assert set(row["room"]) == SUMMARY_KEYS
        assert row["room"]["id"] == str(test_room.id)
        assert row["room"]["name"] == "Sala A"
        assert row["room"]["hourly_rate"] == "11.00"
        # Null optionals are left out of a row; the values that are set stay.
        for absent in ("notes", "hold_expires_at", "recurrence_rule_id", "user", "updated_at"):
            assert absent not in row
        assert row["created_at"]
        # "No code" is said explicitly: the dashboard and the e2e suite read null.
        assert "access_code" in row and row["access_code"] is None
        assert row["status"] == "confirmed"
        assert row["package_hours_used"] == "0.00"
        assert row["total_amount"] == "11.00"

    async def test_admin_list_and_calendar(
        self, client, admin_headers, booking_with_photos, test_org, test_room
    ):
        resp = await client.get(
            "/api/v1/admin/bookings", headers=admin_headers, params={"org_id": str(test_org.id)}
        )
        assert resp.status_code == 200
        [row] = resp.json()["bookings"]
        assert set(row["room"]) == SUMMARY_KEYS
        assert row["user"]["email"] == "user@test.com"
        assert "admin_note" not in row
        assert row["package_debits"] == []
        day = booking_with_photos.start_time.replace(hour=0)
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={
                "org_id": str(test_org.id),
                "from": day.isoformat(),
                "to": (day + timedelta(days=1)).isoformat(),
            },
        )
        assert resp.status_code == 200
        [row] = resp.json()["bookings"]
        assert set(row["room"]) == SUMMARY_KEYS

    async def test_a_set_optional_is_kept_in_a_row(
        self, client, auth_headers, test_room, test_user, test_member, db_session
    ):
        now = datetime.now(UTC)
        start = (now + timedelta(days=3)).replace(hour=10, minute=0, second=0, microsecond=0)
        db_session.add(
            Booking(
                org_id=test_room.org_id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                duration_hours=Decimal("1.00"),
                total_amount=Decimal("11.00"),
                status=BookingStatus.pending,
                payment_method=PaymentMethod.hourly,
                notes="Trazer o cão",
                hold_expires_at=now + timedelta(minutes=9),
            )
        )
        await db_session.commit()
        resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
        [row] = resp.json()["bookings"]
        assert row["notes"] == "Trazer o cão"
        assert row["hold_expires_at"] is not None
        assert row["status"] == "pending"

    async def test_a_single_booking_keeps_the_whole_room_and_every_field(
        self, client, admin_headers, booking_with_photos, test_org
    ):
        resp = await client.get(
            f"/api/v1/admin/bookings/{booking_with_photos.id}",
            headers=admin_headers,
            params={"org_id": str(test_org.id)},
        )
        assert resp.status_code == 200
        booking = resp.json()["booking"]
        room = booking["room"]
        assert {"photos", "availability_rules", "amenities", "capacity"} <= set(room)
        assert len(room["photos"]) == 3
        assert "notes" in booking and booking["notes"] is None
        assert booking["updated_at"]
