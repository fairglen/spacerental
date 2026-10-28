"""N02 — the rate limiter with more than one process: the postgres store.

The memory store is exact and per process; with WEB_CONCURRENCY=2 every
limit in the .env was effectively doubled. `PostgresRateLimiter` keeps
fixed-window counters in `rate_limit_hits`, so two limiters that share a
database — two workers, two replicas — count together. The contract both
stores share runs against both; what only the shared store can do (count
across instances) and how it fails (closed for auth and support, open for
public and upload) is tested on the real database.
"""

import logging
import time

import pytest
from app import ratelimit
from app.config import settings
from app.models.rate_limit import RateLimitHit
from app.ratelimit import (
    AUTH_TIER,
    PUBLIC_TIER,
    PostgresRateLimiter,
    RateLimiter,
    RateLimitMiddleware,
    build_limiter,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

LOGIN_URL = "/api/v1/auth/login"
SPACES_URL = "/api/v1/spaces"
SUPPORT_URL = "/api/v1/support/requests"


@pytest.fixture
async def pg_limiter(engine, db_session):
    """A postgres-backed limiter on the test engine; the schema (so the empty
    `rate_limit_hits` table) comes from `db_session`."""
    limiter = PostgresRateLimiter(engine)
    yield limiter
    await limiter.areset()


@pytest.fixture(params=["memory", "postgres"])
async def any_limiter(request, engine, db_session):
    if request.param == "memory":
        yield RateLimiter()
        return
    limiter = PostgresRateLimiter(engine)
    yield limiter
    await limiter.areset()


def _middleware(app) -> RateLimitMiddleware:
    """The one RateLimitMiddleware in the built ASGI stack (built on the
    first request; built here when no request has arrived yet)."""
    if app.middleware_stack is None:
        app.middleware_stack = app.build_middleware_stack()
    layer = app.middleware_stack
    while layer is not None and not isinstance(layer, RateLimitMiddleware):
        layer = getattr(layer, "app", None)
    assert isinstance(layer, RateLimitMiddleware)
    return layer


@pytest.fixture
def swap_store(client, monkeypatch):
    """Put another store behind the app's middleware for one test."""
    from app.main import app

    middleware = _middleware(app)
    return lambda limiter: monkeypatch.setattr(middleware, "limiter", limiter)


class TestTheContractBothStoresKeep:
    async def test_allows_up_to_the_limit_then_rejects(self, any_limiter):
        for _ in range(3):
            assert (await any_limiter.acheck("t", "ip", 3, 60)).allowed is True
        blocked = await any_limiter.acheck("t", "ip", 3, 60)
        assert blocked.allowed is False
        assert blocked.remaining == 0
        assert blocked.retry_after >= 1

    async def test_remaining_counts_down(self, any_limiter):
        assert (await any_limiter.acheck("t", "ip", 3, 60)).remaining == 2
        assert (await any_limiter.acheck("t", "ip", 3, 60)).remaining == 1
        assert (await any_limiter.acheck("t", "ip", 3, 60)).remaining == 0

    async def test_identities_and_tiers_have_independent_budgets(self, any_limiter):
        for _ in range(3):
            await any_limiter.acheck(AUTH_TIER, "1.1.1.1", 3, 60)
        assert (await any_limiter.acheck(AUTH_TIER, "1.1.1.1", 3, 60)).allowed is False
        assert (await any_limiter.acheck(AUTH_TIER, "2.2.2.2", 3, 60)).allowed is True
        assert (await any_limiter.acheck(PUBLIC_TIER, "1.1.1.1", 3, 60)).allowed is True


class TestPostgresStore:
    async def test_fixed_windows_free_the_budget_at_the_boundary(self, pg_limiter):
        # The current minute's window (a 1970 instant would be swept by the
        # two-hour cleanup): hits at +0, +1 and +2 share it.
        start = time.time() // 60 * 60
        for i in range(2):
            assert (await pg_limiter.acheck("t", "ip", 2, 60, now=start + i)).allowed is True
        blocked = await pg_limiter.acheck("t", "ip", 2, 60, now=start + 2)
        assert blocked.allowed is False
        assert blocked.retry_after == 58
        # +60 starts the next window: a new row, a fresh budget.
        assert (await pg_limiter.acheck("t", "ip", 2, 60, now=start + 60)).allowed is True

    async def test_two_instances_sharing_the_database_count_together(self, engine, db_session):
        """Two uvicorn workers (or two replicas) are two limiter instances
        on one table: the .env's number is the whole deployment's."""
        worker_a = PostgresRateLimiter(engine)
        worker_b = PostgresRateLimiter(engine)
        now = time.time()
        assert (await worker_a.acheck(AUTH_TIER, "ip", 3, 60, now=now)).remaining == 2
        assert (await worker_b.acheck(AUTH_TIER, "ip", 3, 60, now=now)).remaining == 1
        assert (await worker_a.acheck(AUTH_TIER, "ip", 3, 60, now=now)).remaining == 0
        assert (await worker_b.acheck(AUTH_TIER, "ip", 3, 60, now=now)).allowed is False
        assert (await worker_a.acheck(AUTH_TIER, "ip", 3, 60, now=now)).allowed is False
        await worker_a.areset()

    async def test_old_windows_are_deleted_by_the_periodic_cleanup(self, pg_limiter, db_session):
        stale = time.time() - 3 * 3600
        await pg_limiter.acheck("t", "old", 5, 60, now=stale)
        await pg_limiter.acheck("t", "old", 5, 60, now=stale + 1)
        count = select(func.count()).select_from(RateLimitHit)
        assert await db_session.scalar(count) == 1
        # The next check after CLEANUP_EVERY_SECONDS sweeps rows older than
        # two hours; the current window's row stays.
        pg_limiter._last_cleanup = 0.0
        await pg_limiter.acheck("t", "fresh", 5, 60)
        rows = (await db_session.execute(select(RateLimitHit.identity))).scalars().all()
        assert rows == ["fresh"]

    def test_the_store_is_chosen_by_setting_and_an_unknown_one_stops_the_app(self, monkeypatch):
        monkeypatch.setattr(settings, "RATE_LIMIT_STORE", "postgres")
        assert isinstance(build_limiter(), PostgresRateLimiter)
        monkeypatch.setattr(settings, "RATE_LIMIT_STORE", "memory")
        assert isinstance(build_limiter(), RateLimiter)
        monkeypatch.setattr(settings, "RATE_LIMIT_STORE", "redis")
        with pytest.raises(RuntimeError, match="not implemented"):
            build_limiter()


class TestTheMiddlewareOnTheSharedStore:
    async def test_the_auth_limit_is_exactly_the_setting(
        self, client, test_user, pg_limiter, swap_store
    ):
        swap_store(pg_limiter)
        limit = settings.RATE_LIMIT_AUTH_MAX_REQUESTS
        for _ in range(limit):
            resp = await client.post(LOGIN_URL, json={"email": "user@test.com", "password": "x"})
            assert resp.status_code == 401, resp.text
        blocked = await client.post(LOGIN_URL, json={"email": "user@test.com", "password": "x"})
        assert blocked.status_code == 429, blocked.text
        assert blocked.headers["x-ratelimit-limit"] == str(limit)
        assert int(blocked.headers["retry-after"]) >= 1

    async def test_public_and_auth_budgets_stay_independent(
        self, client, test_space, test_user, pg_limiter, swap_store, monkeypatch
    ):
        swap_store(pg_limiter)
        monkeypatch.setattr(settings, "RATE_LIMIT_PUBLIC_MAX_REQUESTS", 3)
        for _ in range(3):
            assert (await client.get(SPACES_URL)).status_code == 200
        assert (await client.get(SPACES_URL)).status_code == 429
        login = await client.post(LOGIN_URL, json={"email": "user@test.com", "password": "x"})
        assert login.status_code == 401

    async def test_a_store_that_cannot_be_reached_fails_closed_for_auth_and_support_open_for_public(
        self, client, test_space, swap_store, caplog
    ):
        """DECISION (N02): auth and support answer 503 (Argon2 and an email
        are not spent on traffic nobody can count), public reads pass with a
        WARNING. Connection refused on a closed port: fast and deterministic."""
        unreachable = create_async_engine(
            "postgresql+asyncpg://nobody:nothing@127.0.0.1:1/nowhere", poolclass=NullPool
        )
        try:
            swap_store(PostgresRateLimiter(unreachable))
            with caplog.at_level(logging.WARNING, logger=ratelimit.__name__):
                login = await client.post(
                    LOGIN_URL, json={"email": "user@test.com", "password": "x"}
                )
                support = await client.post(SUPPORT_URL, json={})
                spaces = await client.get(SPACES_URL)
            assert login.status_code == 503
            assert login.json() == {"detail": "Service unavailable"}
            assert login.headers["retry-after"] == "5"
            assert support.status_code == 503
            assert spaces.status_code == 200
            assert "letting a public request through" in caplog.text
            assert "refusing a auth request" in caplog.text
        finally:
            await unreachable.dispose()
