"""B66: the password policy — length and blocklists, no composition rules —
and the four routes that apply it, each answering 422 with every reason."""

import pytest
from app import clock, password_reset, passwords
from app.config import settings
from app.models.organization import MemberRole, OrganizationMember
from app.models.user import User

API = "/api/v1"
STRONG = "uma frase comprida e so minha"


@pytest.fixture(autouse=True)
def enrollment_target(test_org, monkeypatch):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", True)


class TestCheckPassword:
    def test_a_long_phrase_passes(self):
        assert passwords.check_password(STRONG, "ana.silva@example.pt") == []

    def test_length_bounds(self):
        assert passwords.check_password("x" * 9, "a@b.pt") == [passwords.LENGTH_MESSAGE]
        assert passwords.check_password("x" * 129, "a@b.pt") == [passwords.LENGTH_MESSAGE]
        assert passwords.check_password("x" * 10, "a@b.pt") == []
        assert passwords.check_password("x" * 128, "a@b.pt") == []

    def test_the_breached_list_is_case_insensitive_and_has_20_000_entries(self):
        assert len(passwords.common_passwords()) == 20_000
        assert passwords.check_password("Password123", "a@b.pt") == [passwords.COMMON_MESSAGE]
        assert passwords.check_password("qwertyuiop", "a@b.pt") == [passwords.COMMON_MESSAGE]

    def test_the_local_part_of_the_email_is_refused_once_it_is_four_characters(self):
        assert passwords.check_password("Ana.Silva-2026!", "ana.silva@example.pt") == [
            passwords.EMAIL_MESSAGE
        ]
        assert passwords.check_password("ANA.SILVA e mais", "Ana.Silva@example.pt") == [
            passwords.EMAIL_MESSAGE
        ]
        assert passwords.check_password("abc is fine here", "abc@example.pt") == []

    def test_the_product_name_is_refused(self):
        assert passwords.check_password("FlowSpace-Lisboa-2026", "a@b.pt") == [
            passwords.PRODUCT_MESSAGE
        ]

    def test_every_reason_is_reported_at_once(self):
        assert passwords.check_password("flowspace", "flowspace@x.pt") == [
            passwords.LENGTH_MESSAGE,
            passwords.EMAIL_MESSAGE,
            passwords.PRODUCT_MESSAGE,
        ]


@pytest.mark.asyncio
class TestRegister:
    async def _register(self, client, password, email="cliente@example.com"):
        return await client.post(
            f"{API}/auth/register", json={"email": email, "password": password, "name": "C"}
        )

    async def test_a_common_password_is_422_with_the_reason(self, client, test_org):
        resp = await self._register(client, "password123")
        assert resp.status_code == 422
        assert resp.json()["detail"] == [passwords.COMMON_MESSAGE]

    async def test_too_short_is_422(self, client, test_org):
        resp = await self._register(client, "curta1234")
        assert resp.status_code == 422
        assert resp.json()["detail"] == [passwords.LENGTH_MESSAGE]

    async def test_the_email_local_part_is_422(self, client, test_org):
        resp = await self._register(client, "cliente-2026-x", email="cliente@example.com")
        assert resp.status_code == 422
        assert resp.json()["detail"] == [passwords.EMAIL_MESSAGE]

    async def test_several_reasons_come_together(self, client, test_org):
        resp = await self._register(client, "flowspace", email="flowspace@example.com")
        assert resp.status_code == 422
        assert resp.json()["detail"] == [
            passwords.LENGTH_MESSAGE,
            passwords.EMAIL_MESSAGE,
            passwords.PRODUCT_MESSAGE,
        ]

    async def test_a_strong_password_registers(self, client, test_org):
        resp = await self._register(client, STRONG)
        assert resp.status_code == 201


@pytest.mark.asyncio
class TestPasswordResetConfirm:
    async def test_a_weak_password_is_422_and_the_link_survives(
        self, client, db_session, test_user
    ):
        raw = await password_reset.issue(db_session, test_user, now=clock.utcnow())
        await db_session.commit()
        weak = await client.post(
            f"{API}/auth/password-reset/confirm", json={"token": raw, "password": "password123"}
        )
        assert weak.status_code == 422
        assert weak.json()["detail"] == [passwords.COMMON_MESSAGE]
        # The token was not consumed by the refusal: the same link takes a good one.
        strong = await client.post(
            f"{API}/auth/password-reset/confirm", json={"token": raw, "password": STRONG}
        )
        assert strong.status_code == 200


@pytest.mark.asyncio
class TestAdminRoutes:
    async def _member(self, db_session, test_org, email: str) -> User:
        user = User(email=email, name="Membro")
        db_session.add(user)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=user.id, role=MemberRole.member)
        )
        await db_session.commit()
        await db_session.refresh(user)
        return user

    async def test_set_password_refuses_a_weak_one(
        self, client, db_session, test_org, admin_headers
    ):
        member = await self._member(db_session, test_org, "membro@example.com")
        resp = await client.post(
            f"{API}/admin/users/{member.id}/set-password",
            params={"org_id": str(test_org.id)},
            json={"password": "membro-2026-xyz"},
            headers=admin_headers,
        )
        assert resp.status_code == 422
        assert resp.json()["detail"] == [passwords.EMAIL_MESSAGE]
        ok = await client.post(
            f"{API}/admin/users/{member.id}/set-password",
            params={"org_id": str(test_org.id)},
            json={"password": STRONG},
            headers=admin_headers,
        )
        assert ok.status_code == 200

    async def test_create_user_refuses_a_weak_password_and_accepts_the_link_mode(
        self, client, test_org, admin_headers
    ):
        weak = await client.post(
            f"{API}/admin/users",
            params={"org_id": str(test_org.id)},
            json={"email": "novo@example.com", "name": "Novo", "password": "password123"},
            headers=admin_headers,
        )
        assert weak.status_code == 422
        assert weak.json()["detail"] == [passwords.COMMON_MESSAGE]
        link = await client.post(
            f"{API}/admin/users",
            params={"org_id": str(test_org.id)},
            json={"email": "novo@example.com", "name": "Novo"},
            headers=admin_headers,
        )
        assert link.status_code == 201
