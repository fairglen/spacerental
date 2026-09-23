"""H01 — customers book at most `BOOKING_MAX_ADVANCE_DAYS` days ahead.

The window is a customer's rule, like the 24h cancellation rule (C07): the
operator has no horizon either way. The API is authoritative — the calendar
only styles what `/rooms/{id}/availability` reports — so the boundary is
pinned here, on the clock, to the exact instant.
"""

from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
from app import clock
from app.config import settings
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.room_block import RoomBlock

API = "/api/v1"

pytestmark = pytest.mark.usefixtures("test_member")


def _monday(hour: int = 10) -> datetime:
    """A Monday 10:00 UTC at least a week out: inside the room's Mon-Sat 08-20 rules."""
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days_ahead), time(hour, 0), tzinfo=UTC)


def _pin(monkeypatch, at: datetime) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: at)


def _window(now: datetime) -> datetime:
    return now + timedelta(days=settings.BOOKING_MAX_ADVANCE_DAYS)


async def _book(client, headers, room, start: datetime, hours: int = 1, **extra):
    return await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": "hourly",
            **extra,
        },
        headers=headers,
    )


class TestCustomerBookingWindow:
    async def test_the_last_instant_of_the_window_is_bookable(
        self, client, auth_headers, test_room, monkeypatch
    ):
        now = _monday()
        _pin(monkeypatch, now)
        # 30 days after a Monday 10:00 is a Wednesday 10:00: still inside open hours.
        resp = await _book(client, auth_headers, test_room, _window(now))
        assert resp.status_code == 201, resp.text

    async def test_one_hour_past_the_window_is_refused_with_its_own_detail(
        self, client, auth_headers, test_room, monkeypatch
    ):
        now = _monday()
        _pin(monkeypatch, now)
        resp = await _book(client, auth_headers, test_room, _window(now) + timedelta(hours=1))
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == "start_time is beyond the booking window"

    async def test_the_window_is_checked_before_opening_hours(
        self, client, auth_headers, test_room, monkeypatch
    ):
        """A far-off Sunday (closed) is refused for the window, not the hours:
        the customer is told the rule that actually applies to them."""
        now = _monday()
        _pin(monkeypatch, now)
        sunday_far_out = _window(now) + timedelta(days=30)
        while sunday_far_out.weekday() != 6:
            sunday_far_out += timedelta(days=1)
        resp = await _book(client, auth_headers, test_room, sunday_far_out)
        assert resp.status_code == 400
        assert "booking window" in resp.json()["detail"]

    async def test_the_setting_is_what_moves_the_boundary(
        self, client, auth_headers, test_room, monkeypatch
    ):
        now = _monday()
        _pin(monkeypatch, now)
        monkeypatch.setattr(settings, "BOOKING_MAX_ADVANCE_DAYS", 7)
        refused = await _book(client, auth_headers, test_room, now + timedelta(days=7, hours=1))
        assert refused.status_code == 400
        allowed = await _book(client, auth_headers, test_room, now + timedelta(days=7))
        assert allowed.status_code == 201, allowed.text


class TestOperatorHasNoWindow:
    async def test_admin_can_create_a_booking_beyond_the_window(
        self, client, admin_headers, test_org, test_user, test_room, monkeypatch
    ):
        now = _monday()
        _pin(monkeypatch, now)
        start = _window(now) + timedelta(days=1)
        resp = await client.post(
            f"{API}/admin/bookings",
            params={"org_id": str(test_org.id)},
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text

    async def test_admin_can_move_a_booking_beyond_the_window(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch
    ):
        now = _monday()
        _pin(monkeypatch, now)
        created = await _book(client, auth_headers, test_room, now + timedelta(days=1))
        assert created.status_code == 201, created.text
        booking = created.json()["booking"]
        start = _window(now) + timedelta(days=1)
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params={"org_id": str(test_org.id)},
            json={
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["start_time"].startswith(start.strftime("%Y-%m-%dT%H"))


class TestAvailabilityReasons:
    async def _slots(self, client, room, day) -> dict[int, dict]:
        resp = await client.get(
            f"{API}/rooms/{room.id}/availability", params={"date": day.isoformat()}
        )
        assert resp.status_code == 200, resp.text
        return {datetime.fromisoformat(s["start"]).hour: s for s in resp.json()["slots"]}

    async def test_slots_after_the_window_instant_say_why(self, client, test_room, monkeypatch):
        now = _monday()
        _pin(monkeypatch, now)
        last_day = _window(now).date()
        by_hour = await self._slots(client, test_room, last_day)
        assert len(by_hour) == 12
        # 08:00-10:00 lie inside the window (10:00 is its last instant).
        for hour in range(8, 11):
            assert by_hour[hour]["available"] is True, by_hour[hour]
            assert by_hour[hour]["reason"] is None, by_hour[hour]
        for hour in range(11, 20):
            assert by_hour[hour]["available"] is False, by_hour[hour]
            assert by_hour[hour]["reason"] == "beyond_window", by_hour[hour]

    async def test_past_booked_and_blocked_each_carry_their_reason(
        self, client, db_session, test_org, test_user, test_room, monkeypatch
    ):
        day = _monday(hour=12)
        _pin(monkeypatch, day.replace(minute=30))
        db_session.add(
            Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=day.replace(hour=14),
                end_time=day.replace(hour=16),
                duration_hours=Decimal("2.00"),
                total_amount=Decimal("22.00"),
                status=BookingStatus.confirmed,
                payment_method=PaymentMethod.hourly,
            )
        )
        db_session.add(
            RoomBlock(
                org_id=test_org.id,
                room_id=test_room.id,
                start_time=day.replace(hour=17),
                end_time=day.replace(hour=18),
                reason="Limpeza",
            )
        )
        await db_session.commit()

        by_hour = await self._slots(client, test_room, day.date())
        assert {h: s["reason"] for h, s in by_hour.items()} == {
            **dict.fromkeys(range(8, 13), "past"),
            13: None,
            14: "booked",
            15: "booked",
            16: None,
            17: "blocked",
            18: None,
            19: None,
        }
        assert all((s["reason"] is None) == s["available"] for s in by_hour.values())

    async def test_a_date_beyond_the_window_is_refused(self, client, test_room, monkeypatch):
        now = _monday()
        _pin(monkeypatch, now)
        beyond = _window(now).date() + timedelta(days=1)
        resp = await client.get(
            f"{API}/rooms/{test_room.id}/availability", params={"date": beyond.isoformat()}
        )
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == "date is beyond the booking window"

    async def test_the_windows_last_day_is_still_served(self, client, test_room, monkeypatch):
        now = _monday()
        _pin(monkeypatch, now)
        resp = await client.get(
            f"{API}/rooms/{test_room.id}/availability",
            params={"date": _window(now).date().isoformat()},
        )
        assert resp.status_code == 200
