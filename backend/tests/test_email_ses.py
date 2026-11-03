"""E20 — email through Amazon SES: `app.email.SesEmailGateway` against moto's
in-process SES (no account, no network), the configuration that selects it,
and the admin card on top of it.

What is proved: the message shape SES receives (sender, recipient, reply-to,
both bodies, UTF-8), a verified domain sends, an unverified one is refused
as `EmailProviderError` with SES's own words (what the operator's card
shows), `ses` mode refuses to start without a region, and the test-email
route answers 502 sanitised when SES refuses. Domain verification, the DNS
records and the sandbox exit are Terraform's and the owner's
(infra/prod/email.tf, runbook Phase 4.1) and are not simulated.
"""

import boto3
import pytest
from app import email
from app.config import settings
from app.email import (
    EmailMessage,
    EmailNotConfiguredError,
    EmailProviderError,
    SesEmailGateway,
    get_email_gateway,
    validate_email_settings,
)
from app.main import app
from moto import mock_aws

REGION = "eu-west-1"
FROM = "FlowSpace <no-reply@flowspace.pt>"
TEST_URL = "/api/v1/admin/email/test"
STATUS_URL = "/api/v1/admin/email/status"


@pytest.fixture
def ses(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    with mock_aws():
        yield boto3.client("sesv2", region_name=REGION)


class _RecordingClient:
    """A stand-in client that keeps the parameters `send_email` got."""

    def __init__(self) -> None:
        self.calls: list[dict] = []

    def send_email(self, **params):
        self.calls.append(params)
        return {"MessageId": "recorded"}


def _message(**overrides) -> EmailMessage:
    base = {
        "to": "cliente@example.com",
        "subject": "Reserva confirmada — Sala Calma",
        "html_body": "<p>Olá</p>",
        "text_body": "Olá",
    }
    return EmailMessage(**{**base, **overrides})


class TestSesEmailGateway:
    async def test_the_message_shape_ses_receives(self):
        client = _RecordingClient()
        gateway = SesEmailGateway(from_address=FROM, region=REGION, client=client)
        await gateway.send(_message(reply_to="cliente@example.com"))
        [params] = client.calls
        assert params["FromEmailAddress"] == FROM
        assert params["Destination"] == {"ToAddresses": ["cliente@example.com"]}
        assert params["ReplyToAddresses"] == ["cliente@example.com"]
        simple = params["Content"]["Simple"]
        assert simple["Subject"] == {"Data": "Reserva confirmada — Sala Calma", "Charset": "UTF-8"}
        assert simple["Body"]["Text"] == {"Data": "Olá", "Charset": "UTF-8"}
        assert simple["Body"]["Html"] == {"Data": "<p>Olá</p>", "Charset": "UTF-8"}

    async def test_no_reply_to_means_no_reply_to_header(self):
        client = _RecordingClient()
        await SesEmailGateway(FROM, REGION, client=client).send(_message())
        assert "ReplyToAddresses" not in client.calls[0]

    async def test_a_verified_domain_sends(self, ses):
        ses.create_email_identity(EmailIdentity="flowspace.pt")
        await SesEmailGateway(from_address=FROM, region=REGION).send(_message())

    async def test_an_unverified_sender_is_a_provider_error_in_ses_words(self, ses):
        with pytest.raises(EmailProviderError) as refused:
            await SesEmailGateway(from_address=FROM, region=REGION).send(_message())
        assert str(refused.value).startswith("MessageRejected: ")
        assert "not verified" in str(refused.value)


class TestConfiguration:
    def test_ses_mode_needs_a_region_and_no_key(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        monkeypatch.setattr(settings, "RESEND_API_KEY", None)
        monkeypatch.setattr(settings, "AWS_REGION", REGION)
        validate_email_settings()

    def test_ses_mode_without_a_region_stops_the_app(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        monkeypatch.setattr(settings, "AWS_REGION", None)
        with pytest.raises(EmailNotConfiguredError, match="AWS_REGION"):
            validate_email_settings()

    def test_ses_mode_builds_the_ses_gateway(self, monkeypatch, ses):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        monkeypatch.setattr(settings, "AWS_REGION", REGION)
        email._build_gateway.cache_clear()
        try:
            assert isinstance(get_email_gateway(), SesEmailGateway)
        finally:
            email._build_gateway.cache_clear()

    def test_the_startup_line_names_ses_and_the_region(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        monkeypatch.setattr(settings, "AWS_REGION", REGION)
        line = email.describe_mode()
        assert line.startswith("Email mode=ses from=")
        assert "Amazon SES" in line and REGION in line

    def test_the_test_email_says_it_went_through_the_provider(self, monkeypatch):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        message = email.test_email(to="op@example.com")
        assert "modo de teste" not in message.text_body
        assert "fornecedor de email configurado" in message.text_body


class TestAdminCardOnSes:
    async def test_the_status_reports_ses_and_no_hook(
        self, client, admin_headers, test_org, monkeypatch
    ):
        monkeypatch.setattr(settings, "EMAIL_MODE", "ses")
        monkeypatch.setattr(settings, "AWS_REGION", REGION)
        resp = await client.get(
            STATUS_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()["email"]
        assert body["mode"] == "ses"
        assert body["test_hooks_enabled"] is False

    async def test_a_refusal_answers_502_in_ses_words_and_is_recorded(
        self, client, admin_headers, admin_user, test_org, ses
    ):
        gateway = SesEmailGateway(from_address=FROM, region=REGION)  # domain not verified
        app.dependency_overrides[get_email_gateway] = lambda: gateway
        try:
            resp = await client.post(
                TEST_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
            )
        finally:
            app.dependency_overrides.pop(get_email_gateway, None)
        assert resp.status_code == 502, resp.text
        detail = resp.json()["detail"]
        assert detail.startswith("O fornecedor de email recusou o envio: MessageRejected")
        assert email.recent_failures[-1].to == admin_user.email

    async def test_a_verified_domain_delivers_through_the_route(
        self, client, admin_headers, admin_user, test_org, ses
    ):
        ses.create_email_identity(EmailIdentity="flowspace.pt")
        gateway = SesEmailGateway(from_address=FROM, region=REGION)
        app.dependency_overrides[get_email_gateway] = lambda: gateway
        try:
            resp = await client.post(
                TEST_URL, params={"org_id": str(test_org.id)}, headers=admin_headers
            )
        finally:
            app.dependency_overrides.pop(get_email_gateway, None)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"delivered": True, "to": admin_user.email}
