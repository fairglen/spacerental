"""
Seed script for SpaceRental.

Usage:
    python -m app.seed

Creates demo org, admin user, space, rooms, availability rules, and packages
if they do not already exist.
"""

import asyncio
from datetime import time
from decimal import Decimal

from sqlalchemy import select, text

from app.database import async_session_factory, engine
from app.models.organization import Organization, OrganizationMember, MemberRole, OrgPlan
from app.models.user import User
from app.models.space import Space, Room, AvailabilityRule
from app.models.package import Package


async def seed() -> None:
    # Ensure uuid-ossp extension and tables exist
    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        from app.models import organization, user, space, booking, package  # noqa: F401
        from app.database import Base
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as session:
        # ── Organization ──────────────────────────────────────────────────────
        result = await session.execute(
            select(Organization).where(Organization.slug == "demo-space")
        )
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
        from app.auth import hash_password
        result = await session.execute(
            select(User).where(User.email == "admin@demo.com")
        )
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
                description="A peaceful coworking space in the heart of Lisbon.",
                address="Rua do Calmo, 42",
                city="Lisbon",
                images=[],
                amenities=["WiFi", "Coffee", "Printer", "Air Conditioning"],
            )
            session.add(space)
            await session.flush()
            print(f"Created space: {space.name} ({space.id})")
        else:
            print(f"Space already exists: {space.name} ({space.id})")

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
                    description=f"Comfortable private room — {room_data['name']}.",
                    capacity=6,
                    hourly_rate=room_data["hourly_rate"],
                    color=room_data["color"],
                    amenities=["WiFi", "Whiteboard", "TV Screen"],
                    images=[],
                )
                session.add(room)
                await session.flush()
                print(f"Created room: {room.name} ({room.id})")
            else:
                print(f"Room already exists: {room.name} ({room.id})")
            created_rooms.append(room)

        # ── Availability Rules (Mon-Sat 08:00–20:00) ──────────────────────────
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
                select(Package).where(
                    Package.org_id == org.id, Package.name == pkg_data["name"]
                )
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

        await session.commit()
        print("\nSeed complete.")


if __name__ == "__main__":
    asyncio.run(seed())
