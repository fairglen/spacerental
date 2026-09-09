import argparse

import pytest
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.promote_admin import PromoteAdminError, _run, promote_admin
from sqlalchemy import select


@pytest.fixture
async def demo_org(db_session) -> Organization:
    """A second org with the default slug `promote_admin` looks for.

    `test_org` (conftest.py) uses slug "test-org", so the default-slug path
    needs its own org with slug "demo-space" to exercise against.
    """
    org = Organization(
        name="Espaço Calmo",
        slug="demo-space",
        plan=OrgPlan.starter,
        settings={},
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


class TestPromoteAdminFunction:
    async def test_promotes_user_to_owner_in_default_org(self, db_session, demo_org, test_user):
        member = await promote_admin(test_user.email, session=db_session)
        await db_session.commit()

        assert member.org_id == demo_org.id
        assert member.user_id == test_user.id
        assert member.role == MemberRole.owner

        result = await db_session.execute(
            select(OrganizationMember).where(
                OrganizationMember.org_id == demo_org.id,
                OrganizationMember.user_id == test_user.id,
            )
        )
        row = result.scalar_one()
        assert row.role == MemberRole.owner

    async def test_promotes_with_explicit_role_and_org_slug(self, db_session, test_org, test_user):
        member = await promote_admin(
            test_user.email,
            role=MemberRole.admin,
            org_slug=test_org.slug,
            session=db_session,
        )

        assert member.org_id == test_org.id
        assert member.role == MemberRole.admin

    async def test_updates_role_of_an_existing_membership_instead_of_duplicating(
        self, db_session, demo_org, test_user
    ):
        existing = OrganizationMember(
            org_id=demo_org.id, user_id=test_user.id, role=MemberRole.member
        )
        db_session.add(existing)
        await db_session.commit()
        await db_session.refresh(existing)

        member = await promote_admin(test_user.email, role=MemberRole.owner, session=db_session)

        assert member.id == existing.id
        assert member.role == MemberRole.owner

        result = await db_session.execute(
            select(OrganizationMember).where(OrganizationMember.org_id == demo_org.id)
        )
        assert len(result.scalars().all()) == 1

    async def test_unknown_email_raises_clear_error_no_silent_no_op(self, db_session, demo_org):
        with pytest.raises(PromoteAdminError, match="ghost@nowhere.com"):
            await promote_admin("ghost@nowhere.com", session=db_session)

        # And nothing was written.
        result = await db_session.execute(select(OrganizationMember))
        assert result.scalars().all() == []

    async def test_unknown_org_slug_raises_clear_error(self, db_session, test_user):
        with pytest.raises(PromoteAdminError, match="not-a-real-org"):
            await promote_admin(test_user.email, org_slug="not-a-real-org", session=db_session)


class TestPromoteAdminCli:
    """Exercises the thin argparse/exit-code wrapper without touching the DB.

    The core lookup/promotion logic is covered against a real DB above; here
    we only need to prove the CLI translates a PromoteAdminError into a
    non-zero exit with a clear stderr message, and success into exit 0.

    We `await _run(...)` directly rather than calling `main()` (which wraps
    it in `asyncio.run()`). Calling `asyncio.run()` from inside a test would
    reset the process-wide event loop on exit and break every test file that
    runs afterward under pytest-asyncio -- see `app/promote_admin.py::_run`.
    """

    async def test_run_exits_nonzero_and_prints_error_on_unknown_email(self, monkeypatch, capsys):
        async def fake_promote_admin(email, *, role, org_slug):
            raise PromoteAdminError(f"No user found with email {email!r}.")

        monkeypatch.setattr("app.promote_admin.promote_admin", fake_promote_admin)

        args = argparse.Namespace(email="ghost@nowhere.com", role="owner", org_slug="demo-space")
        exit_code = await _run(args)

        assert exit_code == 1
        captured = capsys.readouterr()
        assert "ghost@nowhere.com" in captured.err

    async def test_run_exits_zero_on_success(self, monkeypatch):
        async def fake_promote_admin(email, *, role, org_slug):
            assert role == MemberRole.admin
            assert org_slug == "demo-space"
            return None

        monkeypatch.setattr("app.promote_admin.promote_admin", fake_promote_admin)

        args = argparse.Namespace(email="someone@example.com", role="admin", org_slug="demo-space")
        exit_code = await _run(args)

        assert exit_code == 0
