"""D20: the browser-facing URLs the API builds point at the frontend origin.

One variable drives them — FRONTEND_URL (localhost, a LAN IP, an ngrok
domain) — because the browser reaches this API through the frontend's
`/backend` proxy: photos at `<FRONTEND_URL>/backend/media/...`, the stub
Checkout page at `<FRONTEND_URL>/backend/checkout/stub/...`. An explicit
MEDIA_BASE_URL or STRIPE_STUB_CHECKOUT_BASE_URL still wins."""

import re

from app.config import PROXY_PREFIX, Settings, settings
from app.media import public_url
from app.payments import StubPaymentGateway, get_payment_gateway

API = "/api/v1"


class TestDerivation:
    def test_defaults_derive_from_frontend_url(self):
        s = Settings(FRONTEND_URL="https://stable.ngrok-free.dev")
        assert s.MEDIA_BASE_URL == "https://stable.ngrok-free.dev/backend/media"
        assert s.STRIPE_STUB_CHECKOUT_BASE_URL == "https://stable.ngrok-free.dev/backend"
        assert s.STRIPE_SUCCESS_URL == "https://stable.ngrok-free.dev/dashboard?pagamento=sucesso"
        assert s.STRIPE_CANCEL_URL == "https://stable.ngrok-free.dev/dashboard?pagamento=cancelado"

    def test_a_trailing_slash_and_an_empty_value_are_handled(self):
        s = Settings(FRONTEND_URL="http://192.168.1.42:3000/", MEDIA_BASE_URL="  ")
        assert s.MEDIA_BASE_URL == "http://192.168.1.42:3000/backend/media"
        assert s.STRIPE_STUB_CHECKOUT_BASE_URL == "http://192.168.1.42:3000/backend"

    def test_explicit_values_win(self):
        s = Settings(
            FRONTEND_URL="http://localhost:3000",
            MEDIA_BASE_URL="https://cdn.example/photos",
            STRIPE_STUB_CHECKOUT_BASE_URL="http://localhost:8000",
            STRIPE_SUCCESS_URL="https://app.example/paid",
        )
        assert s.MEDIA_BASE_URL == "https://cdn.example/photos"
        assert s.STRIPE_STUB_CHECKOUT_BASE_URL == "http://localhost:8000"
        assert s.STRIPE_SUCCESS_URL == "https://app.example/paid"
        assert s.STRIPE_CANCEL_URL == "http://localhost:3000/dashboard?pagamento=cancelado"

    def test_the_suite_runs_on_the_derived_defaults(self):
        assert f"{settings.FRONTEND_URL}{PROXY_PREFIX}/media" == settings.MEDIA_BASE_URL
        assert f"{settings.FRONTEND_URL}{PROXY_PREFIX}" == settings.STRIPE_STUB_CHECKOUT_BASE_URL
        assert public_url("rooms/x/y.webp").startswith(
            f"{settings.FRONTEND_URL}{PROXY_PREFIX}/media/"
        )


class TestInResponses:
    async def test_a_photo_url_points_at_the_frontend_origin(
        self, client, admin_headers, test_room, test_org
    ):
        from tests.test_media import _image_bytes, _upload

        resp = await _upload(
            client,
            f"{API}/admin/rooms/{test_room.id}/images",
            admin_headers,
            test_org,
            _image_bytes(),
        )
        assert resp.status_code == 201, resp.text
        photo = resp.json()["room"]["photos"][0]
        for key in ("url", "thumb_url"):
            assert photo[key].startswith(f"{settings.FRONTEND_URL}{PROXY_PREFIX}/media/rooms/"), (
                photo[key]
            )

    def test_the_configured_stub_gateway_links_through_the_proxy(self):
        gateway = get_payment_gateway()
        assert isinstance(gateway, StubPaymentGateway)
        assert gateway._checkout_base_url == f"{settings.FRONTEND_URL}{PROXY_PREFIX}"
        assert gateway.success_url == f"{settings.FRONTEND_URL}/dashboard?pagamento=sucesso"
        assert gateway.cancel_url == f"{settings.FRONTEND_URL}/dashboard?pagamento=cancelado"

    async def test_the_stub_page_posts_relative_to_itself(
        self, client, auth_headers, test_room, test_member, payments
    ):
        """Reached at /backend/checkout/stub/<id> through the proxy or at
        /checkout/stub/<id> directly, the forms must resolve under either."""
        from tests.test_checkout_stub import _create_pending_booking, _session_id_from_checkout_url

        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = _session_id_from_checkout_url(body["checkout_url"])
        page = (await client.get(f"/checkout/stub/{session_id}")).text
        actions = re.findall(r'action="([^"]+)"', page)
        assert actions == [f"{session_id}/pay", f"{session_id}/cancel"]
