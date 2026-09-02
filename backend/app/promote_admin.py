"""
Promote an existing user to admin/owner of an organization.

Usage:
    python -m app.promote_admin <email> [--role owner|admin] [--org-slug demo-space]

Fixes TODO.md T11: previously the only documented path was hand-written SQL in
README.md, which silently does nothing if the email doesn't match a row and
gives no feedback either way. This script fails loudly on an unknown email or
org slug, and always prints what it did.

Given the single-main-space scoping decision (TODO.md, "Scoping decision"),
the default org is the seeded demo org (slug "demo-space") rather than asking
the caller to look up an org_id.
"""

import argparse
import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.models.organization import Organization, OrganizationMember, MemberRole
from app.models.user import User

DEFAULT_ORG_SLUG = "demo-space"


class PromoteAdminError(Exception):
    """Raised when promotion can't proceed — unknown user or org.

    No silent no-op: every failure raises this with a message clear enough
    to act on, unlike the raw-SQL approach it replaces.
    """


async def promote_admin(
    email: str,
    *,
    role: MemberRole = MemberRole.owner,
    org_slug: str = DEFAULT_ORG_SLUG,
    session: AsyncSession | None = None,
) -> OrganizationMember:
    """Add or update `email`'s membership in the org identified by `org_slug`.

    If `session` is given, the caller owns the transaction (used by tests to
    run this against a fixture-managed DB). Otherwise a session is opened and
    committed here, matching how `app/seed.py` manages its own session.

    Returns the resulting OrganizationMember row.
    """
    if session is not None:
        return await _promote_admin(session, email=email, role=role, org_slug=org_slug)

    async with async_session_factory() as owned_session:
        member = await _promote_admin(
            owned_session, email=email, role=role, org_slug=org_slug
        )
        await owned_session.commit()
        await owned_session.refresh(member)
        return member


async def _promote_admin(
    session: AsyncSession, *, email: str, role: MemberRole, org_slug: str
) -> OrganizationMember:
    user_result = await session.execute(select(User).where(User.email == email))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise PromoteAdminError(f"No user found with email {email!r}.")

    org_result = await session.execute(
        select(Organization).where(Organization.slug == org_slug)
    )
    org = org_result.scalar_one_or_none()
    if org is None:
        raise PromoteAdminError(f"No organization found with slug {org_slug!r}.")

    member_result = await session.execute(
        select(OrganizationMember).where(
            OrganizationMember.org_id == org.id,
            OrganizationMember.user_id == user.id,
        )
    )
    member = member_result.scalar_one_or_none()

    if member is None:
        member = OrganizationMember(org_id=org.id, user_id=user.id, role=role)
        session.add(member)
        await session.flush()
        print(f"Success: added {email} to {org.name!r} as {role.value}.")
    else:
        previous_role = member.role
        member.role = role
        await session.flush()
        if previous_role == role:
            print(f"{email} is already {role.value} of {org.name!r} — no change.")
        else:
            print(
                f"Success: updated {email}'s role in {org.name!r} "
                f"from {previous_role.value} to {role.value}."
            )

    return member


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Promote an existing user to admin/owner of an organization."
    )
    parser.add_argument(
        "email", help="Email of the user to promote (must already be registered)."
    )
    parser.add_argument(
        "--role",
        choices=[MemberRole.owner.value, MemberRole.admin.value],
        default=MemberRole.owner.value,
        help="Role to assign (default: owner, matching the README's previous SQL).",
    )
    parser.add_argument(
        "--org-slug",
        default=DEFAULT_ORG_SLUG,
        help=f"Slug of the org to add the user to (default: {DEFAULT_ORG_SLUG}, the seeded org).",
    )
    return parser


async def _run(args: argparse.Namespace) -> int:
    """The async body behind `main()`, split out so tests can `await` it directly.

    Calling `asyncio.run()` from inside a test resets the process-wide event
    loop on exit, which breaks pytest-asyncio's loop handling for every test
    file that runs afterward. Keeping the awaitable part separate lets tests
    drive it from their own already-running loop instead.
    """
    try:
        await promote_admin(args.email, role=MemberRole(args.role), org_slug=args.org_slug)
    except PromoteAdminError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
