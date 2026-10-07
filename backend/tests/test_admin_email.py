"""B61: the operator can see which email gateway runs and whether a send
works — `GET /admin/email/status` and `POST /admin/email/test` — without
anyone being able to use the API as a relay or read the provider key."""

import httpx
import pytest
from app import email
from app.config import settings
from app.email import EmailProviderError, ResendEmailGateway, get_email_gateway
from app.main import app
from app.models.audit import AdminAction
from app.models.organization import Organization, OrgPlan
from app.ratelimit import limiter
from sqlalchemy import select

API = "/api/v1"
STATUS_URL = f"{API}/admin/email/status"
TEST_URL = f"{API}/admin/email/test"


@pytest.fixture(autouse=True)
def _clean_state():
    email.recent_failures.clear()
    limiter.reset()
    yield
    email.recent_failures.clear()
    limiter.reset()


class TestStatus:
    async def test_an_admin_sees_the_mode_the_sender_and_no_failures(
        self, client, admin_headers, test_org
    ):
        resp = await client.get(
            STATUS_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()["email"]
        assert body["mode"] == "stub"
        assert body["from_address"] == settings.EMAIL_FROM_ADDRESS
        assert body["support_inbox"] == settings.SUPPORT_INBOX_EMAIL
        assert body["test_hooks_enabled"] is True
        assert body["recent_failures"] == []
        assert set(body) == {
            "mode",
            "from_address",
            "support_inbox",
            "test_hooks_enabled",
            "recent_failures",
        }

    async def test_a_member_is_refused(self, client, auth_headers, test_member, test_org):
        resp = await client.get(
            STATUS_URL, params={"org_id": str(test_org.id)}, headers=auth_headers
        )
        assert resp.status_code == 403

    async def test_another_organisations_admin_is_refused(self, client, admin_headers, db_session):
        other = Organization(name="Outra", slug="outra-email", plan=OrgPlan.starter, settings={})
        db_session.add(other)
        await db_session.commit()
        resp = await client.get(STATUS_URL, params={"org_id": str(other.id)}, headers=admin_headers)
        assert resp.status_code == 403

    async def test_the_api_key_is_never_in_the_body(
        self, client, admin_headers, test_org, monkeypatch
    ):
        monkeypatch.setattr(settings, "EMAIL_MODE", "live")
        monkeypatch.setattr(settings, "RESEND_API_KEY", "re_live_secret_value_123")
        resp = await client.get(
            STATUS_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        assert "re_live_secret_value_123" not in resp.text
        body = resp.json()["email"]
        assert body["mode"] == "live"
        assert body["test_hooks_enabled"] is False  # the hook only exists in stub mode

    async def test_failures_recorded_by_the_background_delivery_are_listed_newest_first(
        self, client, admin_headers, test_org
    ):
        class Refusing(email.EmailGateway):
            async def send(self, message):
                raise EmailProviderError(
                    "Client error '403 Forbidden' for url 'https://api.resend.com/emails' "
                    "Bearer re_abc_secret"
                )

        for n in (1, 2):
            await email._deliver(Refusing(), email.test_email(to=f"op{n}@example.com"))
        resp = await client.get(
            STATUS_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        failures = resp.json()["email"]["recent_failures"]
        assert [f["to"] for f in failures] == ["op2@example.com", "op1@example.com"]
        assert failures[0]["subject"] == "Email de teste — FlowSpace"
        assert "403 Forbidden" in failures[0]["error"]
        assert "re_abc_secret" not in resp.text
        assert "[redacted]" in failures[0]["error"]
        assert failures[0]["at"].endswith("Z") or "+00:00" in failures[0]["at"]

    def test_the_buffer_keeps_the_last_twenty(self):
        for n in range(25):
            email.record_failure(email.test_email(to=f"x{n}@example.com"), RuntimeError("boom"))
        assert len(email.recent_failures) == 20
        assert email.recent_failures[0].to == "x5@example.com"
        assert email.recent_failures[-1].to == "x24@example.com"


class TestSend:
    async def test_the_stub_delivers_to_the_admins_own_address(
        self, client, admin_headers, admin_user, test_org, emails
    ):
        resp = await client.post(
            TEST_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"delivered": True, "to": admin_user.email}
        assert len(emails.sent) == 1
        message = emails.sent[0]
        assert message.to == admin_user.email
        assert message.subject == "Email de teste — FlowSpace"
        assert "painel de administração" in message.text_body
        assert "modo de teste" in message.text_body
        assert "você" not in message.text_body.lower()
        assert len(email.recent_failures) == 0

    async def test_there_is_no_recipient_parameter(
        self, client, admin_headers, admin_user, test_org, emails
    ):
        resp = await client.post(
            TEST_URL,
            params={"org_id": str(test_org.id), "to": "victim@example.com"},
            headers=admin_headers,
            json={"to": "victim@example.com"},
        )
        assert resp.status_code == 200, resp.text
        assert [m.to for m in emails.sent] == [admin_user.email]

    async def test_a_member_is_refused_and_nothing_is_sent(
        self, client, auth_headers, test_member, test_org, emails
    ):
        resp = await client.post(
            TEST_URL, params={"org_id": str(test_org.id)}, headers=auth_headers
        )
        assert resp.status_code == 403
        assert emails.sent == []

    async def test_a_provider_refusal_answers_502_sanitised_and_is_recorded(
        self, client, admin_headers, admin_user, test_org, monkeypatch, db_session
    ):
        # Only Resend's endpoint is faked; the test client's own posts (the same
        # httpx.AsyncClient class) keep going to the app.
        original_post = httpx.AsyncClient.post

        async def refused(self, url, **kwargs):
            if str(url) != email.RESEND_API_URL:
                return await original_post(self, url, **kwargs)
            request = httpx.Request("POST", url)
            return httpx.Response(403, json={"message": "Domain not verified"}, request=request)

        monkeypatch.setattr(httpx.AsyncClient, "post", refused)
        gateway = ResendEmailGateway(
            api_key="re_test_secret_key", from_address="FlowSpace <no-reply@flowspace.pt>"
        )
        app.dependency_overrides[get_email_gateway] = lambda: gateway
        try:
            resp = await client.post(
                TEST_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
            )
        finally:
            app.dependency_overrides.pop(get_email_gateway, None)
        assert resp.status_code == 502, resp.text
        detail = resp.json()["detail"]
        assert detail.startswith("O fornecedor de email recusou o envio: ")
        assert "403" in detail
        assert "re_test_secret_key" not in resp.text
        assert len(email.recent_failures) == 1
        assert email.recent_failures[0].to == admin_user.email
        # The refusal is in the history too, as a failed `email.test`.
        rows = (
            (
                await db_session.execute(
                    select(AdminAction).where(
                        AdminAction.org_id == test_org.id, AdminAction.action == "email.test"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].after["delivered"] is False
        assert "403" in rows[0].after["error"]
        assert "re_test_secret_key" not in str(rows[0].after)

    async def test_it_is_throttled_like_the_help_form(
        self, client, admin_headers, test_org, emails
    ):
        assert settings.RATE_LIMIT_SUPPORT_MAX_REQUESTS == 5
        assert settings.RATE_LIMIT_SUPPORT_WINDOW_SECONDS == 3600
        codes = [
            (
                await client.post(
                    TEST_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
                )
            ).status_code
            for _ in range(7)
        ]
        assert codes == [200] * 5 + [429] * 2
        assert len(emails.sent) == 5


class TestStartupLine:
    def test_describes_the_stub_and_the_live_mode_without_the_key(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "stub")
        line = email.describe_mode()
        assert line.startswith("Email mode=stub from=")
        assert "/__test__/emails" in line
        monkeypatch.setattr(settings, "EMAIL_MODE", "live")
        monkeypatch.setattr(settings, "RESEND_API_KEY", "re_key_never_logged")
        line = email.describe_mode()
        assert line.startswith("Email mode=live from=")
        assert "re_key_never_logged" not in line
