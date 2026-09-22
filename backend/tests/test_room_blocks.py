"""A02 — blocked time: an operator takes a room out of service for a while.

A block is unavailable exactly like a booking is: it hides the hours from the
public calendar and every booking path refuses to overlap it. And it never
silently overrides a booking that already holds the slot.
"""

from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.room_block import RoomBlock
from app.models.space import Room, Space
from app.models.user import User
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

API = "/api/v1"


def _monday(days_out: int = 14, hour: int = 10) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    day = today + timedelta(days=days_ahead + days_out)
    return datetime.combine(day, time(hour, 0), tzinfo=UTC)


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


def _blocks_url(room) -> str:
    return f"{API}/admin/rooms/{room.id}/blocks"


async def _block(client, headers, org, room, start: datetime, hours=2, reason="Manutenção"):
    return await client.post(
        _blocks_url(room),
        params=_org(org),
        json={
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "reason": reason,
        },
        headers=headers,
    )


async def _customer_book(client, headers, room, start: datetime, hours=1):
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


@pytest_asyncio.fixture
async def other_org(db_session) -> tuple[Organization, Room, dict]:
    org = Organization(name="Other", slug="other", plan=OrgPlan.starter, settings={})
    op = User(email="other-op@test.com", name="Op", password_hash=hash_password("x" * 12))
    db_session.add_all([org, op])
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=op.id, role=MemberRole.owner))
    space = Space(org_id=org.id, name="Other space", images=[], amenities=[])
    db_session.add(space)
    await db_session.flush()
    room = Room(
        space_id=space.id,
        org_id=org.id,
        name="Other room",
        capacity=1,
        hourly_rate=Decimal("9.00"),
        color="#fff",
        images=[],
        amenities=[],
    )
    db_session.add(room)
    await db_session.commit()
    headers = {
        "Authorization": "Bearer "
        + create_access_token({"sub": str(op.id), "email": op.email, "name": op.name})
    }
    return org, room, headers


class TestCrud:
    async def test_create_list_update_delete(
        self, client, admin_headers, admin_user, test_org, test_room
    ):
        created = await _block(client, admin_headers, test_org, test_room, _monday())
        assert created.status_code == 201, created.text
        block = created.json()["block"]
        assert set(block) == {
            "id",
            "org_id",
            "room_id",
            "start_time",
            "end_time",
            "reason",
            "created_by",
            "created_at",
        }
        assert block["reason"] == "Manutenção"
        assert block["created_by"] == str(admin_user.id)

        listed = await client.get(
            _blocks_url(test_room), params=_org(test_org), headers=admin_headers
        )
        assert listed.status_code == 200, listed.text
        assert [b["id"] for b in listed.json()["blocks"]] == [block["id"]]

        updated = await client.put(
            f"{_blocks_url(test_room)}/{block['id']}",
            params=_org(test_org),
            json={"reason": "Pintura", "end_time": (_monday() + timedelta(hours=4)).isoformat()},
            headers=admin_headers,
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["block"]["reason"] == "Pintura"
        assert updated.json()["block"]["end_time"].startswith(
            _monday(hour=14).strftime("%Y-%m-%dT14")
        )

        gone = await client.delete(
            f"{_blocks_url(test_room)}/{block['id']}", params=_org(test_org), headers=admin_headers
        )
        assert gone.status_code == 204, gone.text
        assert (
            await client.get(_blocks_url(test_room), params=_org(test_org), headers=admin_headers)
        ).json()["blocks"] == []

    async def test_listing_can_be_windowed(self, client, admin_headers, test_org, test_room):
        await _block(client, admin_headers, test_org, test_room, _monday(0))
        await _block(client, admin_headers, test_org, test_room, _monday(21))
        window = await client.get(
            _blocks_url(test_room),
            params={
                **_org(test_org),
                "from": _monday(14).isoformat(),
                "to": _monday(28).isoformat(),
            },
            headers=admin_headers,
        )
        assert len(window.json()["blocks"]) == 1

    @pytest.mark.parametrize(
        "body",
        [
            {
                "start_time": "2030-01-07T12:00:00Z",
                "end_time": "2030-01-07T10:00:00Z",
                "reason": "x",
            },
            {
                "start_time": "2030-01-07T10:00:00Z",
                "end_time": "2030-01-07T12:00:00Z",
                "reason": "",
            },
            {"start_time": "2030-01-07T10:00:00", "end_time": "2030-01-07T12:00:00", "reason": "x"},
            {
                "start_time": "2030-01-07T10:00:00Z",
                "end_time": "2030-02-09T12:00:00Z",
                "reason": "x",
            },
        ],
    )
    async def test_bounds(self, client, admin_headers, test_org, test_room, body):
        resp = await client.post(
            _blocks_url(test_room), params=_org(test_org), json=body, headers=admin_headers
        )
        assert resp.status_code in (400, 422), resp.text

    async def test_a_block_may_start_in_the_past_but_not_end_there(
        self, client, admin_headers, test_org, test_room
    ):
        # "Out of service since this morning" is a real thing to record.
        start = datetime.now(tz=UTC).replace(minute=0, second=0, microsecond=0) - timedelta(hours=2)
        ok = await _block(client, admin_headers, test_org, test_room, start, hours=6)
        assert ok.status_code == 201, ok.text
        over = await _block(client, admin_headers, test_org, test_room, start - timedelta(days=2))
        assert over.status_code == 400, over.text


class TestTenancy:
    async def test_another_orgs_admin_cannot_block_read_or_change_our_room(
        self, client, admin_headers, test_org, test_room, other_org
    ):
        foreign_org, _, headers = other_org
        mine = (await _block(client, admin_headers, test_org, test_room, _monday())).json()["block"]
        for org, expected in ((test_org, 403), (foreign_org, 404)):
            params = {"org_id": str(org.id)}
            assert (
                await client.post(
                    _blocks_url(test_room),
                    params=params,
                    headers=headers,
                    json={
                        "start_time": _monday(21).isoformat(),
                        "end_time": (_monday(21) + timedelta(hours=1)).isoformat(),
                        "reason": "x",
                    },
                )
            ).status_code == expected
            assert (
                await client.get(_blocks_url(test_room), params=params, headers=headers)
            ).status_code == expected
            assert (
                await client.delete(
                    f"{_blocks_url(test_room)}/{mine['id']}", params=params, headers=headers
                )
            ).status_code == expected

    async def test_a_member_cannot_block(
        self, client, auth_headers, test_member, test_org, test_room
    ):
        resp = await _block(client, auth_headers, test_org, test_room, _monday())
        assert resp.status_code == 403


class TestBlocksAreUnavailable:
    async def test_the_public_calendar_hides_the_hours(
        self, client, admin_headers, test_org, test_room
    ):
        await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=2)
        resp = await client.get(
            f"{API}/rooms/{test_room.id}/availability",
            params={"date": _monday().date().isoformat()},
        )
        slots = {
            datetime.fromisoformat(s["start"]).hour: s["available"] for s in resp.json()["slots"]
        }
        assert (slots[9], slots[10], slots[11], slots[12]) == (True, False, False, True)

    async def test_a_customer_cannot_book_into_a_block(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=2)
        for start, hours in ((_monday(hour=11), 1), (_monday(hour=9), 2), (_monday(hour=9), 4)):
            resp = await _customer_book(client, auth_headers, test_room, start, hours)
            assert resp.status_code == 409, (start, resp.text)
        edge = await _customer_book(client, auth_headers, test_room, _monday(hour=12), 1)
        assert edge.status_code == 201, edge.text

    async def test_an_operator_cannot_move_or_create_a_booking_into_a_block(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member, test_user
    ):
        await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=2)
        booking = (await _customer_book(client, auth_headers, test_room, _monday(hour=14))).json()[
            "booking"
        ]
        moved = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={
                "start_time": _monday(hour=10).isoformat(),
                "end_time": _monday(hour=11).isoformat(),
            },
            headers=admin_headers,
        )
        assert moved.status_code == 409, moved.text
        created = await client.post(
            f"{API}/admin/bookings",
            params=_org(test_org),
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": _monday(hour=11).isoformat(),
                "end_time": _monday(hour=12).isoformat(),
            },
            headers=admin_headers,
        )
        assert created.status_code == 409, created.text

    async def test_a_reinstated_booking_cannot_land_on_a_block(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        booking = (await _customer_book(client, auth_headers, test_room, _monday(hour=10))).json()[
            "booking"
        ]
        cancelled = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert cancelled.status_code == 204
        await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=1)
        back = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert back.status_code == 409, back.text


class TestBookingsBlockBlocks:
    async def test_a_block_over_a_held_booking_is_refused_and_lists_it(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        booking = (await _customer_book(client, auth_headers, test_room, _monday(hour=11))).json()[
            "booking"
        ]
        resp = await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=3)
        assert resp.status_code == 409, resp.text
        body = resp.json()["detail"]
        assert [c["id"] for c in body["conflicts"]] == [booking["id"]]
        assert body["conflicts"][0]["start_time"].startswith(
            _monday(hour=11).strftime("%Y-%m-%dT11")
        )

    async def test_a_cancelled_or_expired_booking_does_not_stand_in_the_way(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member, monkeypatch
    ):
        from app import clock

        booking = (await _customer_book(client, auth_headers, test_room, _monday(hour=11))).json()[
            "booking"
        ]
        await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        lapsed = (await _customer_book(client, auth_headers, test_room, _monday(hour=13))).json()[
            "booking"
        ]
        monkeypatch.setattr(clock, "utcnow", lambda: datetime.now(tz=UTC) + timedelta(minutes=16))
        resp = await _block(client, admin_headers, test_org, test_room, _monday(hour=10), hours=5)
        assert resp.status_code == 201, resp.text
        assert lapsed["id"] != booking["id"]

    async def test_moving_or_extending_a_block_is_checked_too(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        block = (
            await _block(client, admin_headers, test_org, test_room, _monday(hour=8), hours=1)
        ).json()["block"]
        await _customer_book(client, auth_headers, test_room, _monday(hour=10))
        resp = await client.put(
            f"{_blocks_url(test_room)}/{block['id']}",
            params=_org(test_org),
            json={"end_time": _monday(hour=11).isoformat()},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text


@pytest_asyncio.fixture
async def block_overlap_constraint(engine, db_session):
    """Install the production `room_blocks_no_overlap` EXCLUDE constraint.

    The test schema comes from `Base.metadata.create_all`, which cannot carry it
    (migration 0009 owns it, like `bookings_no_overlap`); a test that means to
    prove the DATABASE arbitrates two overlapping blocks has to add it back.
    """
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
        await conn.execute(
            text(
                """
                ALTER TABLE room_blocks ADD CONSTRAINT room_blocks_no_overlap EXCLUDE USING gist (
                    room_id WITH =,
                    tstzrange(start_time, end_time, '[)') WITH &&
                )
                """
            )
        )
    yield


class TestSchema:
    async def test_two_overlapping_blocks_cannot_coexist(
        self, block_overlap_constraint, db_session, test_org, test_room, admin_user
    ):
        # Plain values: a rollback expires every loaded row, and reading an
        # expired attribute afterwards would try to lazy-load it.
        org_id, room_id, admin_id = test_org.id, test_room.id, admin_user.id

        def block(hour_from: int, hour_to: int, reason: str) -> RoomBlock:
            return RoomBlock(
                org_id=org_id,
                room_id=room_id,
                start_time=_monday(hour=hour_from),
                end_time=_monday(hour=hour_to),
                reason=reason,
                created_by=admin_id,
            )

        db_session.add(block(10, 12, "a"))
        await db_session.commit()
        db_session.add(block(11, 13, "b"))
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()
        # Adjacent is fine.
        db_session.add(block(12, 13, "c"))
        await db_session.commit()
        assert len((await db_session.execute(select(RoomBlock))).scalars().all()) == 2

    async def test_the_api_reports_the_race_as_a_conflict(
        self, block_overlap_constraint, client, admin_headers, test_org, test_room
    ):
        assert (
            await _block(client, admin_headers, test_org, test_room, _monday(hour=10))
        ).status_code == 201
        second = await _block(client, admin_headers, test_org, test_room, _monday(hour=11))
        assert second.status_code == 409, second.text
        assert "block" in second.text.lower() or "bloque" in second.text.lower()
