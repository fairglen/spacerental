"""Rate limiting — Epic 7 (stories 7.1 auth throttling, 7.2 public throttling).

Unit tests cover the sliding-window bookkeeping in isolation; everything else is
an integration test through the `client` fixture against the real test database,
so the assertions about "no DB query ran" are made against actual driver
activity rather than a mock.
"""

import pytest
from sqlalchemy import event

from app.config import settings
from app.ratelimit import AUTH_TIER, PUBLIC_TIER, RateLimiter, limiter
from app.routers import auth as auth_router

REGISTER_URL = "/api/v1/auth/register"
LOGIN_URL = "/api/v1/auth/login"
SPACES_URL = "/api/v1/spaces"


def _login_payload(email: str = "user@test.com", password: str = "wrong-password"):
    return {"email": email, "password": password}


def _register_payload(email: str):
    return {"email": email, "password": "password123", "name": "Rate Limited"}


@pytest.fixture
def query_counter(engine):
    """Counts statements actually sent to PostgreSQL by the app's engine."""
    counter = {"n": 0}

    def _on_execute(conn, cursor, statement, parameters, context, executemany):
        counter["n"] += 1

    event.listen(engine.sync_engine, "before_cursor_execute", _on_execute)
    yield counter
    event.remove(engine.sync_engine, "before_cursor_execute", _on_execute)


class TestSlidingWindowBookkeeping:
    """Pure window/threshold logic — no I/O, no app."""

    def test_allows_up_to_the_limit_then_rejects(self):
        rl = RateLimiter()
        for i in range(3):
            assert rl.check("t", "ip", 3, 60, now=100.0 + i).allowed is True
        assert rl.check("t", "ip", 3, 60, now=103.0).allowed is False

    def test_hits_aging_out_of_the_window_free_budget(self):
        rl = RateLimiter()
        for i in range(3):
            rl.check("t", "ip", 3, 60, now=100.0 + i)
        assert rl.check("t", "ip", 3, 60, now=130.0).allowed is False
        # The first hit (t=100) leaves the 60s window at t=160.
        assert rl.check("t", "ip", 3, 60, now=161.0).allowed is True

    def test_identities_and_tiers_have_independent_budgets(self):
        rl = RateLimiter()
        for i in range(3):
            rl.check(AUTH_TIER, "1.1.1.1", 3, 60, now=100.0 + i)
        assert rl.check(AUTH_TIER, "1.1.1.1", 3, 60, now=103.0).allowed is False
        assert rl.check(AUTH_TIER, "2.2.2.2", 3, 60, now=103.0).allowed is True
        assert rl.check(PUBLIC_TIER, "1.1.1.1", 3, 60, now=103.0).allowed is True

    def test_retry_after_reports_when_the_window_frees_up(self):
        rl = RateLimiter()
        rl.check("t", "ip", 1, 60, now=100.0)
        result = rl.check("t", "ip", 1, 60, now=130.0)
        assert result.allowed is False
        assert result.retry_after == 30

    def test_reset_clears_all_buckets(self):
        rl = RateLimiter()
        rl.check("t", "ip", 1, 60, now=100.0)
        rl.reset()
        assert rl.check("t", "ip", 1, 60, now=100.0).allowed is True


class TestAuthTierThrottling:
    """Story 7.1 — POST /auth/login and /auth/register."""

    async def test_eleventh_login_in_the_window_returns_429(self, client, test_user):
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS

        for _ in range(limit):
            resp = await client.post(LOGIN_URL, json=_login_payload())
            assert resp.status_code == 401, resp.text

        blocked = await client.post(LOGIN_URL, json=_login_payload())
        assert blocked.status_code == 429, blocked.text
        assert blocked.json() == {"detail": "Too many requests"}
        assert int(blocked.headers["retry-after"]) >= 1
        assert blocked.headers["x-ratelimit-limit"] == str(limit)

    async def test_requests_under_the_limit_still_succeed(self, client):
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS

        created = await client.post(REGISTER_URL, json=_register_payload("under@limit.com"))
        assert created.status_code == 201, created.text

        for _ in range(limit - 1):
            resp = await client.post(
                LOGIN_URL, json=_login_payload("under@limit.com", "password123")
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["access_token"]

    async def test_login_and_register_share_one_auth_budget(self, client, test_user):
        """The story counts login *or* register requests against one window."""
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS

        for _ in range(limit):
            resp = await client.post(LOGIN_URL, json=_login_payload())
            assert resp.status_code == 401

        blocked = await client.post(REGISTER_URL, json=_register_payload("spill@over.com"))
        assert blocked.status_code == 429, blocked.text

    async def test_rejection_happens_before_argon2_hashing_or_any_db_query(
        self, client, test_user, query_counter, monkeypatch
    ):
        """The point of story 7.1: refused traffic must cost nothing.

        A rejected request that still hashed a password would have burnt 64MB of
        memory (Argon2 m=64MB) on an attacker's behalf, and one that still hit
        the DB would still hold a connection.
        """
        hash_calls = {"n": 0}
        verify_calls = {"n": 0}
        real_hash = auth_router.hash_password
        real_verify = auth_router.verify_password

        def counting_hash(password):
            hash_calls["n"] += 1
            return real_hash(password)

        def counting_verify(password, password_hash):
            verify_calls["n"] += 1
            return real_verify(password, password_hash)

        monkeypatch.setattr(auth_router, "hash_password", counting_hash)
        monkeypatch.setattr(auth_router, "verify_password", counting_verify)

        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        for _ in range(limit):
            resp = await client.post(LOGIN_URL, json=_login_payload())
            assert resp.status_code == 401

        # Baseline: the allowed requests really did verify a hash and query the DB.
        assert verify_calls["n"] == limit
        assert query_counter["n"] > 0

        queries_before = query_counter["n"]
        verifies_before = verify_calls["n"]

        blocked_login = await client.post(LOGIN_URL, json=_login_payload())
        assert blocked_login.status_code == 429
        blocked_register = await client.post(REGISTER_URL, json=_register_payload("no@work.com"))
        assert blocked_register.status_code == 429

        assert query_counter["n"] == queries_before, "a DB query ran for a throttled request"
        assert verify_calls["n"] == verifies_before, "Argon2 verify ran for a throttled request"
        assert hash_calls["n"] == 0, "Argon2 hashing ran for a throttled request"

    async def test_separate_client_ips_have_separate_budgets(
        self, client, test_user, monkeypatch
    ):
        """Throttling is per-IP; with a proxy in front, that means the forwarded IP."""
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_FORWARDED_FOR", True)
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS

        for _ in range(limit):
            resp = await client.post(
                LOGIN_URL, json=_login_payload(), headers={"X-Forwarded-For": "203.0.113.7"}
            )
            assert resp.status_code == 401

        blocked = await client.post(
            LOGIN_URL, json=_login_payload(), headers={"X-Forwarded-For": "203.0.113.7"}
        )
        assert blocked.status_code == 429

        other_client = await client.post(
            LOGIN_URL, json=_login_payload(), headers={"X-Forwarded-For": "203.0.113.8"}
        )
        assert other_client.status_code == 401, other_client.text


class TestPublicTierThrottling:
    """Story 7.2 — GET /spaces and GET /rooms/{id}/availability."""

    def test_public_threshold_is_higher_than_the_auth_threshold(self):
        assert (
            settings.RATE_LIMIT_PUBLIC_MAX_REQUESTS > settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        )

    async def test_public_reads_survive_past_the_auth_tier_limit(self, client, test_space):
        """Traffic that would already be 429ing on the auth tier still passes here."""
        for _ in range(settings.RATE_LIMIT_AUTH_MAX_REQUESTS + 1):
            resp = await client.get(SPACES_URL)
            assert resp.status_code == 200, resp.text

    async def test_public_reads_are_throttled_at_their_own_threshold(
        self, client, test_space, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_MAX_REQUESTS", 5)

        for _ in range(5):
            resp = await client.get(SPACES_URL)
            assert resp.status_code == 200, resp.text

        blocked = await client.get(SPACES_URL)
        assert blocked.status_code == 429, blocked.text
        assert blocked.headers["x-ratelimit-limit"] == "5"

    async def test_availability_shares_the_public_budget(
        self, client, test_room, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_MAX_REQUESTS", 4)
        availability_url = f"/api/v1/rooms/{test_room.id}/availability"

        for _ in range(4):
            resp = await client.get(availability_url, params={"date": "2026-08-10"})
            assert resp.status_code == 200, resp.text

        blocked = await client.get(availability_url, params={"date": "2026-08-10"})
        assert blocked.status_code == 429, blocked.text

    async def test_public_and_auth_budgets_are_independent(
        self, client, test_space, test_user, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_MAX_REQUESTS", 3)

        for _ in range(3):
            assert (await client.get(SPACES_URL)).status_code == 200
        assert (await client.get(SPACES_URL)).status_code == 429

        # Exhausting the public tier must not lock anyone out of signing in.
        assert (await client.post(LOGIN_URL, json=_login_payload())).status_code == 401


class TestUnthrottledEndpoints:
    async def test_endpoints_without_a_tier_marker_are_not_limited(self, client):
        """Only endpoints explicitly marked with @rate_limit are throttled."""
        for _ in range(settings.RATE_LIMIT_AUTH_MAX_REQUESTS + 5):
            resp = await client.get("/health")
            assert resp.status_code == 200

    async def test_disabling_the_limiter_lets_everything_through(
        self, client, test_user, monkeypatch
    ):
        monkeypatch.setattr(settings, "RATE_LIMIT_ENABLED", False)
        limiter.reset()

        for _ in range(settings.RATE_LIMIT_AUTH_MAX_REQUESTS + 2):
            resp = await client.post(LOGIN_URL, json=_login_payload())
            assert resp.status_code == 401, resp.text
