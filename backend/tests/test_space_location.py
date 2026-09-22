"""A space has a real location: postcode and coordinates (C10)."""

import uuid
from decimal import Decimal

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.space import Room, Space
from app.models.user import User
from app.seed import DEMO_ROOM_DESCRIPTIONS, DEMO_SPACE_DESCRIPTION, seed_demo_data
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

API = "/api/v1"

QUELUZ = {
    "address": "R. 12 de Julho de 1997 5, Loja 1",
    "postal_code": "2745-841",
    "city": "Queluz",
    "latitude": "38.755723",
    "longitude": "-9.279799",
}


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


@pytest_asyncio.fixture
async def other_org_admin_headers(db_session) -> dict:
    """An owner of a different organization: an admin, just not of test_org."""
    org = Organization(name="Other Org", slug="other-org", plan=OrgPlan.starter, settings={})
    user = User(
        email="other-admin@example.com", name="Other", password_hash=hash_password("x" * 12)
    )
    db_session.add_all([org, user])
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=user.id, role=MemberRole.owner))
    await db_session.commit()
    token = create_access_token(
        {"sub": str(user.id), "email": user.email, "name": user.name, "role": "owner"}
    )
    return {"Authorization": f"Bearer {token}"}


class TestCreateWithLocation:
    async def test_create_stores_and_returns_the_location(self, client, admin_headers, test_org):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Queluz", **QUELUZ},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        space = resp.json()["space"]
        assert space["postal_code"] == "2745-841"
        assert Decimal(space["latitude"]) == Decimal("38.755723")
        assert Decimal(space["longitude"]) == Decimal("-9.279799")

    async def test_location_is_optional(self, client, admin_headers, test_org):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Bare"},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        space = resp.json()["space"]
        assert space["postal_code"] is None
        assert space["latitude"] is None
        assert space["longitude"] is None

    async def test_json_numbers_are_accepted_and_rounded_to_six_places(
        self, client, admin_headers, test_org
    ):
        # A maps app hands out more digits than Numeric(9, 6) keeps; a pasted
        # value should be stored, not refused.
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Pasted", "latitude": 38.75572349, "longitude": -9.2797994},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        space = resp.json()["space"]
        assert Decimal(space["latitude"]) == Decimal("38.755723")
        assert Decimal(space["longitude"]) == Decimal("-9.279799")

    @pytest.mark.parametrize(
        "coordinates",
        [
            {"latitude": "90.000001", "longitude": "0"},
            {"latitude": "-90.5", "longitude": "0"},
            {"latitude": "0", "longitude": "180.000001"},
            {"latitude": "0", "longitude": "-181"},
            {"latitude": "NaN", "longitude": "0"},
            {"latitude": "0", "longitude": "Infinity"},
            {"latitude": "1e400", "longitude": "0"},
            {"latitude": "north", "longitude": "0"},
        ],
    )
    async def test_out_of_range_coordinates_are_refused(
        self, client, admin_headers, test_org, coordinates
    ):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Nowhere", **coordinates},
            headers=admin_headers,
        )
        assert resp.status_code == 422, resp.text

    async def test_the_poles_and_the_antimeridian_are_real_places(
        self, client, admin_headers, test_org
    ):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Edge", "latitude": "-90", "longitude": "180"},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text

    @pytest.mark.parametrize(
        "half",
        [
            {"latitude": "38.755723"},
            {"longitude": "-9.279799"},
            {"latitude": "1", "longitude": None},
        ],
    )
    async def test_one_coordinate_without_the_other_is_refused(
        self, client, admin_headers, test_org, half
    ):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Half", **half},
            headers=admin_headers,
        )
        assert resp.status_code == 422, resp.text

    async def test_postcode_is_bounded(self, client, admin_headers, test_org):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Long", "postal_code": "9" * 21},
            headers=admin_headers,
        )
        assert resp.status_code == 422, resp.text


class TestUpdateLocation:
    async def test_update_sets_the_location(self, client, admin_headers, test_org, test_space):
        resp = await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params=_org(test_org),
            json=QUELUZ,
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        space = resp.json()["space"]
        assert space["city"] == "Queluz"
        assert space["postal_code"] == "2745-841"
        assert Decimal(space["latitude"]) == Decimal("38.755723")

    async def test_update_can_clear_the_location(self, client, admin_headers, test_org, test_space):
        url = f"{API}/admin/spaces/{test_space.id}"
        await client.put(url, params=_org(test_org), json=QUELUZ, headers=admin_headers)
        resp = await client.put(
            url,
            params=_org(test_org),
            json={"postal_code": None, "latitude": None, "longitude": None},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        space = resp.json()["space"]
        assert (space["postal_code"], space["latitude"], space["longitude"]) == (None, None, None)

    @pytest.mark.parametrize(
        "body",
        [
            {"latitude": "38.7"},
            {"longitude": "-9.2"},
            {"latitude": None},
            {"latitude": "38.7", "longitude": None},
        ],
    )
    async def test_an_update_may_not_leave_half_a_coordinate(
        self, client, admin_headers, test_org, test_space, db_session, body
    ):
        url = f"{API}/admin/spaces/{test_space.id}"
        await client.put(url, params=_org(test_org), json=QUELUZ, headers=admin_headers)
        resp = await client.put(url, params=_org(test_org), json=body, headers=admin_headers)
        assert resp.status_code == 422, resp.text
        stored = await db_session.execute(
            select(Space.latitude, Space.longitude).where(Space.id == test_space.id)
        )
        assert stored.one() == (Decimal("38.755723"), Decimal("-9.279799"))

    async def test_update_refuses_out_of_range(self, client, admin_headers, test_org, test_space):
        resp = await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params=_org(test_org),
            json={"latitude": "91", "longitude": "0"},
            headers=admin_headers,
        )
        assert resp.status_code == 422, resp.text

    async def test_unrelated_update_leaves_the_location_alone(
        self, client, admin_headers, test_org, test_space
    ):
        url = f"{API}/admin/spaces/{test_space.id}"
        await client.put(url, params=_org(test_org), json=QUELUZ, headers=admin_headers)
        resp = await client.put(
            url, params=_org(test_org), json={"name": "Renamed"}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        assert Decimal(resp.json()["space"]["latitude"]) == Decimal("38.755723")


class TestTenantScoping:
    async def test_another_orgs_admin_cannot_move_our_space(
        self, client, other_org_admin_headers, test_org, test_space, db_session
    ):
        # Asking as an admin of our org: they are not one.
        resp = await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params=_org(test_org),
            json=QUELUZ,
            headers=other_org_admin_headers,
        )
        assert resp.status_code == 403, resp.text

        # Asking as an admin of their own org: our space is not in it.
        other_org_id = await db_session.scalar(
            select(Organization.id).where(Organization.slug == "other-org")
        )
        resp = await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params={"org_id": str(other_org_id)},
            json=QUELUZ,
            headers=other_org_admin_headers,
        )
        assert resp.status_code == 404, resp.text

        stored = await db_session.execute(
            select(Space.city, Space.postal_code, Space.latitude).where(Space.id == test_space.id)
        )
        assert stored.one() == ("Lisbon", None, None)

    async def test_another_orgs_admin_cannot_create_in_our_org(
        self, client, other_org_admin_headers, test_org
    ):
        resp = await client.post(
            f"{API}/admin/spaces",
            params=_org(test_org),
            json={"name": "Squat", **QUELUZ},
            headers=other_org_admin_headers,
        )
        assert resp.status_code == 403, resp.text

    async def test_a_member_cannot_write_the_location(
        self, client, auth_headers, test_member, test_org, test_space
    ):
        resp = await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params=_org(test_org),
            json=QUELUZ,
            headers=auth_headers,
        )
        assert resp.status_code == 403, resp.text


class TestPublicShape:
    async def test_list_and_detail_expose_the_location(
        self, client, admin_headers, test_org, test_space
    ):
        await client.put(
            f"{API}/admin/spaces/{test_space.id}",
            params=_org(test_org),
            json=QUELUZ,
            headers=admin_headers,
        )
        listed = (await client.get(f"{API}/spaces")).json()["spaces"]
        assert [s["postal_code"] for s in listed] == ["2745-841"]
        assert Decimal(listed[0]["longitude"]) == Decimal("-9.279799")

        detail = (await client.get(f"{API}/spaces/{test_space.id}")).json()
        assert set(detail) == {"space", "rooms"}
        assert detail["space"]["postal_code"] == "2745-841"
        assert Decimal(detail["space"]["latitude"]) == Decimal("38.755723")

    async def test_a_space_without_a_location_reports_nulls(self, client, test_space):
        space = (await client.get(f"{API}/spaces/{test_space.id}")).json()["space"]
        assert (space["postal_code"], space["latitude"], space["longitude"]) == (None, None, None)


class TestDatabaseConstraints:
    """The schema refuses what the API refuses, for writers that skip the API."""

    @pytest.mark.parametrize(
        "values",
        [
            {"latitude": Decimal("38.7"), "longitude": None},
            {"latitude": None, "longitude": Decimal("-9.2")},
            {"latitude": Decimal("90.5"), "longitude": Decimal(0)},
            {"latitude": Decimal(0), "longitude": Decimal("-180.5")},
        ],
    )
    async def test_impossible_coordinates_cannot_be_stored(self, db_session, test_space, values):
        with pytest.raises(IntegrityError):
            await db_session.execute(
                update(Space).where(Space.id == test_space.id).values(**values)
            )
        await db_session.rollback()


class TestSeed:
    async def test_seed_places_the_demo_space_in_queluz(self, db_session):
        await seed_demo_data(db_session)
        await db_session.commit()
        space = (
            await db_session.execute(select(Space).where(Space.name == "Espaço Calmo"))
        ).scalar_one()
        assert space.address == "R. 12 de Julho de 1997 5, Loja 1"
        assert space.postal_code == "2745-841"
        assert space.city == "Queluz"
        assert (space.latitude, space.longitude) == (Decimal("38.755723"), Decimal("-9.279799"))

    async def test_reseeding_moves_an_already_seeded_space_without_duplicating_it(self, db_session):
        # The database as the previous seed left it.
        org = Organization(name="Demo Space", slug="demo-space", plan=OrgPlan.starter, settings={})
        db_session.add(org)
        await db_session.flush()
        old = Space(
            org_id=org.id,
            name="Espaço Calmo",
            description="Um espaço tranquilo para consultas e trabalho no coração de Lisboa.",
            address="Rua do Calmo, 42",
            city="Lisboa",
            images=[],
            amenities=["WiFi"],
        )
        db_session.add(old)
        await db_session.commit()
        old_id: uuid.UUID = old.id

        await seed_demo_data(db_session)
        await db_session.commit()
        await seed_demo_data(db_session)
        await db_session.commit()

        assert await db_session.scalar(select(func.count()).select_from(Space)) == 1
        assert await db_session.scalar(select(func.count()).select_from(Room)) == 3
        space = (await db_session.execute(select(Space))).scalar_one()
        await db_session.refresh(space)
        assert space.id == old_id
        assert space.city == "Queluz"
        assert space.postal_code == "2745-841"
        customer_facing = " ".join(
            filter(None, [space.name, space.description, space.address, space.city])
        )
        assert "Lisboa" not in customer_facing and "Lisbon" not in customer_facing

    async def test_reseeding_refreshes_descriptions_it_wrote_and_keeps_an_operators_own(
        self, db_session
    ):
        """W04: the seed rewrites its own earlier text but never an operator's edit."""
        await seed_demo_data(db_session)
        await db_session.commit()
        space = (await db_session.execute(select(Space))).scalar_one()
        rooms = {r.name: r for r in (await db_session.execute(select(Room))).scalars()}
        assert space.description == DEMO_SPACE_DESCRIPTION
        assert {n: r.description for n, r in rooms.items()} == DEMO_ROOM_DESCRIPTIONS
        for text in (space.description, *DEMO_ROOM_DESCRIPTIONS.values()):
            assert "coworking" not in text.lower() and "psic" not in text.lower()

        # The texts earlier seeds wrote, plus one the operator typed themselves.
        space.description = (
            "Um espaço tranquilo para consultas e trabalho, com salas privadas à hora."
        )
        rooms["Sala Calma"].description = "Sala privada e confortável — Sala Calma."
        rooms["Sala Brisa"].description = "Texto do operador sobre a Brisa."
        await db_session.commit()

        await seed_demo_data(db_session)
        await db_session.commit()
        for obj in (space, *rooms.values()):
            await db_session.refresh(obj)
        assert space.description == DEMO_SPACE_DESCRIPTION
        assert rooms["Sala Calma"].description == DEMO_ROOM_DESCRIPTIONS["Sala Calma"]
        assert rooms["Sala Brisa"].description == "Texto do operador sobre a Brisa."
        assert await db_session.scalar(select(func.count()).select_from(Room)) == 3
