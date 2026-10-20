"""`python -m app.bootstrap` (E03): one organisation, created once, never
touched again; its defaults are the marketing site's facts; the seed refuses
production. Against the real PostgreSQL schema the fixtures build."""

import json
import os
from datetime import time
from decimal import Decimal
from pathlib import Path

import pytest
from app import bootstrap, seed
from app.auth import hash_password
from app.bootstrap import (
    DEFAULT_PACKS,
    DEFAULT_ROOMS,
    PACK_DISCOUNT_PERCENT,
    PACK_NO_EXPIRY_DAYS,
    SITE_CLOSES,
    SITE_DESCRIPTION,
    SITE_LOCATION,
    SITE_OPENS,
    SITE_TIMEZONE,
    BootstrapOptions,
    PackSpec,
    RoomSpec,
    options_from_args,
    parse_pack,
    parse_room,
)
from app.models.organization import MemberRole, Organization, OrganizationMember
from app.models.package import Package
from app.models.password_reset import PasswordResetToken
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from sqlalchemy import func, select

OPTIONS = BootstrapOptions(name="FlowSpace", slug="flowspace", admin_email="admin@example.com")


async def count(session, model, *where) -> int:
    return await session.scalar(select(func.count()).select_from(model).where(*where))


class TestFirstRun:
    async def test_creates_the_organisation_and_everything_it_needs(self, db_session):
        result = await bootstrap.bootstrap(db_session, OPTIONS)
        await db_session.commit()

        assert result.created is True
        org = await db_session.scalar(select(Organization).where(Organization.slug == "flowspace"))
        assert org is not None and org.name == "FlowSpace"

        space = await db_session.scalar(select(Space).where(Space.org_id == org.id))
        assert space.name == "FlowSpace"
        assert space.timezone == SITE_TIMEZONE
        assert space.address == SITE_LOCATION["address"]
        assert space.postal_code == SITE_LOCATION["postal_code"]
        assert space.city == SITE_LOCATION["city"]
        assert (space.latitude, space.longitude) == (
            SITE_LOCATION["latitude"],
            SITE_LOCATION["longitude"],
        )
        assert space.description == SITE_DESCRIPTION

        rooms = (await db_session.execute(select(Room).where(Room.space_id == space.id))).scalars()
        by_name = {room.name: room for room in rooms}
        assert set(by_name) == {spec.name for spec in DEFAULT_ROOMS}
        for spec in DEFAULT_ROOMS:
            room = by_name[spec.name]
            assert room.org_id == org.id
            assert room.hourly_rate == spec.hourly_rate
            assert room.capacity == spec.capacity
            assert room.amenities == list(spec.amenities)
            rules = (
                (
                    await db_session.execute(
                        select(AvailabilityRule).where(AvailabilityRule.room_id == room.id)
                    )
                )
                .scalars()
                .all()
            )
            assert {(r.day_of_week, r.open_time, r.close_time, r.is_active) for r in rules} == {
                (day, SITE_OPENS, SITE_CLOSES, True) for day in range(7)
            }

        packs = (
            (await db_session.execute(select(Package).where(Package.org_id == org.id)))
            .scalars()
            .all()
        )
        assert [(p.name, p.hours, p.price, p.validity_days) for p in packs] == [
            (s.name, s.hours, s.price, s.validity_days) for s in DEFAULT_PACKS
        ]

        admin = await db_session.scalar(select(User).where(User.email == "admin@example.com"))
        assert admin.password_hash is None
        membership = await db_session.scalar(
            select(OrganizationMember).where(
                OrganizationMember.org_id == org.id, OrganizationMember.user_id == admin.id
            )
        )
        assert membership.role is MemberRole.owner

        # The set-password link: one live token, the reset page's URL.
        assert result.admin_email == "admin@example.com"
        assert result.admin_link.startswith(f"{seed.settings.FRONTEND_URL}/reset-password/")
        assert (
            await count(db_session, PasswordResetToken, PasswordResetToken.user_id == admin.id) == 1
        )
        assert any("Created organisation: FlowSpace [flowspace]" in m for m in result.messages)

    async def test_custom_rooms_packs_and_space_name(self, db_session):
        options = BootstrapOptions(
            name="Casa",
            slug="casa",
            admin_email="x@example.com",
            admin_name="X",
            space_name="Casa Centro",
            rooms=(RoomSpec("Sala A", Decimal("9.50"), 3, ("Wi-Fi",)),),
            packs=(PackSpec("Pack 5h", 5, Decimal("40.00"), 90),),
        )
        await bootstrap.bootstrap(db_session, options)
        await db_session.commit()
        space = await db_session.scalar(select(Space).where(Space.name == "Casa Centro"))
        [room] = (
            (await db_session.execute(select(Room).where(Room.space_id == space.id)))
            .scalars()
            .all()
        )
        assert (room.name, room.hourly_rate, room.capacity, room.amenities) == (
            "Sala A",
            Decimal("9.50"),
            3,
            ["Wi-Fi"],
        )
        [pack] = (
            (await db_session.execute(select(Package).where(Package.name == "Pack 5h")))
            .scalars()
            .all()
        )
        assert (pack.hours, pack.price, pack.validity_days) == (5, Decimal("40.00"), 90)
        admin = await db_session.scalar(select(User).where(User.email == "x@example.com"))
        assert admin.name == "X"

    async def test_an_existing_user_keeps_their_password_and_gets_no_link(self, db_session):
        db_session.add(
            User(email="admin@example.com", name="Já existe", password_hash=hash_password("x" * 12))
        )
        await db_session.commit()
        result = await bootstrap.bootstrap(db_session, OPTIONS)
        await db_session.commit()
        assert result.created is True
        assert result.admin_link is None
        admin = await db_session.scalar(select(User).where(User.email == "admin@example.com"))
        assert admin.password_hash is not None
        assert (
            await count(db_session, PasswordResetToken, PasswordResetToken.user_id == admin.id) == 0
        )
        org = await db_session.scalar(select(Organization).where(Organization.slug == "flowspace"))
        assert (
            await db_session.scalar(
                select(OrganizationMember.role).where(
                    OrganizationMember.org_id == org.id, OrganizationMember.user_id == admin.id
                )
            )
        ) is MemberRole.owner


class TestSecondRun:
    async def test_the_same_slug_changes_nothing(self, db_session):
        first = await bootstrap.bootstrap(db_session, OPTIONS)
        await db_session.commit()
        before = {
            model: await count(db_session, model)
            for model in (
                Organization,
                Space,
                Room,
                AvailabilityRule,
                Package,
                User,
                OrganizationMember,
                PasswordResetToken,
            )
        }
        token_before = await db_session.scalar(select(PasswordResetToken.token_hash))

        again = await bootstrap.bootstrap(
            db_session,
            BootstrapOptions(
                name="Another name",
                slug="flowspace",
                admin_email="other@example.com",
                rooms=(RoomSpec("Nova", Decimal("1.00")),),
            ),
        )
        await db_session.commit()

        assert again.created is False
        assert again.org_id == first.org_id
        assert again.admin_link is None
        assert again.messages == [
            f"Organisation 'flowspace' already exists ({first.org_id}); nothing changed."
        ]
        after = {model: await count(db_session, model) for model in before}
        assert after == before
        assert await db_session.scalar(select(PasswordResetToken.token_hash)) == token_before
        assert (
            await db_session.scalar(select(User).where(User.email == "other@example.com")) is None
        )


class TestArguments:
    def test_room_name_and_rate(self):
        assert parse_room("Sala Nova:9.5") == RoomSpec("Sala Nova", Decimal("9.50"))

    def test_a_site_room_keeps_its_capacity_and_equipment(self):
        spec = parse_room("Sala Névoa:20")
        assert (spec.hourly_rate, spec.capacity, spec.amenities) == (
            Decimal("20.00"),
            6,
            DEFAULT_ROOMS[2].amenities,
        )

    @pytest.mark.parametrize("raw", ["Sala", "Sala:abc", "Sala:0", ":12"])
    def test_a_malformed_room_is_refused(self, raw):
        with pytest.raises(Exception, match="--room"):
            parse_room(raw)

    def test_pack_fields(self):
        assert parse_pack("Pack 5h:5:40:90") == PackSpec("Pack 5h", 5, Decimal("40.00"), 90)

    @pytest.mark.parametrize("raw", ["Pack:5:40", "Pack:x:40:90", "Pack:5:40:0", ":5:40:90"])
    def test_a_malformed_pack_is_refused(self, raw):
        with pytest.raises(Exception, match="--pack"):
            parse_pack(raw)

    def test_the_command_line_builds_the_options(self):
        options = options_from_args(
            [
                "--name", "FlowSpace", "--slug", "FlowSpace", "--admin-email", "Geral@Example.com",
                "--room", "A:10", "--room", "B:11", "--pack", "P:10:90:30",
            ]
        )  # fmt: skip
        assert options.slug == "flowspace"
        assert options.admin_email == "geral@example.com"
        assert [r.name for r in options.rooms] == ["A", "B"]
        assert options.packs == (PackSpec("P", 10, Decimal("90.00"), 30),)

    def test_without_rooms_and_packs_the_site_defaults_apply(self):
        options = options_from_args(["--name", "F", "--slug", "f", "--admin-email", "a@b.pt"])
        assert options.rooms == DEFAULT_ROOMS
        assert options.packs == DEFAULT_PACKS


class TestSeedGuard:
    async def test_the_seed_refuses_production(self, monkeypatch):
        monkeypatch.setattr(seed.settings, "APP_ENV", "production")
        with pytest.raises(SystemExit, match="app.bootstrap"):
            await seed.seed()

    def test_the_guard_is_silent_elsewhere(self, monkeypatch):
        monkeypatch.setattr(seed.settings, "APP_ENV", "development")
        seed.refuse_in_production()


def business_json() -> dict:
    """The site's facts: BUSINESS_JSON (the docker test stack mounts it) or
    the checkout's own copy."""
    path = Path(os.environ.get("BUSINESS_JSON") or "")
    if not path.is_file():
        path = (
            Path(__file__).resolve().parents[2]
            / "flowspace-site"
            / "assets"
            / "data"
            / "business.json"
        )
    assert path.is_file(), (
        f"{path} is missing: set BUSINESS_JSON to flowspace-site/assets/data/business.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


class TestDefaultsMatchTheSite:
    """The bootstrap's constants are copies of business.json (the backend
    image has no view of the site); this is what keeps them copies."""

    def test_rooms(self):
        site = business_json()["rooms"]
        assert [r.name for r in DEFAULT_ROOMS] == [r["name"] for r in site]
        for spec, room in zip(DEFAULT_ROOMS, site, strict=True):
            assert spec.hourly_rate == Decimal(room["price_per_hour"]).quantize(Decimal("0.01"))
            if room["capacity"] is not None:
                assert spec.capacity == room["capacity"]
            assert list(spec.amenities) == room["equipment"]

    def test_the_pack(self):
        business = business_json()
        [site_pack] = business["packs"]
        [spec] = DEFAULT_PACKS
        assert spec.name == site_pack["name"]
        assert spec.hours == site_pack["hours"]
        assert site_pack["discount_percent"] == PACK_DISCOUNT_PERCENT
        cheapest = Decimal(business["hourly"]["min"])
        assert spec.price == (cheapest * spec.hours * (100 - PACK_DISCOUNT_PERCENT) / 100).quantize(
            Decimal("0.01")
        )
        assert site_pack["validity"] == "Sem expiração"
        assert spec.validity_days == PACK_NO_EXPIRY_DAYS

    def test_address_hours_and_description(self):
        business = business_json()
        address = business["address"]
        assert SITE_LOCATION["address"] == address["street"]
        assert SITE_LOCATION["postal_code"] == address["postal_code"]
        assert SITE_LOCATION["city"] == address["locality"]
        assert (SITE_LOCATION["latitude"], SITE_LOCATION["longitude"]) == (
            Decimal(str(business["geo"]["lat"])),
            Decimal(str(business["geo"]["lng"])),
        )
        hours = business["hours"]
        assert len(hours["days"]) == 7
        assert (time.fromisoformat(hours["opens"]), time.fromisoformat(hours["closes"])) == (
            SITE_OPENS,
            SITE_CLOSES,
        )
        assert business["description"] == SITE_DESCRIPTION
