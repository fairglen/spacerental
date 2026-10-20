"""Bootstrap a real deployment (E03): one organisation, its space, rooms,
packs and first admin.

    python -m app.bootstrap --name FlowSpace --slug flowspace --admin-email geral@flowspace.pt
    python -m app.bootstrap … --room "Sala Calma:12.00" --room "Sala Brisa:15.00" \
                              --pack "Pack 10 horas:10:108.00:3650"

Idempotent on the slug: when the organisation exists the command changes
nothing, says so and exits 0 — it never updates and never deletes. Unlike
`app.seed` (demo data, a published password, refused under
APP_ENV=production) it creates the admin without a password and prints the
"Defina a sua password" link (G04's set-password flow, valid 60 minutes);
with EMAIL_MODE=live the same link is also emailed. The defaults for the
rooms, the packs, the address and the hours are the facts the marketing
site publishes (flowspace-site/assets/data/business.json), so the two agree
on day one — tests/test_bootstrap.py pins them to that file.
"""

import argparse
import asyncio
import sys
from dataclasses import dataclass, field
from datetime import time
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock, email, password_reset
from app.config import settings
from app.database import async_session_factory
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.seed import require_migrated_schema

# ── Defaults: flowspace-site/assets/data/business.json ──────────────────────
# The site's address block (the seed's "R." abbreviation is the seed's own).
SITE_LOCATION = {
    "address": "Rua 12 de Julho de 1997 5, Loja 1",
    "postal_code": "2745-841",
    "city": "Queluz",
    "latitude": Decimal("38.755723"),
    "longitude": Decimal("-9.279799"),
}
SITE_DESCRIPTION = (
    "Gabinetes para profissionais de saúde e bem-estar, à hora, em Queluz — Massamã. "
    "Sem contratos nem caução: reserve online e pague só as horas que usa."
)
# The pilot location's clock (R01) and the site's hours: every day 08:00-22:00.
SITE_TIMEZONE = "Europe/Lisbon"
SITE_OPENS, SITE_CLOSES = time(8, 0), time(22, 0)


@dataclass(frozen=True)
class RoomSpec:
    name: str
    hourly_rate: Decimal
    capacity: int = 2
    amenities: tuple[str, ...] = ()


@dataclass(frozen=True)
class PackSpec:
    name: str
    hours: int
    price: Decimal
    validity_days: int


# business.json → rooms: name, price_per_hour, capacity, equipment.
# DECISION: the site leaves Sala Brisa's capacity unset; 2 (the professional
# and one client, as Sala Calma) until the owner sets it.
DEFAULT_ROOMS = (
    RoomSpec(
        "Sala Calma",
        Decimal("12.00"),
        2,
        ("Ar condicionado", "Isolamento acústico", "Wi-Fi", "2 cadeirões"),
    ),
    RoomSpec(
        "Sala Brisa",
        Decimal("15.00"),
        2,
        ("Ar condicionado", "Isolamento acústico", "Mesa de trabalho", "Wi-Fi"),
    ),
    RoomSpec(
        "Sala Névoa",
        Decimal("18.00"),
        6,
        ("Ar condicionado", "Luz natural", "4–6 lugares", "Wi-Fi"),  # noqa: RUF001 — the site's text
    ),
)
# business.json → packs[0]: "Pack 10 horas", 10 hours, 10 % off the hourly
# price, "Sem expiração". DECISION: the site gives no pack price and no
# expiry, the model needs both — the price is the pack's hours at the
# cheapest hourly price with the published discount (10 x 12,00 € x 0,9 =
# 108,00 €) and the validity 3650 days, the nearest the model has to "no
# expiry"; `--pack` overrides either.
PACK_DISCOUNT_PERCENT = 10
PACK_NO_EXPIRY_DAYS = 3650
DEFAULT_PACKS = (PackSpec("Pack 10 horas", 10, Decimal("108.00"), PACK_NO_EXPIRY_DAYS),)
# The seed's palette, in the seed's order.
ROOM_COLORS = ("#A8D5BA", "#B8D4E8", "#D4C5E2", "#F2D6A2", "#E8C4C4")
# The space itself lists what the site lists for every room.
SPACE_AMENITIES = ("Ar condicionado", "Wi-Fi")


def parse_room(raw: str) -> RoomSpec:
    """`name:hourly-rate` → RoomSpec, with the site's capacity and equipment
    when the name is one of the site's rooms."""
    name, sep, rate = raw.rpartition(":")
    if not sep or not name.strip():
        raise argparse.ArgumentTypeError(f"--room expects name:hourly-rate, got {raw!r}")
    try:
        hourly_rate = Decimal(rate.strip()).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise argparse.ArgumentTypeError(f"--room {raw!r}: {rate!r} is not an amount") from None
    if hourly_rate <= 0:
        raise argparse.ArgumentTypeError(f"--room {raw!r}: the hourly rate must be positive")
    known = next((r for r in DEFAULT_ROOMS if r.name == name.strip()), None)
    if known is not None:
        return RoomSpec(known.name, hourly_rate, known.capacity, known.amenities)
    return RoomSpec(name.strip(), hourly_rate)


def parse_pack(raw: str) -> PackSpec:
    """`name:hours:price:validity-days` → PackSpec."""
    parts = raw.rsplit(":", 3)
    if len(parts) != 4 or not parts[0].strip():
        raise argparse.ArgumentTypeError(
            f"--pack expects name:hours:price:validity-days, got {raw!r}"
        )
    name, hours, price, validity = parts
    try:
        spec = PackSpec(
            name.strip(),
            int(hours),
            Decimal(price.strip()).quantize(Decimal("0.01")),
            int(validity),
        )
    except (ValueError, InvalidOperation):
        raise argparse.ArgumentTypeError(
            f"--pack {raw!r}: hours and validity-days are integers, price an amount"
        ) from None
    if spec.hours <= 0 or spec.price <= 0 or spec.validity_days <= 0:
        raise argparse.ArgumentTypeError(f"--pack {raw!r}: every number must be positive")
    return spec


@dataclass
class BootstrapOptions:
    name: str
    slug: str
    admin_email: str
    admin_name: str | None = None
    space_name: str | None = None
    rooms: tuple[RoomSpec, ...] = DEFAULT_ROOMS
    packs: tuple[PackSpec, ...] = DEFAULT_PACKS


@dataclass
class BootstrapResult:
    created: bool
    org_id: object = None
    messages: list[str] = field(default_factory=list)
    # The set-password link for a freshly created admin; None when the
    # account already had a password (or nothing was created).
    admin_link: str | None = None
    admin_email: str | None = None


async def bootstrap(session: AsyncSession, options: BootstrapOptions) -> BootstrapResult:
    """Create everything for `options.slug`, or nothing. Does not commit."""
    existing = await session.scalar(select(Organization).where(Organization.slug == options.slug))
    if existing is not None:
        return BootstrapResult(
            created=False,
            org_id=existing.id,
            messages=[
                f"Organisation {options.slug!r} already exists ({existing.id}); nothing changed."
            ],
        )

    result = BootstrapResult(created=True)
    org = Organization(name=options.name, slug=options.slug, plan=OrgPlan.starter, settings={})
    session.add(org)
    await session.flush()
    result.org_id = org.id
    result.messages.append(f"Created organisation: {org.name} [{org.slug}] ({org.id})")

    space = Space(
        org_id=org.id,
        name=options.space_name or options.name,
        description=SITE_DESCRIPTION,
        images=[],
        amenities=list(SPACE_AMENITIES),
        timezone=SITE_TIMEZONE,
        **SITE_LOCATION,
    )
    session.add(space)
    await session.flush()
    result.messages.append(f"Created space: {space.name} ({space.id}), {SITE_TIMEZONE}")

    for index, spec in enumerate(options.rooms):
        room = Room(
            space_id=space.id,
            org_id=org.id,
            name=spec.name,
            capacity=spec.capacity,
            hourly_rate=spec.hourly_rate,
            color=ROOM_COLORS[index % len(ROOM_COLORS)],
            amenities=list(spec.amenities),
            images=[],
        )
        session.add(room)
        await session.flush()
        for day in range(7):
            session.add(
                AvailabilityRule(
                    room_id=room.id,
                    day_of_week=day,
                    open_time=SITE_OPENS,
                    close_time=SITE_CLOSES,
                )
            )
        result.messages.append(
            f"Created room: {room.name} ({room.id}) at {spec.hourly_rate} €/h, "
            f"open every day {SITE_OPENS:%H:%M}-{SITE_CLOSES:%H:%M}"
        )

    for spec in options.packs:
        pack = Package(
            org_id=org.id,
            name=spec.name,
            hours=spec.hours,
            price=spec.price,
            validity_days=spec.validity_days,
        )
        session.add(pack)
        await session.flush()
        result.messages.append(
            f"Created pack: {pack.name} ({pack.id}) — {pack.hours} h for {pack.price} €, "
            f"valid {pack.validity_days} days"
        )

    admin = await session.scalar(select(User).where(User.email == options.admin_email))
    if admin is None:
        admin = User(email=options.admin_email, name=options.admin_name, password_hash=None)
        session.add(admin)
        await session.flush()
        result.messages.append(f"Created admin: {admin.email} ({admin.id}), no password yet")
    else:
        result.messages.append(f"Admin already exists: {admin.email} ({admin.id})")
    session.add(OrganizationMember(org_id=org.id, user_id=admin.id, role=MemberRole.owner))
    await session.flush()
    result.messages.append(f"Made {admin.email} the owner of {org.slug}")

    result.admin_email = admin.email
    if admin.password_hash is None:
        raw = await password_reset.issue(session, admin, now=clock.utcnow())
        if raw is not None:
            result.admin_link = password_reset.reset_link(raw)
    return result


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.bootstrap", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument("--name", required=True, help="the organisation's name (FlowSpace)")
    parser.add_argument(
        "--slug", required=True, help="its slug — the CUSTOMER_ENROLLMENT_ORG_SLUG customers join"
    )
    parser.add_argument("--admin-email", required=True, help="the first admin's email")
    parser.add_argument("--admin-name", default=None, help="the first admin's display name")
    parser.add_argument("--space-name", default=None, help="the space's name (default: --name)")
    parser.add_argument(
        "--room",
        action="append",
        type=parse_room,
        metavar="NAME:RATE",
        help='a room, repeatable: --room "Sala Calma:12.00" (default: the site\'s three rooms)',
    )
    parser.add_argument(
        "--pack",
        action="append",
        type=parse_pack,
        metavar="NAME:HOURS:PRICE:DAYS",
        help='a pack, repeatable: --pack "Pack 10 horas:10:108.00:3650" (default: the site\'s)',
    )
    return parser


def options_from_args(argv: list[str] | None = None) -> BootstrapOptions:
    args = _parser().parse_args(argv)
    return BootstrapOptions(
        name=args.name,
        slug=args.slug.strip().lower(),
        admin_email=args.admin_email.strip().lower(),
        admin_name=args.admin_name,
        space_name=args.space_name,
        rooms=tuple(args.room) if args.room else DEFAULT_ROOMS,
        packs=tuple(args.pack) if args.pack else DEFAULT_PACKS,
    )


async def run(options: BootstrapOptions) -> int:
    await require_migrated_schema()
    async with async_session_factory() as session:
        result = await bootstrap(session, options)
        await session.commit()
    for line in result.messages:
        print(line)
    if not result.created:
        return 0
    if result.admin_link is None:
        print(f"\n{result.admin_email} already has a password: sign in at {settings.FRONTEND_URL}")
        return 0
    print(
        f"\nSet the admin's password with this link (valid 60 minutes):\n  {result.admin_link}\n"
        f"If it expires, 'Esqueci-me da password' on {settings.FRONTEND_URL}/sign-in issues a "
        "new one (EMAIL_MODE=stub prints it in the backend log, live mode emails it)."
    )
    if settings.EMAIL_MODE == email.LIVE_MODE:
        message = email.set_password_email(to=result.admin_email, link=result.admin_link)
        try:
            await email.get_email_gateway().send(message)
        except Exception as exc:  # noqa: BLE001 — the link above is already usable
            print(f"\nThe set-password email could not be sent: {exc}", file=sys.stderr)
            return 1
        print(f"The same link was emailed to {result.admin_email}.")
    return 0


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(run(options_from_args(argv)))


if __name__ == "__main__":
    sys.exit(main())
