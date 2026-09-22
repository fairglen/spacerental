"""
Seed script for SpaceRental.

Usage:
    python -m app.seed

Creates demo org, admin user, space, rooms, availability rules, and packages
if they do not already exist, and keeps the demo space's location current.
"""

import asyncio
import io
import unicodedata
from datetime import time
from decimal import Decimal

from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app import media
from app.auth import hash_password
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


PLACEHOLDER_PHOTOS_PER_ROOM = 3


def _placeholder_png(room_name: str, color: str, variant: int) -> bytes:
    """A small gradient picture with the room's name on it.

    Generated rather than committed: the repository carries no binary assets,
    and the demo rooms still have something for the carousel to show (C16).
    """
    width, height = 960, 720
    base = tuple(int(color.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4))
    # Each variant fades towards a different tone so the photos are tellable apart.
    toward = [(255, 255, 255), (61, 122, 94), (40, 50, 70)][variant % 3]
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / (height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(b + (e - b) * t) for b, e in zip(base, toward, strict=True)),
        )
    # Pillow's built-in font has no accented glyphs ("Névoa" drew a box), and
    # white text vanishes into the light end of the gradient: plain ASCII on a
    # dark band reads on every variant.
    ascii_name = unicodedata.normalize("NFKD", room_name).encode("ascii", "ignore").decode()
    caption = f"{ascii_name} - {variant + 1}"
    font = ImageFont.load_default(size=52)
    left, top, right, bottom = draw.textbbox((0, 0), caption, font=font)
    text_w, text_h = right - left, bottom - top
    x, y = (width - text_w) / 2, (height - text_h) / 2
    draw.rounded_rectangle(
        (x - 36, y - 24, x + text_w + 36, y + text_h + 36), radius=18, fill=(30, 40, 50)
    )
    draw.text((x - left, y - top), caption, font=font, fill=(255, 255, 255))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


async def _seed_room_photos(room: Room) -> None:
    """Give a photo-less demo room its placeholders, through the upload pipeline."""
    storage = media.get_media_storage()
    photos: list[dict] = []
    for variant in range(PLACEHOLDER_PHOTOS_PER_ROOM):
        processed = media.process_image(_placeholder_png(room.name, room.color, variant))
        photo_id, key, thumb_key = media.new_photo_keys("rooms", room.id)
        await storage.save(key, processed.main)
        await storage.save(thumb_key, processed.thumb)
        photos.append(
            {
                "id": photo_id,
                "key": key,
                "thumb_key": thumb_key,
                "width": processed.width,
                "height": processed.height,
            }
        )
    room.photos = photos


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
        # Only a room with no photos at all: whatever an operator uploaded,
        # removed or reordered is theirs, and a re-seed must not touch it.
        if not room.photos:
            await _seed_room_photos(room)
            await session.flush()
            print(f"  Generated {len(room.photos)} placeholder photos for {room.name}")
        created_rooms.append(room)

    # ── Availability Rules (Mon-Sat 08:00-20:00) ──────────────────────────
    for room in created_rooms:
        result = await session.execute(
            select(AvailabilityRule).where(AvailabilityRule.room_id == room.id)
        )
        existing_rules = result.scalars().all()
        if not existing_rules:
            for day in range(6):  # 0=Monday to 5=Saturday
                rule = AvailabilityRule(
                    room_id=room.id,
                    day_of_week=day,
                    open_time=time(8, 0),
                    close_time=time(20, 0),
                )
                session.add(rule)
            await session.flush()
            print(f"Created availability rules for room: {room.name}")
        else:
            print(f"Availability rules already exist for room: {room.name}")

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
