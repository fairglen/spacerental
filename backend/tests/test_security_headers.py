"""Q52: the static security headers are on every response the API gives."""

import pytest
from app.security_headers import SECURITY_HEADERS

API = "/api/v1"


def _assert_headers(response) -> None:
    for name, value in SECURITY_HEADERS.items():
        assert response.headers.get(name) == value, (name, response.headers)


class TestEveryResponseCarriesTheHeaders:
    async def test_health(self, client):
        resp = await client.get("/health")
        assert resp.status_code == 200
        _assert_headers(resp)

    async def test_a_public_json_route(self, client, test_space):
        resp = await client.get(f"{API}/spaces")
        assert resp.status_code == 200
        _assert_headers(resp)

    async def test_an_error_response(self, client):
        resp = await client.get(f"{API}/admin/dashboard")
        assert resp.status_code == 401
        _assert_headers(resp)

    async def test_a_404(self, client):
        resp = await client.get(f"{API}/no-such-route")
        assert resp.status_code == 404
        _assert_headers(resp)

    async def test_a_cors_preflight(self, client):
        resp = await client.options(
            f"{API}/spaces",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.headers.get("access-control-allow-origin") == "http://localhost:3000"
        # Q55: the methods the API serves, not a wildcard.
        allowed = {m.strip() for m in resp.headers["access-control-allow-methods"].split(",")}
        assert allowed == {"GET", "POST", "PUT", "DELETE", "OPTIONS"}
        _assert_headers(resp)

    async def test_a_media_file(self, client, tmp_path, monkeypatch):
        """The photo files are served with the same headers (the per-route
        `nosniff` the media mount used to add is now the middleware's)."""
        import os

        from app.main import app

        media_root = os.environ["MEDIA_ROOT"]
        (tmp := os.path.join(media_root, "rooms")) and os.makedirs(tmp, exist_ok=True)
        with open(os.path.join(tmp, "probe.webp"), "wb") as fh:
            fh.write(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
        assert any(getattr(r, "name", "") == "media" for r in app.routes)
        resp = await client.get("/media/rooms/probe.webp")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"].startswith("image/webp")
        _assert_headers(resp)

    @pytest.mark.parametrize("name", list(SECURITY_HEADERS))
    def test_the_set_is_the_documented_one(self, name):
        assert name in {
            "X-Content-Type-Options",
            "Referrer-Policy",
            "X-Frame-Options",
            "Permissions-Policy",
        }
