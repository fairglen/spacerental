"""GET /admin/calendar (P1.4): the operator calendar's one read."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import Organization, OrgPlan
from app.models.room_block import RoomBlock
from app.models.space import Room, Space


def _at(day: datetime, hour: int) -> datetime:
    return day.replace(hour=hour, minute=0, second=0, microsecond=0)


@pytest_asyncio.fixture
async def calendar_data(db_session, test_org, test_space, test_room, test_user, admin_user):
    """Two rooms with a booking each (one cancelled), one block, and a third
    room in another organisation with its own booking and block."""
    day = datetime.now(UTC) + timedelta(days=2)
    second = Room(
        space_id=test_space.id,
        org_id=test_org.id,
        name="Sala B",
        hourly_rate=Decimal("11.00"),
        color="#A8D5BA",
        images=[],
        amenities=[],
    )
    other_org = Organization(name="Other", slug="other", plan=OrgPlan.starter, settings={})
    db_session.add_all([second, other_org])
    await db_session.flush()
    other_space = Space(org_id=other_org.id, name="Elsewhere", images=[], amenities=[])
    db_session.add(other_space)
    await db_session.flush()
    other_room = Room(
        space_id=other_space.id,
        org_id=other_org.id,
        name="Sala X",
        hourly_rate=Decimal("9.00"),
        color="#A8D5BA",
        images=[],
        amenities=[],
    )
    db_session.add(other_room)
    await db_session.flush()

    def booking(room: Room, hour: int, status: BookingStatus = BookingStatus.confirmed) -> Booking:
        return Booking(
            org_id=room.org_id,
            room_id=room.id,
            user_id=test_user.id,
            start_time=_at(day, hour),
            end_time=_at(day, hour + 1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=status,
            payment_method=PaymentMethod.manual,
        )

    db_session.add_all(
        [
            booking(test_room, 9),
            booking(second, 11, BookingStatus.cancelled),
            booking(other_room, 9),
            RoomBlock(
                org_id=test_org.id,
                room_id=second.id,
                start_time=_at(day, 14),
                end_time=_at(day, 16),
                reason="Limpeza",
                created_by=admin_user.id,
            ),
            RoomBlock(
                org_id=other_org.id,
                room_id=other_room.id,
                start_time=_at(day, 14),
                end_time=_at(day, 16),
                reason="Elsewhere",
                created_by=None,
            ),
        ]
    )
    await db_session.commit()
    return {"day": day, "rooms": [test_room, second], "other_org": other_org}


def _range(day: datetime) -> dict[str, str]:
    return {"from": _at(day, 0).isoformat(), "to": _at(day + timedelta(days=1), 0).isoformat()}


class TestAdminCalendar:
    async def test_one_request_answers_the_orgs_bookings_and_blocks_in_time_order(
        self, client, admin_headers, test_org, calendar_data
    ):
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={"org_id": str(test_org.id), **_range(calendar_data["day"])},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"bookings", "blocks"}
        # Every status, both rooms, nothing from the other organisation.
        assert [(b["room_id"], b["status"]) for b in body["bookings"]] == [
            (str(calendar_data["rooms"][0].id), "confirmed"),
            (str(calendar_data["rooms"][1].id), "cancelled"),
        ]
        assert all(b["org_id"] == str(test_org.id) for b in body["bookings"])
        assert body["bookings"][0]["room"]["name"] == "Sala A"
        assert body["bookings"][0]["user"]["email"] == "user@test.com"
        assert [(k["room_id"], k["reason"]) for k in body["blocks"]] == [
            (str(calendar_data["rooms"][1].id), "Limpeza")
        ]

    async def test_a_space_filter_keeps_only_its_rooms(
        self, client, admin_headers, test_org, test_space, calendar_data
    ):
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={
                "org_id": str(test_org.id),
                "space_id": str(test_space.id),
                **_range(calendar_data["day"]),
            },
        )
        assert resp.status_code == 200
        assert len(resp.json()["bookings"]) == 2
        # A space of another organisation yields nothing, not someone else's rows.
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={
                "org_id": str(test_org.id),
                "space_id": "00000000-0000-0000-0000-000000000000",
                **_range(calendar_data["day"]),
            },
        )
        assert resp.json() == {"bookings": [], "blocks": []}

    async def test_outside_the_range_nothing_is_returned(
        self, client, admin_headers, test_org, calendar_data
    ):
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={"org_id": str(test_org.id), **_range(calendar_data["day"] + timedelta(days=5))},
        )
        assert resp.status_code == 200
        assert resp.json() == {"bookings": [], "blocks": []}

    async def test_a_member_is_refused(
        self, client, auth_headers, test_member, test_org, calendar_data
    ):
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=auth_headers,
            params={"org_id": str(test_org.id), **_range(calendar_data["day"])},
        )
        assert resp.status_code == 403

    async def test_the_range_is_bounded(self, client, admin_headers, test_org, calendar_data):
        day = calendar_data["day"]
        too_long = {
            "from": _at(day, 0).isoformat(),
            "to": _at(day + timedelta(days=15), 0).isoformat(),
        }
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={"org_id": str(test_org.id), **too_long},
        )
        assert resp.status_code == 400
        backwards = {"from": _at(day, 10).isoformat(), "to": _at(day, 9).isoformat()}
        resp = await client.get(
            "/api/v1/admin/calendar",
            headers=admin_headers,
            params={"org_id": str(test_org.id), **backwards},
        )
        assert resp.status_code == 400
