"""S19: what each audience may see, pinned field by field.

A response schema is the only thing between a new model column and a public
response. These tests fail when a field appears that nobody decided to
publish, when a public endpoint says anything about who booked, when a list
nests another person's data, or when an unhandled error answers with
internals.
"""

from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.database import get_db
from app.main import app
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import Package
from app.models.space import Room
from app.models.user import User
from httpx import ASGITransport, AsyncClient

API = "/api/v1"
# postal_code/latitude/longitude were published deliberately by C10: a venue's
# address is public by nature, and the customer-facing map needs the point.
# `photos` was published deliberately by C14: customers see them. Each entry is
# `{id, url, thumb_url, width, height}` — storage keys never leave the API.
SPACE_FIELDS = {
    "id", "org_id", "name", "description", "address", "city", "postal_code", "latitude",
    "longitude", "timezone", "images", "photos", "amenities", "is_active", "created_at",
    "updated_at", "rooms",
}  # fmt: skip
ROOM_FIELDS = {
    "id", "space_id", "org_id", "name", "description", "capacity", "hourly_rate", "images",
    "photos", "amenities", "color", "is_active", "created_at", "updated_at", "availability_rules",
}  # fmt: skip
# A room's public opening windows (V06): the week's shape, never the rule row.
OPENING_HOURS_FIELDS = {"day_of_week", "open_time", "close_time"}
PACKAGE_FIELDS = {
    "id", "org_id", "name", "hours", "price", "validity_days", "is_active", "created_at",
    "updated_at",
}  # fmt: skip
USER_FIELDS = {"id", "email", "name", "avatar_url", "created_at"}
# The operator's members list (A05): the membership, never the account.
ORG_USER_FIELDS = {
    "id", "email", "name", "role", "joined_at", "bookings_count", "disabled_at", "created_at",
    # Billing details (I04): what an invoice names, visible to the operator only.
    "tax_id", "billing_name", "billing_address",
}  # fmt: skip
# `reason` (H01) is one of four words about the slot, never about a person.
SLOT_FIELDS = {"start", "end", "available", "reason"}


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
        email="neighbour@test.com", name="Neighbour", password_hash=hash_password("Senha-2026x")
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
        assert set(detail) == {"space", "rooms", "contact"}
        # G04: the organisation's public contact, and nothing else of its
        # settings, rides along for the "Onde estamos" block.
        assert set(detail["contact"]) == {"email", "phone"}
        assert set(detail["space"]) == SPACE_FIELDS
        assert [set(room) for room in detail["rooms"]] == [ROOM_FIELDS]
        assert all(
            set(window) == OPENING_HOURS_FIELDS
            for room in detail["rooms"]
            for window in room["availability_rules"]
        )
        # The detail also nests the space's room relation. Which rooms belong
        # there is S20's business; whatever it holds, every entry carries the
        # published room fields and nothing more.
        assert {frozenset(room) for room in detail["space"]["rooms"]} == {frozenset(ROOM_FIELDS)}
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
        assert {slot["reason"] for slot in slots} <= {
            None,
            "past",
            "booked",
            "blocked",
            "beyond_window",
        }
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
        # P2.2: a list row leaves a null `user` out altogether; either way, nobody
        # else's identity is nested in a customer's own list.
        assert resp.json()["bookings"][0].get("user") is None
        for private in (neighbour.email, neighbour.name, str(neighbour.id), "dele"):
            assert private not in resp.text


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
        rows = users.json()["users"]
        assert {u["id"] for u in rows} >= {str(test_user.id), str(admin_user.id)}
        assert [set(user) for user in rows] == [ORG_USER_FIELDS] * len(rows)
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
