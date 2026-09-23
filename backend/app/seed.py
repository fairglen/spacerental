"""
Seed script for SpaceRental.

Usage:
    python -m app.seed

Creates demo org, admin user, space, rooms, availability rules, and packages
if they do not already exist, and keeps the demo space's location current.
"""

import asyncio
import io
from datetime import time
from decimal import Decimal
from pathlib import Path

from PIL import Image
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import media
from app.auth import hash_password
from app.config import settings
from app.database import async_session_factory, engine
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User


async def require_migrated_schema() -> None:
    """Fail loudly if alembic has not built the schema yet.

    The seeder used to call `Base.metadata.create_all` here. That quietly
    produced a schema alembic knew nothing about — no `alembic_version` row and
    no `bookings_no_overlap` constraint — which is the drift recorded as T8.
    Seeding is data, not schema; migrations own the schema.
    """
    async with engine.begin() as conn:
        stamped = await conn.scalar(
            text(
                "SELECT to_regclass('public.alembic_version') IS NOT NULL"
                " AND EXISTS (SELECT 1 FROM pg_tables"
                " WHERE schemaname = 'public' AND tablename = 'organizations')"
            )
        )
    if not stamped:
        raise SystemExit(
            "Database is not migrated. Run `alembic upgrade head` first "
            "(the docker-compose backend does this automatically on boot)."
        )


# Where the demo space physically is. The area is Massamá/Queluz in the
# municipality of Sintra; "Queluz" is the postal locality, which is what an
# address line uses.
DEMO_SPACE_LOCATION = {
    "address": "R. 12 de Julho de 1997 5, Loja 1",
    "postal_code": "2745-841",
    "city": "Queluz",
    "latitude": Decimal("38.755723"),
    "longitude": Decimal("-9.279799"),
}
DEMO_SPACE_DESCRIPTION = (
    "Um espaço profissional partilhado para profissionais de saúde e bem-estar, "
    "com gabinetes à hora, conforto, privacidade e flexibilidade."
)
# What earlier seeds wrote. Replaced on re-seed; any other text is an
# operator's own edit and is left alone.
_PREVIOUS_DEMO_SPACE_DESCRIPTIONS = {
    "Um espaço tranquilo para consultas e trabalho no coração de Lisboa.",
    "Um espaço tranquilo para consultas e trabalho, com salas privadas à hora.",
}
# One short factual line per demo room (W04). Same rule as the space: a
# description an earlier seed wrote is refreshed, an operator's own text stays.
DEMO_ROOM_DESCRIPTIONS = {
    "Sala Calma": "Gabinete tranquilo e acolhedor, preparado para consultas individuais.",
    "Sala Brisa": (
        "Gabinete mais amplo, com mesa de trabalho, preparado para consultas com tomada de notas."
    ),
    "Sala Névoa": (
        "Gabinete luminoso, com luz natural, "
        "preparado para consultas individuais ou pequenos grupos."
    ),
}


def _previous_demo_room_description(name: str) -> str:
    return f"Sala privada e confortável — {name}."


# Opening hours the seed writes (V05): every day, 08:00-22:00. Evaluated in
# UTC like every rule (R01), so the Lisbon wall clock reads 09:00-23:00 in
# summer. `_PREVIOUS_SEED_RULES` is what earlier seeds wrote (Mon-Sat
# 08:00-20:00), which a re-seed replaces; anything else is an operator's.
SEED_RULES = frozenset((day, time(8, 0), time(22, 0), True) for day in range(7))
_PREVIOUS_SEED_RULES = frozenset((day, time(8, 0), time(20, 0), True) for day in range(6))

# The four illustrated room scenes the marketing site ships (V01): the same
# four, in this order, for every demo room, until real photos replace them
# (TODO Q-V08). Each is a 1600x1200 WebP with a 480x360 thumbnail, already
# the shape the upload pipeline (C14) would produce.
SEED_PHOTO_NAMES = ("sala-01", "sala-02", "sala-03", "sala-04")
# Marks a photo the seed wrote, so a re-seed can replace its own and leave an
# operator's uploads alone. Not part of the public shape (`PhotoOut` ignores it).
SEED_MARK = "seed"


def seed_photos_dir() -> Path:
    """Where the illustrations are: `SEED_PHOTOS_DIR`, or the repo's own copy.

    Natively the checkout has `flowspace-site/` two levels up from this file;
    inside the backend container it does not, so Compose mounts that folder
    and sets the variable.
    """
    if settings.SEED_PHOTOS_DIR:
        return Path(settings.SEED_PHOTOS_DIR)
    return Path(__file__).resolve().parents[2] / "flowspace-site" / "assets" / "img" / "room-photos"


# What C16's generator produced, and nothing an operator is likely to have
# uploaded: two or three pictures, every one exactly 960x720, none marked.
_LEGACY_PLACEHOLDER_SIZE = (960, 720)


def _is_legacy_placeholder_set(photos: list[dict]) -> bool:
    return 2 <= len(photos) <= 3 and all(
        SEED_MARK not in p and (p.get("width"), p.get("height")) == _LEGACY_PLACEHOLDER_SIZE
        for p in photos
    )


def _read_illustration(name: str) -> tuple[bytes, bytes, int, int]:
    folder = seed_photos_dir()
    main_path, thumb_path = folder / f"{name}.webp", folder / f"{name}-thumb.webp"
    for path in (main_path, thumb_path):
        if not path.is_file():
            raise FileNotFoundError(
                f"Seed photo {path} is missing; set SEED_PHOTOS_DIR to the folder holding "
                f"{', '.join(n + '.webp' for n in SEED_PHOTO_NAMES)} and their -thumb.webp files"
            )
    main, thumb = main_path.read_bytes(), thumb_path.read_bytes()
    with Image.open(io.BytesIO(main)) as image:
        width, height = image.size
    return main, thumb, width, height


async def _seed_room_photos(room: Room) -> bool:
    """Give a demo room the four illustrations, through the same storage as uploads.

    Idempotent: the photos an earlier seed wrote (marked `SEED_MARK`) are
    replaced — files deleted, rows rewritten — and an operator's own uploads
    stay exactly where they are, ahead of the seed's. Returns whether anything
    changed.
    """
    storage = media.get_media_storage()
    current = list(room.photos or [])
    if _is_legacy_placeholder_set(current):
        # The gradients C16's seed generated carry no mark; a database seeded
        # before V01 would keep them ahead of the illustrations for good.
        seeded, operators = current, []
    else:
        operators = [p for p in current if SEED_MARK not in p]
        seeded = [p for p in current if SEED_MARK in p]
    if [p.get(SEED_MARK) for p in seeded] == list(SEED_PHOTO_NAMES):
        return False
    for photo in seeded:
        for key in (photo.get("key"), photo.get("thumb_key")):
            if key:
                await storage.delete(key)
    fresh: list[dict] = []
    for name in SEED_PHOTO_NAMES:
        main, thumb, width, height = _read_illustration(name)
        photo_id, key, thumb_key = media.new_photo_keys("rooms", room.id)
        await storage.save(key, main)
        await storage.save(thumb_key, thumb)
        fresh.append(
            {
                "id": photo_id,
                "key": key,
                "thumb_key": thumb_key,
                "width": width,
                "height": height,
                SEED_MARK: name,
            }
        )
    room.photos = operators + fresh
    return True


async def seed_demo_data(session: AsyncSession) -> None:
    """Create or bring up to date the demo data. Does not commit."""
    # ── Organization ──────────────────────────────────────────────────────
    result = await session.execute(select(Organization).where(Organization.slug == "demo-space"))
    org = result.scalar_one_or_none()
    if org is None:
        org = Organization(
            name="Demo Space",
            slug="demo-space",
            plan=OrgPlan.starter,
            settings={},
        )
        session.add(org)
        await session.flush()
        print(f"Created org: {org.name} ({org.id})")
    else:
        print(f"Org already exists: {org.name} ({org.id})")

    # ── Admin User ────────────────────────────────────────────────────────
    result = await session.execute(select(User).where(User.email == "admin@demo.com"))
    admin_user = result.scalar_one_or_none()
    if admin_user is None:
        admin_user = User(
            email="admin@demo.com",
            name="Demo Admin",
            password_hash=hash_password("admin123"),
        )
        session.add(admin_user)
        await session.flush()
        print(f"Created user: {admin_user.email} ({admin_user.id})")
        print("  Login: admin@demo.com / admin123")
    else:
        print(f"User already exists: {admin_user.email} ({admin_user.id})")

    # ── Org Membership ────────────────────────────────────────────────────
    result = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.org_id == org.id,
            OrganizationMember.user_id == admin_user.id,
        )
    )
    if result.scalar_one_or_none() is None:
        membership = OrganizationMember(
            org_id=org.id,
            user_id=admin_user.id,
            role=MemberRole.owner,
        )
        session.add(membership)
        await session.flush()
        print("Created org membership (owner)")

    # ── Space ─────────────────────────────────────────────────────────────
    result = await session.execute(
        select(Space).where(Space.org_id == org.id, Space.name == "Espaço Calmo")
    )
    space = result.scalar_one_or_none()
    if space is None:
        space = Space(
            org_id=org.id,
            name="Espaço Calmo",
            description=DEMO_SPACE_DESCRIPTION,
            images=[],
            amenities=["WiFi", "Café", "Impressora", "Ar condicionado"],
            **DEMO_SPACE_LOCATION,
        )
        session.add(space)
        await session.flush()
        print(f"Created space: {space.name} ({space.id})")
    else:
        # A database seeded before the space had a real location still holds
        # the placeholder Lisbon address: move it rather than leave it stale.
        for field, value in DEMO_SPACE_LOCATION.items():
            setattr(space, field, value)
        if space.description in _PREVIOUS_DEMO_SPACE_DESCRIPTIONS:
            space.description = DEMO_SPACE_DESCRIPTION
        await session.flush()
        print(f"Space already exists, location up to date: {space.name} ({space.id})")

    # ── Rooms ─────────────────────────────────────────────────────────────
    rooms_data = [
        {"name": "Sala Calma", "hourly_rate": Decimal("11.00"), "color": "#A8D5BA"},
        {"name": "Sala Brisa", "hourly_rate": Decimal("11.00"), "color": "#B8D4E8"},
        {"name": "Sala Névoa", "hourly_rate": Decimal("11.00"), "color": "#D4C5E2"},
    ]

    created_rooms: list[Room] = []
    for room_data in rooms_data:
        result = await session.execute(
            select(Room).where(Room.space_id == space.id, Room.name == room_data["name"])
        )
        room = result.scalar_one_or_none()
        if room is None:
            room = Room(
                space_id=space.id,
                org_id=org.id,
                name=room_data["name"],
                description=DEMO_ROOM_DESCRIPTIONS[room_data["name"]],
                capacity=6,
                hourly_rate=room_data["hourly_rate"],
                color=room_data["color"],
                amenities=["WiFi", "Quadro branco", "Ecrã"],
                images=[],
            )
            session.add(room)
            await session.flush()
            print(f"Created room: {room.name} ({room.id})")
        else:
            if room.description == _previous_demo_room_description(room.name):
                room.description = DEMO_ROOM_DESCRIPTIONS[room.name]
            print(f"Room already exists: {room.name} ({room.id})")
        # The seed's own photos are replaced; an operator's uploads are theirs.
        if await _seed_room_photos(room):
            await session.flush()
            print(f"  Seeded {len(SEED_PHOTO_NAMES)} illustration photos for {room.name}")
        created_rooms.append(room)

    # ── Availability Rules (every day 08:00-22:00, V05) ───────────────────
    for room in created_rooms:
        result = await session.execute(
            select(AvailabilityRule).where(AvailabilityRule.room_id == room.id)
        )
        existing_rules = result.scalars().all()
        found = {(r.day_of_week, r.open_time, r.close_time, r.is_active) for r in existing_rules}
        if found == SEED_RULES:
            print(f"Availability rules already current for room: {room.name}")
        elif existing_rules and found != _PREVIOUS_SEED_RULES:
            # An operator shaped these hours; a re-seed must not undo that.
            print(f"Availability rules kept as the operator set them: {room.name}")
        else:
            for rule in existing_rules:
                await session.delete(rule)
            for day, open_time, close_time, _ in sorted(SEED_RULES):
                session.add(
                    AvailabilityRule(
                        room_id=room.id,
                        day_of_week=day,
                        open_time=open_time,
                        close_time=close_time,
                    )
                )
            await session.flush()
            print(f"Seeded availability rules for room: {room.name}")

    # ── Packages ──────────────────────────────────────────────────────────
    packages_data = [
        {"name": "Pack 10h", "hours": 10, "price": Decimal("100.00"), "validity_days": 365},
        {"name": "Pack 20h", "hours": 20, "price": Decimal("190.00"), "validity_days": 365},
    ]

    for pkg_data in packages_data:
        result = await session.execute(
            select(Package).where(Package.org_id == org.id, Package.name == pkg_data["name"])
        )
        pkg = result.scalar_one_or_none()
        if pkg is None:
            pkg = Package(
                org_id=org.id,
                name=pkg_data["name"],
                hours=pkg_data["hours"],
                price=pkg_data["price"],
                validity_days=pkg_data["validity_days"],
            )
            session.add(pkg)
            await session.flush()
            print(f"Created package: {pkg.name} ({pkg.id})")
        else:
            print(f"Package already exists: {pkg.name} ({pkg.id})")


async def seed() -> None:
    await require_migrated_schema()

    async with async_session_factory() as session:
        await seed_demo_data(session)
        await session.commit()
        print("\nSeed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
