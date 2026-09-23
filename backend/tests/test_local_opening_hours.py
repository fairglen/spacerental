"""R01 (opening-hours slice) — rules are the space's wall clock, not UTC.

A rule "08:00-22:00" on a space in Europe/Lisbon means 08:00-22:00 on the
door, summer and winter: 08:00-22:00 UTC in winter, 07:00-21:00 UTC in
summer. Stored instants (bookings, slots) stay UTC. The fixture space in
`conftest.py` is zoned UTC on purpose, so the rest of the suite keeps its
UTC-pinned expectations; the space here is Lisbon.
"""

from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from app import clock
from app.models.space import AvailabilityRule, Room, Space
from sqlalchemy import select

API = "/api/v1"
LISBON = ZoneInfo("Europe/Lisbon")

# Lisbon springs forward on 2026-03-29 (01:00 → 02:00) and falls back on
# 2026-10-25 (02:00 → 01:00). The tests pin the clock, so the calendar dates
# below are safe to use as "days ahead".
WINTER_DAY = date(2026, 3, 27)  # Friday, UTC+0
SUMMER_DAY = date(2026, 3, 31)  # Tuesday, UTC+1
SPRING_FORWARD = date(2026, 3, 29)  # Sunday
FALL_BACK = date(2026, 10, 25)  # Sunday

pytestmark = pytest.mark.usefixtures("test_member")


def _pin(monkeypatch, at: datetime) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: at)


@pytest_asyncio.fixture
async def lisbon_space(db_session, test_org) -> Space:
    s = Space(
        org_id=test_org.id,
        name="Espaço Lisboa",
        address="R. 12 de Julho de 1997 5",
        city="Queluz",
        timezone="Europe/Lisbon",
        images=[],
        amenities=[],
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


@pytest_asyncio.fixture
async def lisbon_room(db_session, test_org, lisbon_space) -> Room:
    """Every day 08:00-22:00 on the Lisbon clock, like the seed."""
    r = Room(
        space_id=lisbon_space.id,
        org_id=test_org.id,
        name="Sala Lisboa",
        capacity=4,
        hourly_rate=Decimal("11.00"),
        color="#A8D5BA",
        images=[],
        amenities=[],
    )
    db_session.add(r)
    await db_session.flush()
    for day in range(7):
        db_session.add(
            AvailabilityRule(
                room_id=r.id, day_of_week=day, open_time=time(8, 0), close_time=time(22, 0)
            )
        )
    await db_session.commit()
    await db_session.refresh(r)
    return r


async def _slots(client, room, day: date) -> list[datetime]:
    resp = await client.get(f"{API}/rooms/{room.id}/availability", params={"date": day.isoformat()})
    assert resp.status_code == 200, resp.text
    return [datetime.fromisoformat(s["start"]) for s in resp.json()["slots"]]


async def _book(client, headers, room, start: datetime, hours: int = 1):
    return await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": "hourly",
        },
        headers=headers,
    )


class TestAvailabilityOnTheLisbonClock:
    async def test_winter_and_summer_days_both_read_eight_to_twenty_two_on_the_door(
        self, client, lisbon_room, monkeypatch
    ):
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        winter = await _slots(client, lisbon_room, WINTER_DAY)
        summer = await _slots(client, lisbon_room, SUMMER_DAY)
        assert len(winter) == len(summer) == 14
        # The instants are UTC: 08:00 UTC in winter, 07:00 UTC in summer…
        assert winter[0] == datetime(2026, 3, 27, 8, tzinfo=UTC)
        assert summer[0] == datetime(2026, 3, 31, 7, tzinfo=UTC)
        # …and both are 08:00 on the Lisbon clock.
        assert winter[0].astimezone(LISBON).hour == summer[0].astimezone(LISBON).hour == 8
        assert winter[-1].astimezone(LISBON).hour == summer[-1].astimezone(LISBON).hour == 21

    async def test_the_date_parameter_is_the_spaces_local_date(
        self, client, lisbon_room, monkeypatch
    ):
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        # Every slot of a summer day belongs to that Lisbon date, even the one
        # that starts at 23:00 UTC the day before would (there is none: the
        # window closes at 22:00 local), and none spills into the next date.
        summer = await _slots(client, lisbon_room, SUMMER_DAY)
        assert {s.astimezone(LISBON).date() for s in summer} == {SUMMER_DAY}

    async def test_the_spring_forward_day_has_thirteen_hours_and_no_slot_in_the_gap(
        self, client, db_session, lisbon_room, monkeypatch
    ):
        """A rule that spans the gap (00:00-05:00 local on the last Sunday of
        March) loses the hour that does not happen: nothing can start at 01:00."""
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        db_session.add(
            AvailabilityRule(
                room_id=lisbon_room.id,
                day_of_week=6,
                open_time=time(0, 0),
                close_time=time(5, 0),
            )
        )
        await db_session.commit()
        slots = await _slots(client, lisbon_room, SPRING_FORWARD)
        early = [s.astimezone(LISBON) for s in slots if s.astimezone(LISBON).hour < 8]
        local = sorted(s.strftime("%H:%M") for s in early)
        assert local == ["00:00", "02:00", "03:00", "04:00"]
        # The day's main window is still 14 slots: 08:00-22:00 local.
        assert len([s for s in slots if s.astimezone(LISBON).hour >= 8]) == 14

    async def test_the_fall_back_day_takes_the_first_occurrence_of_the_repeated_hour(
        self, client, db_session, lisbon_room, monkeypatch
    ):
        """00:00-05:00 local on the last Sunday of October: 01:00 happens twice
        on the door; the slots are one per wall-clock hour, first occurrence."""
        _pin(monkeypatch, datetime(2026, 10, 20, 12, tzinfo=UTC))
        db_session.add(
            AvailabilityRule(
                room_id=lisbon_room.id,
                day_of_week=6,
                open_time=time(0, 0),
                close_time=time(5, 0),
            )
        )
        await db_session.commit()
        slots = await _slots(client, lisbon_room, FALL_BACK)
        early = sorted(s for s in slots if s.astimezone(LISBON).hour < 8)
        assert [s.astimezone(LISBON).strftime("%H:%M") for s in early] == [
            "00:00", "01:00", "02:00", "03:00", "04:00",
        ]  # fmt: skip
        # 01:00 local is the first occurrence: 00:00 UTC (still UTC+1), not 01:00 UTC.
        assert early[1] == datetime(2026, 10, 25, 0, tzinfo=UTC)
        assert early[2] == datetime(2026, 10, 25, 2, tzinfo=UTC)

    async def test_the_windows_last_day_is_the_local_one(self, client, lisbon_room, monkeypatch):
        """H01's horizon is an instant; the last day it is served on is the
        space's date of that instant, not the UTC date (they differ in summer
        between 23:00 and 24:00 UTC)."""
        _pin(monkeypatch, datetime(2026, 7, 1, 23, 30, tzinfo=UTC))
        # The window ends 2026-07-31 23:30 UTC = 2026-08-01 00:30 in Lisbon.
        resp = await client.get(
            f"{API}/rooms/{lisbon_room.id}/availability", params={"date": "2026-08-01"}
        )
        assert resp.status_code == 200, resp.text
        assert {s["reason"] for s in resp.json()["slots"]} == {"beyond_window"}
        resp = await client.get(
            f"{API}/rooms/{lisbon_room.id}/availability", params={"date": "2026-08-02"}
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "date is beyond the booking window"

    async def test_a_utc_space_keeps_todays_behaviour(self, client, test_room, monkeypatch):
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        # conftest's room: Mon-Sat 08-20 on a UTC space (2026-03-31 is a Tuesday).
        slots = await _slots(client, test_room, SUMMER_DAY)
        assert slots[0] == datetime(2026, 3, 31, 8, tzinfo=UTC)
        assert len(slots) == 12


class TestBookingOnTheLisbonClock:
    async def test_eight_in_the_morning_lisbon_is_open_in_summer_and_seven_utc_is_not(
        self, client, auth_headers, lisbon_room, monkeypatch
    ):
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        at_eight_lisbon = datetime.combine(SUMMER_DAY, time(8), tzinfo=LISBON)
        ok = await _book(client, auth_headers, lisbon_room, at_eight_lisbon)
        assert ok.status_code == 201, ok.text
        assert datetime.fromisoformat(ok.json()["booking"]["start_time"]) == datetime(
            2026, 3, 31, 7, tzinfo=UTC
        )
        # 06:00 UTC = 07:00 Lisbon: the door is still shut.
        early = await _book(client, auth_headers, lisbon_room, datetime(2026, 3, 31, 6, tzinfo=UTC))
        assert early.status_code == 400
        assert "opening hours" in early.json()["detail"]
        # 21:00-22:00 Lisbon = 20:00-21:00 UTC: the last hour of the day is open.
        last = await _book(client, auth_headers, lisbon_room, datetime(2026, 3, 31, 20, tzinfo=UTC))
        assert last.status_code == 201, last.text
        # 22:00 Lisbon = 21:00 UTC: closed, whatever the UTC number says.
        shut = await _book(client, auth_headers, lisbon_room, datetime(2026, 3, 31, 21, tzinfo=UTC))
        assert shut.status_code == 400

    async def test_a_block_across_the_spring_forward_gap_is_two_real_hours(
        self, client, auth_headers, db_session, lisbon_room, monkeypatch
    ):
        _pin(monkeypatch, datetime(2026, 3, 20, 12, tzinfo=UTC))
        db_session.add(
            AvailabilityRule(
                room_id=lisbon_room.id, day_of_week=6, open_time=time(0, 0), close_time=time(5, 0)
            )
        )
        await db_session.commit()
        # 00:00-03:00 local on the gap day is only two real hours (01:00 never
        # happens): as UTC instants that is 00:00-02:00, and the API sees the
        # 00:00 and 02:00-local slots as adjacent instants — so it IS bookable,
        # for two hours of money. Ask for exactly that.
        start = datetime.combine(SPRING_FORWARD, time(0), tzinfo=LISBON)
        end = datetime.combine(SPRING_FORWARD, time(3), tzinfo=LISBON)  # 02:00 UTC
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(lisbon_room.id),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["booking"]["duration_hours"]) == Decimal(2)


class TestTheTimezoneField:
    async def test_it_is_public_defaults_to_lisbon_and_is_validated_on_the_admin_endpoints(
        self, client, admin_headers, test_org, lisbon_space, db_session
    ):
        detail = await client.get(f"{API}/spaces/{lisbon_space.id}")
        assert detail.json()["space"]["timezone"] == "Europe/Lisbon"

        created = await client.post(
            f"{API}/admin/spaces",
            params={"org_id": str(test_org.id)},
            json={"name": "Novo", "images": [], "amenities": []},
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text
        assert created.json()["space"]["timezone"] == "Europe/Lisbon"

        bad = await client.put(
            f"{API}/admin/spaces/{lisbon_space.id}",
            params={"org_id": str(test_org.id)},
            json={"timezone": "Mars/Olympus"},
            headers=admin_headers,
        )
        assert bad.status_code == 422, bad.text

        ok = await client.put(
            f"{API}/admin/spaces/{lisbon_space.id}",
            params={"org_id": str(test_org.id)},
            json={"timezone": "Atlantic/Azores"},
            headers=admin_headers,
        )
        assert ok.status_code == 200, ok.text
        assert ok.json()["space"]["timezone"] == "Atlantic/Azores"
        stored = (
            await db_session.execute(
                select(Space)
                .where(Space.id == lisbon_space.id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert stored.timezone == "Atlantic/Azores"

    async def test_the_seed_places_the_demo_space_in_lisbon(self, db_session):
        from app.seed import seed_demo_data

        await seed_demo_data(db_session)
        await db_session.commit()
        space = (
            await db_session.execute(select(Space).where(Space.name == "Espaço Calmo"))
        ).scalar_one()
        assert space.timezone == "Europe/Lisbon"
        # A database seeded before the column existed carries the default too.
        space.timezone = "UTC"
        await db_session.commit()
        await seed_demo_data(db_session)
        await db_session.commit()
        await db_session.refresh(space)
        assert space.timezone == "Europe/Lisbon"
