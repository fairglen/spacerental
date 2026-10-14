"""B67 (closing B37): one mailbox, one account — the normalised address is
the identity at registration, login, forgot-password and the admin's user
creation; the migration refuses a collision."""

import importlib.util
from pathlib import Path

import pytest
from app.auth import hash_password
from app.config import settings
from app.emails import normalize_email
from app.models.user import User
from sqlalchemy import text

API = "/api/v1"
STRONG = "uma frase comprida e so minha"
VERSIONS = Path(__file__).parent.parent / "alembic" / "versions"
MIGRATION = VERSIONS / "0019_users_email_normalized.py"
TYPED = ("Ana+x@Example.pt", "An.a@gmail.com", "plain@example.pt")


@pytest.fixture(autouse=True)
def enrollment_target(test_org, monkeypatch):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", True)


class TestNormalizeEmail:
    @pytest.mark.parametrize(
        ("typed", "normalized"),
        [
            ("Ana@Example.PT", "ana@example.pt"),
            ("  ana@example.pt ", "ana@example.pt"),
            ("ana+flowspace@example.pt", "ana@example.pt"),
            ("ana+a+b@example.pt", "ana@example.pt"),
            ("An.a@gmail.com", "ana@gmail.com"),
            ("a.n.a+tag@GoogleMail.com", "ana@googlemail.com"),
            # Dots stay on every other domain: they are part of the address.
            ("an.a@example.pt", "an.a@example.pt"),
        ],
    )
    def test_folds_case_tags_and_gmail_dots(self, typed, normalized):
        assert normalize_email(typed) == normalized

    def test_the_model_keeps_the_column_in_step(self):
        user = User(email="Ana+x@Example.pt", name="Ana")
        assert user.email == "Ana+x@Example.pt"
        assert user.email_normalized == "ana@example.pt"
        user.email = "an.a@gmail.com"
        assert user.email_normalized == "ana@gmail.com"


async def _register(client, email: str, password: str = STRONG):
    return await client.post(
        f"{API}/auth/register", json={"email": email, "password": password, "name": "C"}
    )


@pytest.mark.asyncio
class TestRegister:
    async def test_a_tag_then_the_bare_address_is_the_same_account(self, client, test_org):
        assert (await _register(client, "a+test@x.pt")).status_code == 201
        second = await _register(client, "A@x.pt")
        assert second.status_code == 400
        assert second.json()["detail"] == "Este email já está registado."

    async def test_gmail_dots_are_the_same_account(self, client, test_org):
        assert (await _register(client, "an.a@gmail.com")).status_code == 201
        second = await _register(client, "ana@gmail.com")
        assert second.status_code == 400
        assert second.json()["detail"] == "Este email já está registado."

    async def test_the_typed_address_is_kept(self, client, test_org, db_session):
        # The local part as typed (what we send to); the domain is lowercased
        # by the schema's EmailStr, which it always was.
        resp = await _register(client, "Ana+Reservas@Example.pt")
        assert resp.status_code == 201
        assert resp.json()["user"]["email"] == "Ana+Reservas@example.pt"


@pytest.mark.asyncio
class TestLogin:
    async def test_any_case_signs_in(self, client, test_org):
        assert (await _register(client, "cliente@example.pt")).status_code == 201
        for typed in ("CLIENTE@EXAMPLE.PT", "Cliente@example.pt", "cliente+x@example.pt"):
            resp = await client.post(f"{API}/auth/login", json={"email": typed, "password": STRONG})
            assert resp.status_code == 200, typed

    async def test_a_pre_existing_mixed_case_account_still_signs_in(self, client, db_session):
        # An account from before B67, stored as typed: the column the
        # validator fills is what the backfill would have produced.
        user = User(email="Ana.Silva@Example.pt", name="Ana", password_hash=hash_password(STRONG))
        db_session.add(user)
        await db_session.commit()
        for typed in ("Ana.Silva@Example.pt", "ana.silva@example.pt"):
            resp = await client.post(f"{API}/auth/login", json={"email": typed, "password": STRONG})
            assert resp.status_code == 200, typed

    async def test_forgot_password_finds_the_account_by_any_spelling(
        self, client, test_org, emails
    ):
        assert (await _register(client, "cliente@example.pt")).status_code == 201
        resp = await client.post(
            f"{API}/auth/password-reset/request", json={"email": "CLIENTE+tag@example.pt"}
        )
        assert resp.status_code == 202
        assert len(emails.sent) == 1
        # Sent to the address as typed at registration, never the folded one.
        assert emails.sent[0].to == "cliente@example.pt"


@pytest.mark.asyncio
class TestAdminCreate:
    async def test_the_admin_cannot_create_a_second_account_for_one_mailbox(
        self, client, test_org, admin_headers
    ):
        assert (await _register(client, "cliente@example.pt")).status_code == 201
        resp = await client.post(
            f"{API}/admin/users",
            params={"org_id": str(test_org.id)},
            json={"email": "Cliente+novo@example.pt", "name": "Cliente"},
            headers=admin_headers,
        )
        assert resp.status_code == 409


@pytest.mark.asyncio
class TestMigration0019:
    def _module(self):
        spec = importlib.util.spec_from_file_location("migration_0019", MIGRATION)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    async def test_the_backfill_matches_the_python_rule(self, db_session):
        module = self._module()
        for typed in TYPED:
            db_session.add(User(email=typed, name="x"))
        await db_session.commit()
        # Scramble the column, then let the migration's SQL fill it.
        await db_session.execute(text("UPDATE users SET email_normalized = email"))
        connection = await db_session.connection()
        await connection.run_sync(module.backfill_and_check)
        rows = (await db_session.execute(text("SELECT email, email_normalized FROM users"))).all()
        assert dict(rows) == {typed: normalize_email(typed) for typed in TYPED}
        await db_session.rollback()

    async def test_a_collision_fails_loudly_naming_both_addresses(self, db_session):
        module = self._module()
        # Two rows that only pre-B67 data could hold. The migration creates
        # the unique index after this check; the test schema already has it,
        # so it goes for the length of this (rolled-back) transaction.
        await db_session.execute(text("DROP INDEX ix_users_email_normalized"))
        await db_session.execute(
            text(
                "INSERT INTO users (email, email_normalized) VALUES "
                "('Ana@x.pt', 'one@x.pt'), ('ana+tag@x.pt', 'two@x.pt')"
            )
        )
        connection = await db_session.connection()
        with pytest.raises(RuntimeError) as excinfo:
            await connection.run_sync(module.backfill_and_check)
        assert "ana@x.pt: Ana@x.pt, ana+tag@x.pt" in str(excinfo.value)
        await db_session.rollback()
