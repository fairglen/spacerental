"""D19: `CORS_ORIGINS` is a comma-separated list. `.env.remote` puts the
address another device reaches the frontend at next to localhost, and the API
must admit that second origin — without admitting one that is not listed.
tests/conftest.py starts the suite's app with the two-origin list."""

import pytest
from app.config import Settings, settings

API = "/api/v1"
LOCAL = "http://localhost:3000"
REMOTE = "http://192.168.1.42:3000"
UNLISTED = "http://192.168.1.43:3000"


class TestCorsOriginList:
    def test_the_list_is_split_and_stripped(self):
        assert Settings(CORS_ORIGINS=f"{LOCAL}, {REMOTE}").cors_origins_list == [LOCAL, REMOTE]
        assert Settings(CORS_ORIGINS=LOCAL).cors_origins_list == [LOCAL]
        # The app under test runs with the two-origin list from conftest.
        assert settings.cors_origins_list == [LOCAL, REMOTE]

    @pytest.mark.parametrize("origin", [LOCAL, REMOTE])
    async def test_a_listed_origin_is_admitted(self, client, origin):
        preflight = await client.options(
            f"{API}/spaces",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
        assert preflight.status_code == 200, preflight.text
        assert preflight.headers["access-control-allow-origin"] == origin
        resp = await client.get(f"{API}/spaces", headers={"Origin": origin})
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == origin

    async def test_an_unlisted_origin_is_not(self, client):
        preflight = await client.options(
            f"{API}/spaces",
            headers={"Origin": UNLISTED, "Access-Control-Request-Method": "GET"},
        )
        # Starlette answers a preflight from an unknown origin with 400.
        assert preflight.status_code == 400, preflight.text
        assert "access-control-allow-origin" not in preflight.headers
        # The simple request is served, but without the header the browser
        # needs to hand the response to the page.
        resp = await client.get(f"{API}/spaces", headers={"Origin": UNLISTED})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers
