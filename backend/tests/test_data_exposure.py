"""S19: what each audience may see, pinned field by field.

A response schema is the only thing between a new model column and a public
response. These tests fail when a field appears that nobody decided to
publish, when a public endpoint says anything about who booked, when a list
nests another person's data, or when an unhandled error answers with
internals.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.database import get_db
from app.main import app
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package
from app.models.space import Room
from app.models.user import User
from httpx import ASGITransport, AsyncClient

API = "/api/v1"
SPACE_FIELDS = {
    "id", "org_id", "name", "description", "address", "city", "images", "amenities",
    "is_active", "created_at", "updated_at", "rooms",
}  # fmt: skip
ROOM_FIELDS = {
    "id", "space_id", "org_id", "name", "description", "capacity", "hourly_rate", "images",
    "amenities", "color", "is_active", "created_at", "updated_at",
}  # fmt: skip
PACKAGE_FIELDS = {
    "id", "org_id", "name", "hours", "price", "validity_days", "is_active", "created_at",
    "updated_at",
}  # fmt: skip
USER_FIELDS = {"id", "email", "name", "avatar_url", "created_at"}
SLOT_FIELDS = {"start", "end", "available"}


def _monday(hour: int) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days_ahead + 7), time(hour, 0), tzinfo=UTC)


def _headers(user: User, role: str = "member") -> dict[str, str]:
    token = create_access_token({"sub": str(user.id), "email": user.email, "role": role})
    return {"Authorization": f"Bearer {token}"}


async def _confirmed_booking(db_session, *, org_id, room, user, hour: int, notes: str) -> Booking:
    start = _monday(hour)
    booking = Booking(
        org_id=org_id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.hourly,
        notes=notes,
    )
    db_session.add(booking)
    await db_session.commit()
    await db_session.refresh(booking)
    return booking


@pytest_asyncio.fixture
async def neighbour(db_session, test_org) -> User:
    """Another customer of the same org."""
    user = User(
        email="neighbour@test.com", name="Neighbour", password_hash=hash_password("password123")
    )
    db_session.add(user)
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=test_org.id, user_id=user.id, role=MemberRole.member))
    await db_session.commit()
    await db_session.refresh(user)
    return user


class TestPublicResponses:
    async def test_spaces_rooms_and_packages_carry_exactly_the_published_fields(
        self, client, db_session, test_org, test_space, test_room
    ):
        db_session.add(Package(org_id=test_org.id, name="Pack", hours=10, price=Decimal("99.00")))
        db_session.add(
            Room(
                space_id=test_space.id,
                org_id=test_org.id,
                name="Sala desativada",
                description="d",
                capacity=2,
                hourly_rate=Decimal("99.00"),
                color="#000000",
                images=[],
                amenities=[],
                is_active=False,
            )
        )
        await db_session.commit()
        listed = (await client.get(f"{API}/spaces")).json()["spaces"]
        detail = (await client.get(f"{API}/spaces/{test_space.id}")).json()
        packages = (await client.get(f"{API}/packages", params={"org_id": str(test_org.id)})).json()
        assert [set(space) for space in listed] == [SPACE_FIELDS]
        assert set(detail) == {"space", "rooms"}
        assert set(detail["space"]) == SPACE_FIELDS
        assert [set(room) for room in detail["rooms"]] == [ROOM_FIELDS]
        # The room list a visitor browses holds active rooms only.
        assert [room["name"] for room in detail["rooms"]] == [test_room.name]
        assert [set(package) for package in packages["packages"]] == [PACKAGE_FIELDS]

    async def test_availability_says_nothing_about_who_booked(
        self, client, db_session, test_org, test_user, test_member, test_room
    ):
        booking = await _confirmed_booking(
            db_session,
            org_id=test_org.id,
            room=test_room,
            user=test_user,
            hour=10,
            notes="consulta privada",
        )
        resp = await client.get(
            f"{API}/rooms/{test_room.id}/availability",
            params={"date": booking.start_time.date().isoformat()},
        )
        assert resp.status_code == 200, resp.text
        slots = resp.json()["slots"]
        assert {frozenset(slot) for slot in slots} == {frozenset(SLOT_FIELDS)}
        taken = [slot for slot in slots if not slot["available"]]
        assert [datetime.fromisoformat(slot["start"]) for slot in taken] == [booking.start_time]
        for private in (
            str(booking.id),
            str(test_user.id),
            test_user.email,
            test_user.name,
            "privada",
        ):
            assert private not in resp.text


class TestWhatACustomerSees:
    async def test_my_bookings_never_nest_anyone_elses_data(
        self, client, db_session, test_org, test_user, test_member, test_room, neighbour
    ):
        mine = await _confirmed_booking(
            db_session, org_id=test_org.id, room=test_room, user=test_user, hour=10, notes="meu"
        )
        await _confirmed_booking(
            db_session, org_id=test_org.id, room=test_room, user=neighbour, hour=12, notes="dele"
        )
        resp = await client.get(f"{API}/bookings/me", headers=_headers(test_user))
        assert [b["id"] for b in resp.json()["bookings"]] == [str(mine.id)]
        assert resp.json()["bookings"][0]["user"] is None
        for private in (neighbour.email, neighbour.name, str(neighbour.id), "dele"):
            assert private not in resp.text

    async def test_a_door_code_reaches_its_owner_and_that_orgs_operators_only(
        self,
        client,
        db_session,
        test_org,
        test_user,
        test_member,
        test_room,
        admin_user,
        neighbour,
        locks,
    ):
        other_org = Organization(
            name="Outra", slug=f"outra-{uuid.uuid4().hex[:8]}", plan=OrgPlan.starter, settings={}
        )
        outsider = User(
            email="outsider@test.com", name="Outsider", password_hash=hash_password("password123")
        )
        db_session.add_all([other_org, outsider])
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=other_org.id, user_id=outsider.id, role=MemberRole.owner)
        )
        booking = await _confirmed_booking(
            db_session, org_id=test_org.id, room=test_room, user=test_user, hour=10, notes="x"
        )
        # The neighbour holds a confirmed booking too, with no code issued for
        # it, so their list is not empty and its row must carry no code.
        await _confirmed_booking(
            db_session, org_id=test_org.id, room=test_room, user=neighbour, hour=12, notes="y"
        )
        issued = await locks.issue_access_code(
            booking_id=booking.id,
            room_id=test_room.id,
            name="test",
            starts_at=booking.start_time,
            ends_at=booking.end_time,
        )
        org = {"org_id": str(test_org.id)}

        owner = await client.get(f"{API}/bookings/me", headers=_headers(test_user))
        operator = await client.get(
            f"{API}/admin/bookings", params=org, headers=_headers(admin_user, "owner")
        )
        assert [b["access_code"] for b in owner.json()["bookings"]] == [issued.code]
        # The operator sees both bookings of the org, each with its own code or none.
        seen = {b["id"]: b["access_code"] for b in operator.json()["bookings"]}
        assert seen.pop(str(booking.id)) == issued.code
        assert list(seen.values()) == [None]

        same_org_customer = await client.get(f"{API}/bookings/me", headers=_headers(neighbour))
        other_operator_here = await client.get(
            f"{API}/admin/bookings", params=org, headers=_headers(outsider, "owner")
        )
        other_operator_home = await client.get(
            f"{API}/admin/bookings",
            params={"org_id": str(other_org.id)},
            headers=_headers(outsider, "owner"),
        )
        assert other_operator_here.status_code == 403
        # Both of these must succeed, or "the code is absent" would prove nothing.
        assert (same_org_customer.status_code, other_operator_home.status_code) == (200, 200)
        assert [b["access_code"] for b in same_org_customer.json()["bookings"]] == [None]
        assert other_operator_home.json()["bookings"] == []
        for resp in (same_org_customer, other_operator_here, other_operator_home):
            assert issued.code not in resp.text


class TestWhatAnOperatorSees:
    async def test_customers_appear_through_the_user_schema_only(
        self, client, db_session, test_org, test_user, test_member, test_room, admin_user
    ):
        await _confirmed_booking(
            db_session, org_id=test_org.id, room=test_room, user=test_user, hour=10, notes="x"
        )
        headers, org = _headers(admin_user, "owner"), {"org_id": str(test_org.id)}
        users = await client.get(f"{API}/admin/users", params=org, headers=headers)
        bookings = await client.get(f"{API}/admin/bookings", params=org, headers=headers)
        assert [set(user) for user in users.json()["users"]] == [USER_FIELDS]
        nested = [b["user"] for b in bookings.json()["bookings"] if b["user"] is not None]
        assert nested, "the operator list is expected to name the customer"
        assert [set(user) for user in nested] == [USER_FIELDS]
        for resp in (users, bookings):
            assert test_user.password_hash not in resp.text
            assert "password" not in resp.text


class TestErrors:
    async def test_an_unhandled_error_answers_without_internals(self, client):
        async def broken_db():
            raise RuntimeError(
                "connection to 10.0.0.5 failed for user spacerental password=hunter2"
            )
            yield  # pragma: no cover

        previous = app.dependency_overrides[get_db]
        app.dependency_overrides[get_db] = broken_db
        try:
            transport = ASGITransport(app=app, raise_app_exceptions=False)
            async with AsyncClient(transport=transport, base_url="http://test") as soft:
                resp = await soft.get(f"{API}/spaces")
        finally:
            app.dependency_overrides[get_db] = previous
        assert resp.status_code == 500
        for internal in ("hunter2", "10.0.0.5", "Traceback", "RuntimeError", "spacerental"):
            assert internal not in resp.text
