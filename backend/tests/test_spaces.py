import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest_asyncio

from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.space import Space


class TestListSpaces:
    async def test_list_spaces_empty(self, client):
        resp = await client.get("/api/v1/spaces")
        assert resp.status_code == 200
        assert resp.json() == {"spaces": []}

    async def test_list_spaces_returns_active_only(
        self, client, db_session, test_org, test_space
    ):
        # Add a second, inactive space
        inactive = Space(
            org_id=test_org.id,
            name="Hidden",
            description=None,
            address=None,
            city=None,
            images=[],
            amenities=[],
            is_active=False,
        )
        db_session.add(inactive)
        await db_session.commit()

        resp = await client.get("/api/v1/spaces")
        assert resp.status_code == 200
        body = resp.json()
        names = [s["name"] for s in body["spaces"]]
        assert "Test Space" in names
        assert "Hidden" not in names


class TestGetSpace:
    async def test_get_space_with_rooms(self, client, test_space, test_room):
        resp = await client.get(f"/api/v1/spaces/{test_space.id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["space"]["id"] == str(test_space.id)
        assert body["space"]["name"] == "Test Space"
        assert len(body["rooms"]) == 1
        assert body["rooms"][0]["id"] == str(test_room.id)
        assert body["rooms"][0]["name"] == "Sala A"

    async def test_get_space_404(self, client):
        random_id = uuid.uuid4()
        resp = await client.get(f"/api/v1/spaces/{random_id}")
        assert resp.status_code == 404


class TestRoomAvailability:
    def _pick_weekday(self) -> str:
        """Return an upcoming Monday (day_of_week=0) date string."""
        today = datetime.now(tz=timezone.utc).date()
        # Aim 7-13 days out for a Monday so cancellation-window edge cases
        # in booking creation don't trip availability lookups.
        days_ahead = (0 - today.weekday()) % 7 or 7
        target = today + timedelta(days=days_ahead + 7)
        return target.isoformat()

    async def test_room_availability_returns_slots(self, client, test_room):
        date_str = self._pick_weekday()
        resp = await client.get(
            f"/api/v1/rooms/{test_room.id}/availability",
            params={"date": date_str},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        slots = body["slots"]
        # 08:00 - 20:00 inclusive open, exclusive close → 12 one-hour slots
        assert len(slots) == 12
        assert all(s["available"] for s in slots)

    async def test_room_availability_skips_booked_slots(
        self, client, db_session, test_org, test_user, test_room
    ):
        date_str = self._pick_weekday()
        target_date = datetime.fromisoformat(date_str).date()
        # Insert a confirmed booking 10:00-12:00 UTC on that date.
        start = datetime.combine(target_date, time(10, 0), tzinfo=timezone.utc)
        end = datetime.combine(target_date, time(12, 0), tzinfo=timezone.utc)
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

        resp = await client.get(
            f"/api/v1/rooms/{test_room.id}/availability",
            params={"date": date_str},
        )
        assert resp.status_code == 200, resp.text
        slots = resp.json()["slots"]
        unavailable = [s for s in slots if not s["available"]]
        # The 10:00 and 11:00 one-hour slots overlap the booking.
        assert len(unavailable) == 2

    async def test_room_availability_404_for_unknown_room(self, client):
        random_id = uuid.uuid4()
        date_str = self._pick_weekday()
        resp = await client.get(
            f"/api/v1/rooms/{random_id}/availability",
            params={"date": date_str},
        )
        assert resp.status_code == 404
