"""C17 — help / report a problem: the request is stored and a person is emailed.

The endpoint is public and writes to the database and an inbox, so these tests
care about what it refuses, what it never echoes, and who can ever see a row.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.config import settings
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.support import SupportCategory, SupportRequest, SupportStatus
from sqlalchemy import func, select

URL = "/api/v1/support/requests"
MESSAGE = "Não consigo concluir a reserva: o botão de pagamento não responde."
CONTEXT = {
    "page_url": "http://localhost:3000/spaces",
    "viewport": "390x844",
    "user_agent": "Mozilla/5.0 (test)",
    "app_version": "abc1234",
    "timestamp": "2026-09-22T10:00:00Z",
}


def _body(**overrides) -> dict:
    return {
        "category": "technical",
        "message": MESSAGE,
        "contact_email": "visitante@example.com",
        "context": CONTEXT,
        **overrides,
    }


async def _count(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(SupportRequest))


async def _booking(db_session, org, room, user) -> Booking:
    start = datetime.now(tz=UTC) + timedelta(days=5)
    booking = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_hours=1,
        total_amount=11,
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.hourly,
    )
    db_session.add(booking)
    await db_session.commit()
    await db_session.refresh(booking)
    return booking


class TestSignedOutVisitor:
    async def test_the_request_is_stored_and_answered_with_a_reference(
        self, client, emails, db_session
    ):
        resp = await client.post(URL, json=_body())
        assert resp.status_code == 201, resp.text
        request = resp.json()["request"]
        assert set(request) == {"id", "reference", "status", "created_at"}
        assert request["status"] == "new"
        assert request["reference"] == uuid.UUID(request["id"]).hex[:8].upper()

        row = (await db_session.execute(select(SupportRequest))).scalar_one()
        assert row.category is SupportCategory.technical
        assert row.status is SupportStatus.new
        assert row.message == MESSAGE
        assert row.contact_email == "visitante@example.com"
        assert (row.user_id, row.booking_id) == (None, None)
        assert row.context["page_url"] == CONTEXT["page_url"]
        assert "user_id" not in row.context

    async def test_a_person_is_emailed_and_can_just_hit_reply(self, client, emails):
        resp = await client.post(URL, json=_body(category="payment"))
        reference = resp.json()["request"]["reference"]
        [message] = emails.sent
        assert message.to == settings.SUPPORT_EMAIL == "geral@flowspace.pt"
        assert message.reply_to == "visitante@example.com"
        assert message.subject == f"[Ajuda] Pagamento — #{reference}"
        assert MESSAGE in message.text_body
        assert "http://localhost:3000/spaces" in message.text_body

    async def test_the_message_is_never_echoed_back_and_is_escaped_in_the_email(
        self, client, emails
    ):
        hostile = "<img src=x onerror=alert(1)> " + "a" * 20
        resp = await client.post(URL, json=_body(message=hostile))
        assert resp.status_code == 201, resp.text
        assert "onerror" not in resp.text
        [message] = emails.sent
        assert "<img" not in message.html_body
        assert "&lt;img src=x onerror=alert(1)&gt;" in message.html_body

    async def test_an_email_address_is_required_when_signed_out(self, client, emails, db_session):
        body = _body()
        del body["contact_email"]
        assert (await client.post(URL, json=body)).status_code == 422
        assert (await client.post(URL, json=_body(contact_email="nope"))).status_code == 422
        assert await _count(db_session) == 0 and emails.sent == []

    @pytest.mark.parametrize(
        "overrides",
        [
            {"message": "curto"},
            {"message": "x" * 2001},
            {"message": "a" * 25 + chr(0)},
            {"category": "refund"},
            {"context": {"page_url": "x" * 5000}},
        ],
    )
    async def test_bounds(self, client, emails, db_session, overrides):
        resp = await client.post(URL, json=_body(**overrides))
        assert resp.status_code == 422, resp.text
        assert await _count(db_session) == 0 and emails.sent == []

    async def test_a_visitor_cannot_attach_a_booking(
        self, client, emails, db_session, test_org, test_room, test_user
    ):
        booking = await _booking(db_session, test_org, test_room, test_user)
        resp = await client.post(URL, json=_body(booking_id=str(booking.id)))
        assert resp.status_code == 201, resp.text
        row = (await db_session.execute(select(SupportRequest))).scalar_one()
        assert row.booking_id is None

    async def test_unknown_context_keys_are_dropped_not_stored(self, client, emails, db_session):
        resp = await client.post(URL, json=_body(context={**CONTEXT, "cookies": "session=secret"}))
        assert resp.status_code == 201, resp.text
        row = (await db_session.execute(select(SupportRequest))).scalar_one()
        assert "cookies" not in row.context


class TestSignedInCustomer:
    async def test_identity_comes_from_the_session_not_the_body(
        self, client, emails, db_session, auth_headers, test_user, test_member, test_org
    ):
        resp = await client.post(
            URL, json=_body(contact_email="someone-else@example.com"), headers=auth_headers
        )
        assert resp.status_code == 201, resp.text
        row = (await db_session.execute(select(SupportRequest))).scalar_one()
        assert row.user_id == test_user.id
        assert row.contact_email == test_user.email
        assert row.org_id == test_org.id
        assert emails.sent[0].reply_to == test_user.email

    async def test_their_own_booking_can_be_attached_and_sets_the_org(
        self, client, emails, db_session, auth_headers, test_user, test_org, test_room
    ):
        booking = await _booking(db_session, test_org, test_room, test_user)
        resp = await client.post(
            URL, json=_body(category="booking", booking_id=str(booking.id)), headers=auth_headers
        )
        assert resp.status_code == 201, resp.text
        row = (await db_session.execute(select(SupportRequest))).scalar_one()
        assert (row.booking_id, row.org_id) == (booking.id, test_org.id)
        assert str(booking.id) in emails.sent[0].text_body

    async def test_someone_elses_booking_is_refused_like_one_that_does_not_exist(
        self, client, emails, db_session, auth_headers, test_org, test_room, admin_user
    ):
        theirs = await _booking(db_session, test_org, test_room, admin_user)
        foreign = await client.post(
            URL, json=_body(booking_id=str(theirs.id)), headers=auth_headers
        )
        missing = await client.post(
            URL, json=_body(booking_id=str(uuid.uuid4())), headers=auth_headers
        )
        assert foreign.status_code == missing.status_code == 404
        assert foreign.json() == missing.json()
        assert await _count(db_session) == 0 and emails.sent == []

    async def test_a_bad_token_is_401_not_a_silent_anonymous_request(
        self, client, emails, db_session
    ):
        resp = await client.post(URL, json=_body(), headers={"Authorization": "Bearer nonsense"})
        assert resp.status_code == 401, resp.text
        assert await _count(db_session) == 0


class TestAbuse:
    async def test_the_honeypot_looks_like_success_and_does_nothing(
        self, client, emails, db_session
    ):
        resp = await client.post(URL, json=_body(website="http://spam.example"))
        assert resp.status_code == 201, resp.text
        assert set(resp.json()["request"]) == {"id", "reference", "status", "created_at"}
        assert await _count(db_session) == 0
        assert emails.sent == []

    async def test_it_is_throttled_tightly(self, client, emails, db_session, monkeypatch):
        assert settings.RATE_LIMIT_SUPPORT_MAX_REQUESTS == 5
        assert settings.RATE_LIMIT_SUPPORT_WINDOW_SECONDS == 3600
        codes = [(await client.post(URL, json=_body())).status_code for _ in range(7)]
        assert codes == [201] * 5 + [429] * 2
        assert await _count(db_session) == 5

    async def test_a_mail_failure_does_not_lose_the_request(
        self, client, emails, db_session, monkeypatch
    ):
        from app.email import EmailProviderError

        async def boom(_message):
            raise EmailProviderError("provider down")

        monkeypatch.setattr(emails, "send", boom)
        resp = await client.post(URL, json=_body())
        assert resp.status_code == 201, resp.text
        assert await _count(db_session) == 1
