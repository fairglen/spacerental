"""G03: password reset — customer self-service, the admin trigger, and the
suspended account (`disabled_at`) and session revocation (`token_version`)
that both lean on.
"""

import hashlib
import re
from datetime import UTC, datetime, timedelta

from app import clock
from app.auth import create_access_token, verify_password
from app.config import settings
from app.models.audit import AdminAction
from app.models.password_reset import PasswordResetToken
from app.models.user import User
from app.routers import test_hooks
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

API = "/api/v1"
REQUEST = f"{API}/auth/password-reset/request"
CONFIRM = f"{API}/auth/password-reset/confirm"
NEUTRAL = "Se existir uma conta com este email, vai receber uma ligação para repor a password."


def _link(message) -> str:
    match = re.search(r"https?://\S+/reset-password/\S+", message.text_body)
    assert match, message.text_body
    return match.group(0)


def _token(link: str) -> str:
    return link.rsplit("/", 1)[1]


async def _fresh(db_session, user_id) -> User:
    return (
        await db_session.execute(
            select(User).where(User.id == user_id).execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _tokens(db_session, user_id) -> list[PasswordResetToken]:
    result = await db_session.execute(
        select(PasswordResetToken)
        .where(PasswordResetToken.user_id == user_id)
        .order_by(PasswordResetToken.created_at)
    )
    return list(result.scalars().all())


class TestRequest:
    async def test_a_known_enabled_user_gets_one_email_with_a_working_link(
        self, client, emails, db_session, test_user
    ):
        resp = await client.post(REQUEST, json={"email": test_user.email})
        assert resp.status_code == 202, resp.text
        assert resp.json() == {"detail": NEUTRAL}
        assert len(emails.sent) == 1
        message = emails.sent[0]
        assert message.to == test_user.email
        link = _link(message)
        assert link.startswith(f"{settings.FRONTEND_URL}/reset-password/")
        # Only the hash is stored; the raw token lives in the email alone.
        rows = await _tokens(db_session, test_user.id)
        assert len(rows) == 1
        assert rows[0].token_hash == hashlib.sha256(_token(link).encode()).hexdigest()
        assert rows[0].used_at is None
        assert rows[0].created_by_admin_id is None
        assert rows[0].expires_at - rows[0].created_at == timedelta(minutes=60)

    async def test_an_unknown_email_gets_the_same_answer_and_no_email(self, client, emails):
        resp = await client.post(REQUEST, json={"email": "nobody@test.com"})
        assert resp.status_code == 202
        assert resp.json() == {"detail": NEUTRAL}
        assert emails.sent == []

    async def test_a_disabled_user_gets_the_same_answer_and_no_email(
        self, client, emails, db_session, test_user
    ):
        test_user.disabled_at = datetime.now(tz=UTC)
        await db_session.commit()
        resp = await client.post(REQUEST, json={"email": test_user.email})
        assert resp.status_code == 202
        assert resp.json() == {"detail": NEUTRAL}
        assert emails.sent == []
        assert await _tokens(db_session, test_user.id) == []

    async def test_the_email_is_matched_case_insensitively(self, client, emails, test_user):
        resp = await client.post(REQUEST, json={"email": test_user.email.upper()})
        assert resp.status_code == 202
        assert len(emails.sent) == 1

    async def test_a_new_request_invalidates_the_older_unused_token(
        self, client, emails, db_session, test_user
    ):
        await client.post(REQUEST, json={"email": test_user.email})
        first = _token(_link(emails.sent[0]))
        await client.post(REQUEST, json={"email": test_user.email})
        second = _token(_link(emails.sent[1]))
        assert first != second
        rows = await _tokens(db_session, test_user.id)
        assert len(rows) == 1
        old = await client.post(CONFIRM, json={"token": first, "password": "novapass123"})
        assert old.status_code == 400
        fresh = await client.post(CONFIRM, json={"token": second, "password": "novapass123"})
        assert fresh.status_code == 200, fresh.text

    async def test_the_request_endpoint_is_in_the_auth_rate_limit_tier(self, client):
        for _ in range(settings.RATE_LIMIT_AUTH_MAX_REQUESTS):
            resp = await client.post(REQUEST, json={"email": "nobody@test.com"})
            assert resp.status_code == 202
        blocked = await client.post(REQUEST, json={"email": "nobody@test.com"})
        assert blocked.status_code == 429
        blocked = await client.post(CONFIRM, json={"token": "x", "password": "novapass123"})
        assert blocked.status_code == 429


class TestConfirm:
    async def _issue(self, client, emails, user) -> str:
        await client.post(REQUEST, json={"email": user.email})
        return _token(_link(emails.sent[-1]))

    async def test_confirm_sets_the_password_and_the_token_is_single_use(
        self, client, emails, db_session, test_user
    ):
        token = await self._issue(client, emails, test_user)
        resp = await client.post(CONFIRM, json={"token": token, "password": "novapass123"})
        assert resp.status_code == 200, resp.text
        user = await _fresh(db_session, test_user.id)
        assert verify_password("novapass123", user.password_hash)
        assert not verify_password("password123", user.password_hash)
        rows = await _tokens(db_session, test_user.id)
        assert rows[0].used_at is not None
        again = await client.post(CONFIRM, json={"token": token, "password": "outrapass123"})
        assert again.status_code == 400
        user = await _fresh(db_session, test_user.id)
        assert verify_password("novapass123", user.password_hash)
        login = await client.post(
            f"{API}/auth/login", json={"email": test_user.email, "password": "novapass123"}
        )
        assert login.status_code == 200, login.text

    async def test_an_expired_token_is_refused(
        self, client, emails, db_session, test_user, monkeypatch
    ):
        token = await self._issue(client, emails, test_user)
        later = datetime.now(tz=UTC) + timedelta(minutes=61)
        monkeypatch.setattr(clock, "utcnow", lambda: later)
        resp = await client.post(CONFIRM, json={"token": token, "password": "novapass123"})
        assert resp.status_code == 400
        assert resp.json()["detail"] == "A ligação é inválida ou já expirou."
        user = await _fresh(db_session, test_user.id)
        assert verify_password("password123", user.password_hash)

    async def test_a_made_up_token_and_a_short_password_are_refused(self, client, test_user):
        resp = await client.post(CONFIRM, json={"token": "not-a-token", "password": "novapass123"})
        assert resp.status_code == 400
        resp = await client.post(CONFIRM, json={"token": "not-a-token", "password": "short"})
        assert resp.status_code == 422

    async def test_confirm_revokes_the_sessions_issued_before_it(
        self, client, emails, db_session, test_user, auth_headers
    ):
        before = await client.get(f"{API}/auth/me", headers=auth_headers)
        assert before.status_code == 200
        token = await self._issue(client, emails, test_user)
        resp = await client.post(CONFIRM, json={"token": token, "password": "novapass123"})
        assert resp.status_code == 200
        user = await _fresh(db_session, test_user.id)
        assert user.token_version == 1
        after = await client.get(f"{API}/auth/me", headers=auth_headers)
        assert after.status_code == 401
        # A fresh login carries the new version and works.
        login = await client.post(
            f"{API}/auth/login", json={"email": test_user.email, "password": "novapass123"}
        )
        fresh = {"Authorization": f"Bearer {login.json()['access_token']}"}
        assert (await client.get(f"{API}/auth/me", headers=fresh)).status_code == 200


class TestDisabledAccount:
    async def test_a_disabled_user_cannot_sign_in_and_hears_why(
        self, client, db_session, test_user
    ):
        test_user.disabled_at = datetime.now(tz=UTC)
        await db_session.commit()
        resp = await client.post(
            f"{API}/auth/login", json={"email": test_user.email, "password": "password123"}
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "A conta está desativada."

    async def test_a_disabled_users_token_is_refused_everywhere(
        self, client, db_session, test_user, auth_headers, test_member, test_room
    ):
        assert (await client.get(f"{API}/auth/me", headers=auth_headers)).status_code == 200
        test_user.disabled_at = datetime.now(tz=UTC)
        await db_session.commit()
        me = await client.get(f"{API}/auth/me", headers=auth_headers)
        assert me.status_code == 401
        assert me.json()["detail"] == "Account disabled"
        book = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": "2030-01-07T10:00:00Z",
                "end_time": "2030-01-07T11:00:00Z",
            },
            headers=auth_headers,
        )
        assert book.status_code == 401

    async def test_a_token_from_an_older_version_is_refused(self, client, db_session, test_user):
        stale = create_access_token({"sub": str(test_user.id), "tv": 0})
        assert (
            await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {stale}"})
        ).status_code == 200
        test_user.token_version = 3
        await db_session.commit()
        assert (
            await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {stale}"})
        ).status_code == 401
        current = create_access_token({"sub": str(test_user.id), "tv": 3})
        assert (
            await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {current}"})
        ).status_code == 200


class TestAdminTrigger:
    async def test_the_admin_can_send_the_same_link_and_it_is_audited_without_the_token(
        self, client, emails, db_session, admin_headers, test_org, test_user, test_member
    ):
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/password-reset",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 202, resp.text
        assert resp.json()["sent_to"] == test_user.email
        assert len(emails.sent) == 1
        link = _link(emails.sent[0])
        rows = await _tokens(db_session, test_user.id)
        assert rows[0].created_by_admin_id is not None
        confirm = await client.post(
            CONFIRM, json={"token": _token(link), "password": "novapass123"}
        )
        assert confirm.status_code == 200
        action = (
            await db_session.execute(select(AdminAction).where(AdminAction.entity_type == "user"))
        ).scalar_one()
        assert action.action == "password_reset.send"
        assert action.entity_id == test_user.id
        blob = f"{action.before} {action.after} {action.reason}".lower()
        assert _token(link).lower() not in blob
        assert "token" not in blob and "hash" not in blob

    async def test_the_admin_cannot_send_a_link_to_a_disabled_user(
        self, client, emails, db_session, admin_headers, test_org, test_user, test_member
    ):
        test_user.disabled_at = datetime.now(tz=UTC)
        await db_session.commit()
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/password-reset",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 409
        assert emails.sent == []

    async def test_set_password_bumps_the_version_kills_open_tokens_and_hides_the_value(
        self,
        client,
        emails,
        db_session,
        admin_headers,
        test_org,
        test_user,
        test_member,
        auth_headers,
    ):
        await client.post(REQUEST, json={"email": test_user.email})
        open_token = _token(_link(emails.sent[0]))
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/set-password",
            params={"org_id": str(test_org.id)},
            json={"password": "definida123"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert "definida123" not in resp.text
        user = await _fresh(db_session, test_user.id)
        assert verify_password("definida123", user.password_hash)
        assert user.token_version == 1
        assert (await client.get(f"{API}/auth/me", headers=auth_headers)).status_code == 401
        stale = await client.post(CONFIRM, json={"token": open_token, "password": "novapass123"})
        assert stale.status_code == 400
        action = (
            await db_session.execute(
                select(AdminAction).where(AdminAction.action == "password.set")
            )
        ).scalar_one()
        blob = f"{action.before} {action.after} {action.reason}".lower()
        assert "definida123" not in blob
        assert "password" not in blob and "hash" not in blob

    async def test_set_password_is_validated_and_rate_limited(
        self, client, admin_headers, test_org, test_user, test_member
    ):
        short = await client.post(
            f"{API}/admin/users/{test_user.id}/set-password",
            params={"org_id": str(test_org.id)},
            json={"password": "short"},
            headers=admin_headers,
        )
        assert short.status_code == 422
        for _ in range(settings.RATE_LIMIT_AUTH_MAX_REQUESTS - 1):
            resp = await client.post(
                f"{API}/admin/users/{test_user.id}/set-password",
                params={"org_id": str(test_org.id)},
                json={"password": "definida123"},
                headers=admin_headers,
            )
            assert resp.status_code == 200
        blocked = await client.post(
            f"{API}/admin/users/{test_user.id}/set-password",
            params={"org_id": str(test_org.id)},
            json={"password": "definida123"},
            headers=admin_headers,
        )
        assert blocked.status_code == 429


class TestEmailHook:
    async def test_the_hook_lists_the_last_emails_with_their_links(self, client, emails, test_user):
        await client.post(REQUEST, json={"email": test_user.email})
        resp = await client.get("/__test__/emails")
        assert resp.status_code == 200, resp.text
        listed = resp.json()["emails"]
        assert len(listed) == 1
        assert listed[0]["to"] == test_user.email
        assert listed[0]["subject"]
        assert listed[0]["links"] == [_link(emails.sent[0])]

    def test_the_hook_is_mounted_only_for_a_stub_outside_production(self):
        assert test_hooks.should_mount(email_mode="stub", app_env="development") is True
        assert test_hooks.should_mount(email_mode="stub", app_env="test") is True
        assert test_hooks.should_mount(email_mode="stub", app_env="production") is False
        assert test_hooks.should_mount(email_mode="live", app_env="development") is False
        assert test_hooks.should_mount(email_mode="live", app_env="production") is False

    async def test_an_app_built_for_production_has_no_hook(self):
        production = FastAPI()
        test_hooks.mount(production, email_mode="stub", app_env="production")
        async with AsyncClient(
            transport=ASGITransport(app=production), base_url="http://test"
        ) as c:
            assert (await c.get("/__test__/emails")).status_code == 404
        development = FastAPI()
        test_hooks.mount(development, email_mode="stub", app_env="development")
        assert any(getattr(r, "path", "") == "/__test__/emails" for r in development.routes)
