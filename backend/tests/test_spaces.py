import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.space import Space


class TestListSpaces:
    async def test_list_spaces_empty(self, client):
        resp = await client.get("/api/v1/spaces")
        assert resp.status_code == 200
        assert resp.json() == {"spaces": []}

    async def test_list_spaces_returns_active_only(self, client, db_session, test_org, test_space):
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
        today = datetime.now(tz=UTC).date()
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
        start = datetime.combine(target_date, time(10, 0), tzinfo=UTC)
        end = datetime.combine(target_date, time(12, 0), tzinfo=UTC)
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

    async def test_past_slots_are_not_available(self, client, test_room, monkeypatch):
        """B24: a slot whose start is already behind the clock cannot be booked
        (POST /bookings rejects past starts), so it must not be advertised as
        available either. Controlled clock: 12:30 UTC on the requested day."""
        from app import clock

        date_str = self._pick_weekday()
        target_date = datetime.fromisoformat(date_str).date()
        fixed_now = datetime.combine(target_date, time(12, 30), tzinfo=UTC)
        monkeypatch.setattr(clock, "utcnow", lambda: fixed_now)

        resp = await client.get(
            f"/api/v1/rooms/{test_room.id}/availability",
            params={"date": date_str},
        )
        assert resp.status_code == 200, resp.text
        slots = resp.json()["slots"]
        assert len(slots) == 12  # response shape and slot count unchanged
        by_hour = {datetime.fromisoformat(s["start"]).hour: s["available"] for s in slots}
        # 08:00-12:00 have started (12:00 is in progress at 12:30), so not bookable.
        assert all(by_hour[h] is False for h in range(8, 13)), by_hour
        assert all(by_hour[h] is True for h in range(13, 20)), by_hour

    async def test_future_day_is_unaffected_by_the_clock(self, client, test_room, monkeypatch):
        from app import clock

        date_str = self._pick_weekday()
        target_date = datetime.fromisoformat(date_str).date()
        # Clock is the evening of the previous day: every slot still lies ahead.
        fixed_now = datetime.combine(target_date - timedelta(days=1), time(22, 11), tzinfo=UTC)
        monkeypatch.setattr(clock, "utcnow", lambda: fixed_now)

        resp = await client.get(
            f"/api/v1/rooms/{test_room.id}/availability",
            params={"date": date_str},
        )
        assert all(s["available"] for s in resp.json()["slots"])

    async def test_room_availability_404_for_unknown_room(self, client):
        random_id = uuid.uuid4()
        date_str = self._pick_weekday()
        resp = await client.get(
            f"/api/v1/rooms/{random_id}/availability",
            params={"date": date_str},
        )
        assert resp.status_code == 404
