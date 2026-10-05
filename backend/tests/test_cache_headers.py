"""P2.1: compression and Cache-Control by response class."""

import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest_asyncio
from app.cache_headers import IMMUTABLE, NO_CACHE, NO_STORE, PUBLIC_CATALOG, cache_control_for

API = "/api/v1"
NO_GZIP = {"Accept-Encoding": "identity"}
GZIP = {"Accept-Encoding": "gzip"}


class TestCacheControlFor:
    def test_the_classes(self):
        assert cache_control_for("GET", f"{API}/spaces", 200, False) == PUBLIC_CATALOG
        assert cache_control_for("GET", f"{API}/spaces/abc", 200, False) == PUBLIC_CATALOG
        assert cache_control_for("GET", f"{API}/packages", 200, False) == PUBLIC_CATALOG
        assert cache_control_for("GET", f"{API}/rooms/abc/availability", 200, False) == NO_CACHE
        assert cache_control_for("GET", "/media/rooms/x/y.webp", 200, False) == IMMUTABLE
        # Signed in, written to, failed, or anything else: never stored.
        assert cache_control_for("GET", f"{API}/spaces", 200, True) == NO_STORE
        assert cache_control_for("POST", f"{API}/spaces", 201, False) == NO_STORE
        assert cache_control_for("GET", f"{API}/spaces/abc", 404, False) == NO_STORE
        assert cache_control_for("GET", "/media/rooms/x/y.webp", 404, False) == NO_STORE
        assert cache_control_for("GET", f"{API}/bookings/me", 200, True) == NO_STORE
        assert cache_control_for("GET", f"{API}/packages/me", 200, False) == NO_STORE
        assert cache_control_for("GET", "/health", 200, False) == NO_STORE


class TestResponsesCarryTheirClass:
    async def test_the_public_catalog_is_shareable_for_a_minute(self, client, test_space, test_org):
        for path in (f"{API}/spaces", f"{API}/spaces/{test_space.id}"):
            resp = await client.get(path, headers=NO_GZIP)
            assert resp.status_code == 200
            assert resp.headers["cache-control"] == PUBLIC_CATALOG, path
        resp = await client.get(
            f"{API}/packages", params={"org_id": str(test_org.id)}, headers=NO_GZIP
        )
        assert resp.headers["cache-control"] == PUBLIC_CATALOG

    async def test_availability_must_revalidate(self, client, test_room):
        day = (datetime.now(UTC) + timedelta(days=2)).date().isoformat()
        resp = await client.get(f"{API}/rooms/{test_room.id}/availability", params={"date": day})
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == NO_CACHE

    async def test_a_photo_is_immutable_but_a_missing_one_is_not(self, client):
        from app.main import app

        root = os.path.join(os.environ["MEDIA_ROOT"], "rooms")
        os.makedirs(root, exist_ok=True)
        with open(os.path.join(root, "probe.webp"), "wb") as fh:
            fh.write(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
        assert any(getattr(r, "name", "") == "media" for r in app.routes)
        resp = await client.get("/media/rooms/probe.webp")
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == IMMUTABLE
        assert "etag" in resp.headers
        resp = await client.get("/media/rooms/missing.webp")
        assert resp.status_code == 404
        assert resp.headers["cache-control"] == NO_STORE

    async def test_authenticated_reads_and_everything_else_are_not_stored(
        self, client, auth_headers, test_member, test_space
    ):
        resp = await client.get(f"{API}/bookings/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == NO_STORE
        # The catalog read by a signed-in client is not shareable either.
        resp = await client.get(f"{API}/spaces", headers=auth_headers)
        assert resp.headers["cache-control"] == NO_STORE
        for path, status in (("/health", 200), (f"{API}/bookings/me", 401), (f"{API}/nope", 404)):
            resp = await client.get(path)
            assert resp.status_code == status, path
            assert resp.headers["cache-control"] == NO_STORE, path
        resp = await client.post(f"{API}/auth/login", json={"email": "x@y.z", "password": "nope"})
        assert resp.headers["cache-control"] == NO_STORE


@pytest_asyncio.fixture
async def photographed_space(db_session, test_org, test_space):
    """Three rooms with four photos each, as the seed leaves them: a detail
    response well over the compression threshold."""
    from decimal import Decimal

    from app.models.space import Room

    rooms = [
        Room(
            space_id=test_space.id,
            org_id=test_org.id,
            name=f"Sala {i + 1}",
            description="Gabinete tranquilo e acolhedor.",
            capacity=4,
            hourly_rate=Decimal("11.00"),
            color="#A8D5BA",
            images=[],
            amenities=["WiFi", "Quadro branco"],
        )
        for i in range(3)
    ]
    db_session.add_all(rooms)
    await db_session.flush()
    for room in rooms:
        room.photos = [
            {
                "id": str(uuid.uuid4()),
                "key": f"rooms/{room.id}/{uuid.uuid4().hex}.webp",
                "thumb_key": f"rooms/{room.id}/{uuid.uuid4().hex}_thumb.webp",
                "width": 1600,
                "height": 1200,
            }
            for _ in range(4)
        ]
    await db_session.commit()
    return test_space


class TestCompression:
    async def test_a_json_body_over_a_kilobyte_is_gzipped_when_accepted(
        self, client, photographed_space
    ):
        resp = await client.get(f"{API}/spaces/{photographed_space.id}", headers=GZIP)
        assert resp.status_code == 200
        assert resp.headers.get("content-encoding") == "gzip"
        assert "accept-encoding" in resp.headers.get("vary", "").lower()
        # httpx hands back the decoded body: still the API's contract.
        assert set(resp.json()) == {"space", "rooms", "contact"}
        assert len(resp.content) > 1024
        assert resp.num_bytes_downloaded < len(resp.content) / 3

    async def test_a_small_body_and_a_client_that_does_not_accept_it_stay_plain(
        self, client, photographed_space
    ):
        resp = await client.get("/health", headers=GZIP)
        assert resp.status_code == 200
        assert "content-encoding" not in resp.headers
        resp = await client.get(f"{API}/spaces/{photographed_space.id}", headers=NO_GZIP)
        assert resp.status_code == 200
        assert "content-encoding" not in resp.headers
