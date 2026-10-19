"""T10 — the stub Checkout page a human can actually walk in a browser.

`StubPaymentGateway.create_checkout_session` now points `checkout_url` at
`GET /checkout/stub/{session_id}` (this app, no /api/v1 prefix) instead of an
unreachable `checkout.stripe.stub` hostname. These tests exercise that page
and its "Pay"/"Cancel" actions through the same `client` fixture used for
every other route — no network, no Stripe credentials (CLAUDE.md §10.3).
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
from app.main import app
from app.payments import PaymentGateway, get_payment_gateway
from app.routers.checkout_stub import negotiate_language

ENGLISH = {"Accept-Language": "en-GB,en;q=0.9,pt;q=0.8"}
PORTUGUESE = {"Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5"}


def _future_slot(duration_hours: int = 2):
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(today + timedelta(days=days_ahead + 7), time(10, 0), tzinfo=UTC)
    return start.isoformat(), (start + timedelta(hours=duration_hours)).isoformat()


async def _create_pending_booking(client, auth_headers, room) -> dict:
    start, end = _future_slot()
    resp = await client.post(
        "/api/v1/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start,
            "end_time": end,
            "payment_method": "hourly",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _booking_status(client, auth_headers, booking_id: str) -> str:
    resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
    assert resp.status_code == 200
    return next(b["status"] for b in resp.json()["bookings"] if b["id"] == booking_id)


def _session_id_from_checkout_url(checkout_url: str) -> str:
    return checkout_url.rsplit("/", 1)[-1]


class _NotAStubGateway(PaymentGateway):
    """Stands in for `StripeGateway` without needing real Stripe credentials.

    Only `isinstance(gateway, StubPaymentGateway)` matters to the routes
    under test here, so a bare non-stub PaymentGateway is enough to prove
    live mode never serves this page.
    """

    async def create_checkout_session(self, **kwargs):
        raise NotImplementedError

    async def get_checkout_url(self, session_id: str) -> str | None:
        raise NotImplementedError

    async def expire_checkout_session(self, session_id: str) -> None:
        raise NotImplementedError

    def _verify_signature(self, payload: bytes, signature_header: str) -> None:
        raise NotImplementedError


class TestShowCheckoutPage:
    async def test_renders_amount_and_description(
        self, client, auth_headers, test_room, test_member, payments
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.get(f"/checkout/stub/{session_id}")
        assert resp.status_code == 200, resp.text
        assert "text/html" in resp.headers["content-type"]
        assert "22,00" in resp.text  # 11.00/h * 2h, formatted pt-style
        assert "Sala A" in resp.text

    async def test_unknown_session_id_is_404(self, client, payments):
        resp = await client.get("/checkout/stub/cs_stub_never_seen")
        assert resp.status_code == 404

    # B65: the page follows Accept-Language. English when that is the best
    # match, otherwise the Portuguese page exactly as it was before.
    async def test_english_accept_language_renders_the_english_page(
        self, client, auth_headers, test_room, test_member, payments
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.get(f"/checkout/stub/{session_id}", headers=ENGLISH)
        assert resp.status_code == 200, resp.text
        assert '<html lang="en">' in resp.text
        assert "<title>Complete payment (test mode) — " in resp.text
        assert '<button type="submit" class="pay">Pay</button>' in resp.text
        assert '<button type="submit" class="cancel">Cancel</button>' in resp.text
        assert "Room booking" in resp.text
        assert "Pagar" not in resp.text
        # The actions and the amount do not move with the language.
        assert f'action="{session_id}/pay"' in resp.text
        assert "22,00 €" in resp.text
        # The gzip layer may append Accept-Encoding to the same header.
        assert "accept-language" in resp.headers["vary"].lower()

    async def test_portuguese_accept_language_renders_the_portuguese_page(
        self, client, auth_headers, test_room, test_member, payments
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.get(f"/checkout/stub/{session_id}", headers=PORTUGUESE)
        assert resp.status_code == 200, resp.text
        assert '<html lang="pt">' in resp.text
        assert "<title>Finalizar pagamento (modo teste) — " in resp.text
        assert '<button type="submit" class="pay">Pagar</button>' in resp.text
        assert '<button type="submit" class="cancel">Cancelar</button>' in resp.text
        assert "Reserva de sala" in resp.text
        assert "accept-language" in resp.headers["vary"].lower()
        # Byte-identical to the page a client with no preference gets.
        no_preference = await client.get(f"/checkout/stub/{session_id}")
        assert resp.text == no_preference.text

    async def test_no_accept_language_renders_the_portuguese_page(
        self, client, auth_headers, test_room, test_member, payments
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.get(f"/checkout/stub/{session_id}")
        assert "accept-language" not in resp.request.headers  # httpx sends none by default
        assert resp.status_code == 200, resp.text
        assert '<html lang="pt">' in resp.text
        assert "<title>Finalizar pagamento (modo teste) — " in resp.text
        assert '<button type="submit" class="pay">Pagar</button>' in resp.text
        assert "accept-language" in resp.headers["vary"].lower()

    async def test_live_mode_gateway_404s_instead_of_leaking_the_page(
        self, client, auth_headers, test_room, test_member, payments
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        fake_live = _NotAStubGateway(currency="eur", success_url="", cancel_url="")
        app.dependency_overrides[get_payment_gateway] = lambda: fake_live
        try:
            resp = await client.get(f"/checkout/stub/{session_id}")
        finally:
            app.dependency_overrides.pop(get_payment_gateway, None)
        assert resp.status_code == 404


class TestNegotiateLanguage:
    """Unit coverage of the Accept-Language parser (B65): pure, no I/O."""

    @pytest.mark.parametrize(
        ("header", "expected"),
        [
            # No header, or nothing in it, is Portuguese.
            (None, "pt"),
            ("", "pt"),
            ("   ", "pt"),
            # Exact and regional tags.
            ("en", "en"),
            ("en-GB", "en"),
            ("EN-us", "en"),
            ("pt-BR", "pt"),
            # The task's two canonical headers.
            ("en-GB,en;q=0.9,pt;q=0.8", "en"),
            ("pt-PT,pt;q=0.9,en;q=0.5", "pt"),
            # The weight ranks, not the header order.
            ("pt;q=0.5,en", "en"),
            ("en;q=0.4,pt;q=0.6", "pt"),
            # The first *supported* language wins, past any we lack.
            ("fr,en;q=0.3,pt;q=0.2", "en"),
            ("de-DE,de;q=0.9,pt;q=0.1,en;q=0.8", "en"),
            # Only unsupported languages, or the wildcard, fall back.
            ("fr,de;q=0.9", "pt"),
            ("*", "pt"),
            ("fr,*;q=0.5", "pt"),
            # q=0 opts a language out.
            ("en;q=0,pt;q=0.1", "pt"),
            ("en;q=0", "pt"),
            ("en;q=0,pt;q=0", "pt"),
            # Whitespace around separators is tolerated.
            ("en ; q = 0.7 , pt ; q = 0.6", "en"),
            # A malformed q drops that range and nothing else.
            ("en;q=abc,pt;q=0.1", "pt"),
            ("xx;q=abc,en;q=0.1", "en"),
            ("en;q=1.5,pt;q=0.1", "pt"),
            ("en;q=nan,pt;q=0.1", "pt"),
            ("en;q=0.1234,pt;q=0.1", "pt"),
            ("en;q=", "pt"),
            # Unknown parameters are ignored, q still read.
            ("en;foo=bar;q=0.2,pt;q=0.1", "en"),
            # Garbage never raises.
            (";;;", "pt"),
            (",,,", "pt"),
            ("q=0.5", "pt"),
            ("=", "pt"),
            ("en_GB", "pt"),
        ],
    )
    def test_picks_the_best_supported_language(self, header, expected):
        assert negotiate_language(header) == expected


class TestPayCheckout:
    async def test_pay_confirms_booking_sends_email_and_redirects(
        self, client, auth_headers, test_room, test_member, payments, emails, locks
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        booking = body["booking"]
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert resp.status_code == 303, resp.text
        assert resp.headers["location"] == "http://test/success"

        assert await _booking_status(client, auth_headers, booking["id"]) == "confirmed"
        # Same email hook a real webhook delivery fires — Epic 4 / PR #16 —
        # not bypassed by this route.
        assert len(emails.sent) == 1
        assert emails.sent[0].to == "user@test.com"
        assert locks.issued_code_for(uuid.UUID(booking["id"])) is not None

    async def test_paying_twice_is_idempotent(
        self, client, auth_headers, test_room, test_member, payments, emails
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        booking = body["booking"]
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        first = await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        second = await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert first.status_code == 303
        assert second.status_code == 303
        assert await _booking_status(client, auth_headers, booking["id"]) == "confirmed"
        assert len(emails.sent) == 1

    async def test_unknown_session_id_is_404(self, client, payments):
        resp = await client.post("/checkout/stub/cs_stub_never_seen/pay", follow_redirects=False)
        assert resp.status_code == 404


class TestCancelCheckout:
    async def test_cancel_redirects_without_confirming(
        self, client, auth_headers, test_room, test_member, payments, emails
    ):
        body = await _create_pending_booking(client, auth_headers, test_room)
        booking = body["booking"]
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        resp = await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        assert resp.status_code == 303, resp.text
        assert resp.headers["location"] == "http://test/cancel"
        # C03: backing out of checkout releases the hold at once (the hold is
        # fast-forwarded to expired); before this the row stayed pending and
        # blocked the slot until an admin cleared it.
        assert await _booking_status(client, auth_headers, booking["id"]) == "expired"
        assert emails.sent == []

    async def test_unknown_session_id_is_404(self, client, payments):
        resp = await client.post("/checkout/stub/cs_stub_never_seen/cancel", follow_redirects=False)
        assert resp.status_code == 404


class TestPackagePurchaseCheckout:
    """Same page, driven from the package-purchase leg (PR #18)."""

    async def test_pay_activates_purchase(
        self, client, auth_headers, test_org, test_member, db_session, payments, emails
    ):
        from app.models.package import Package

        pkg = Package(
            org_id=test_org.id,
            name="Starter Pack",
            hours=10,
            price=Decimal("99.00"),
            validity_days=180,
        )
        db_session.add(pkg)
        await db_session.commit()
        await db_session.refresh(pkg)

        bought = await client.post(
            f"/api/v1/packages/{pkg.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert bought.status_code == 201, bought.text
        body = bought.json()
        purchase = body["purchase"]
        session_id = _session_id_from_checkout_url(body["checkout_url"])

        page = await client.get(f"/checkout/stub/{session_id}")
        assert page.status_code == 200
        assert "99,00" in page.text

        resp = await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert resp.status_code == 303
        assert resp.headers["location"] == "http://test/success"

        mine = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert (
            next(p for p in mine.json()["purchases"] if p["id"] == purchase["id"])["status"]
            == "active"
        )
