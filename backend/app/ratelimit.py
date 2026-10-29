"""Tier-based request throttling, with two stores.

`RATE_LIMIT_STORE=memory` (the default, development and tests): the
in-process sliding window — exact, free, and per process, so with
WEB_CONCURRENCY=2 every limit was effectively doubled (Q55, N02).
`RATE_LIMIT_STORE=postgres` (production): fixed-window counters in one small
table shared by every worker and replica, one `INSERT … ON CONFLICT DO
UPDATE … RETURNING` per throttled request. No Redis: the database is the one
shared thing a deployment already has.

Enforcement lives in ASGI middleware rather than in a route dependency because
the limit has to reject *before* the endpoint's dependencies resolve — no DB
session, no query, and above all no Argon2 hash (64MB of memory per call) burnt
on traffic we are about to refuse. That is why the postgres store opens its
own short-lived connection from the engine instead of a request session.

DECISION (N02): a store that cannot be reached fails CLOSED for the tiers
that gate expensive or outward-facing work — `auth` (Argon2, account
enumeration) and `support` (emails a person) answer 503 — and fails OPEN,
with a WARNING, for `public` and `upload` (reads and operator uploads behind
a session). A database the limiter cannot reach is a database the endpoint
cannot reach either; the open tiers only lose their throttle for as long as
that lasts.
"""

import logging
import math
import time
from collections import defaultdict, deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from threading import Lock
from typing import TypeVar

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app import database
from app.config import settings
from app.routing_inventory import iter_api_routes, route_matcher
from app.trusted_proxies import trusted_proxies_for

logger = logging.getLogger(__name__)

AUTH_TIER = "auth"
PUBLIC_TIER = "public"
UPLOAD_TIER = "upload"
SUPPORT_TIER = "support"
# The tiers a store failure refuses (see the module docstring).
FAIL_CLOSED_TIERS = frozenset({AUTH_TIER, SUPPORT_TIER})

MEMORY_STORE = "memory"
POSTGRES_STORE = "postgres"

_TIER_ATTR = "__rate_limit_tier__"

F = TypeVar("F", bound=Callable)


def rate_limit(tier: str) -> Callable[[F], F]:
    """Mark an endpoint as throttled under `tier`.

    The marker is read by `RateLimitMiddleware` while resolving the route, i.e.
    before the endpoint (and its dependencies) is ever called.
    """
    if tier not in (AUTH_TIER, PUBLIC_TIER, UPLOAD_TIER, SUPPORT_TIER):
        raise ValueError(f"Unknown rate limit tier: {tier!r}")

    def decorator(func: F) -> F:
        setattr(func, _TIER_ATTR, tier)
        return func

    return decorator


def tier_limits(tier: str) -> tuple[int, int]:
    """(max_requests, window_seconds) for a tier, read live from settings.

    Read per request rather than captured at import time so configuration (and
    tests that tighten a threshold) takes effect without rebuilding the app.
    """
    if tier == AUTH_TIER:
        return (
            settings.RATE_LIMIT_AUTH_MAX_REQUESTS,
            settings.RATE_LIMIT_AUTH_WINDOW_SECONDS,
        )
    if tier == PUBLIC_TIER:
        return (
            settings.RATE_LIMIT_PUBLIC_MAX_REQUESTS,
            settings.RATE_LIMIT_PUBLIC_WINDOW_SECONDS,
        )
    if tier == UPLOAD_TIER:
        return (
            settings.RATE_LIMIT_UPLOAD_MAX_REQUESTS,
            settings.RATE_LIMIT_UPLOAD_WINDOW_SECONDS,
        )
    if tier == SUPPORT_TIER:
        return (
            settings.RATE_LIMIT_SUPPORT_MAX_REQUESTS,
            settings.RATE_LIMIT_SUPPORT_WINDOW_SECONDS,
        )
    raise ValueError(f"Unknown rate limit tier: {tier!r}")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: int


class RateLimitStoreError(RuntimeError):
    """The shared store could not answer; the middleware decides per tier."""


class RateLimiter:
    """Sliding-window request log keyed by (tier, client identity), in
    this process's memory.

    A sliding window rather than a fixed one: with fixed windows a caller can
    fire 2x the limit across a window boundary, which for the auth tier is
    exactly the burst we are trying to stop. Per process: with several
    workers each keeps its own log (RATE_LIMIT_STORE=postgres shares one).
    """

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(
        self,
        tier: str,
        identity: str,
        limit: int,
        window_seconds: int,
        now: float | None = None,
    ) -> RateLimitResult:
        """Record a hit and report whether it is allowed.

        `now` uses a monotonic clock so wall-clock adjustments can't widen or
        collapse a window; it is injectable for tests.
        """
        current = time.monotonic() if now is None else now
        cutoff = current - window_seconds

        with self._lock:
            hits = self._hits[(tier, identity)]
            while hits and hits[0] <= cutoff:
                hits.popleft()

            if len(hits) >= limit:
                retry_after = max(1, math.ceil(hits[0] + window_seconds - current))
                return RateLimitResult(allowed=False, remaining=0, retry_after=retry_after)

            hits.append(current)
            return RateLimitResult(allowed=True, remaining=limit - len(hits), retry_after=0)

    async def acheck(
        self, tier: str, identity: str, limit: int, window_seconds: int
    ) -> RateLimitResult:
        """What the middleware calls; the memory store needs no I/O."""
        return self.check(tier, identity, limit, window_seconds)

    def reset(self) -> None:
        """Drop all recorded hits. Used by tests between cases."""
        with self._lock:
            self._hits.clear()


_UPSERT = text(
    """
    INSERT INTO rate_limit_hits (scope, identity, window_start, hits)
    VALUES (:scope, :identity, :window_start, 1)
    ON CONFLICT (scope, identity, window_start)
    DO UPDATE SET hits = rate_limit_hits.hits + 1
    RETURNING hits
    """
)
# Rows older than the longest window (support: 3600 s) plus slack; the
# cleanup is one DELETE every CLEANUP_EVERY_SECONDS per process, on the
# connection a check already holds.
_CLEANUP = text("DELETE FROM rate_limit_hits WHERE window_start < now() - interval '2 hours'")
CLEANUP_EVERY_SECONDS = 600


class PostgresRateLimiter:
    """Fixed-window counters in `rate_limit_hits`, shared by every process
    that uses the same database (N02).

    One statement per throttled request: the row for (scope, identity, the
    window this instant falls in) is created or incremented and its count
    comes back. Every attempt counts, allowed or not, which cannot extend a
    fixed window. The connection is the engine's, short-lived, outside any
    request session — the middleware runs before dependencies resolve.

    DECISION: fixed windows, not the memory store's sliding log. A sliding
    window in SQL is a row per hit plus a count and a prune per request; the
    fixed window is one row per (client, window) and one upsert. The cost is
    the burst at a boundary — up to 2x the limit across two adjacent
    windows — accepted for limits of 10/min on auth.
    """

    def __init__(self, engine: AsyncEngine) -> None:
        self._engine = engine
        # A monotonic deadline, 0 = on the first check: an uptime-based
        # "last time" would skip the first ten minutes of a freshly booted
        # host (and of a CI runner).
        self._next_cleanup = 0.0

    @staticmethod
    def _window_start(now: float, window_seconds: int) -> datetime:
        return datetime.fromtimestamp(now - (now % window_seconds), tz=UTC)

    async def acheck(
        self,
        tier: str,
        identity: str,
        limit: int,
        window_seconds: int,
        now: float | None = None,
    ) -> RateLimitResult:
        current = time.time() if now is None else now
        window_start = self._window_start(current, window_seconds)
        try:
            async with self._engine.connect() as conn:
                hits = await conn.scalar(
                    _UPSERT,
                    {"scope": tier, "identity": identity, "window_start": window_start},
                )
                if time.monotonic() >= self._next_cleanup:
                    self._next_cleanup = time.monotonic() + CLEANUP_EVERY_SECONDS
                    await conn.execute(_CLEANUP)
                await conn.commit()
        except (SQLAlchemyError, OSError) as exc:
            # OSError: asyncpg's connection refused/reset arrive unwrapped.
            raise RateLimitStoreError(str(exc)) from exc
        hits = int(hits or 0)
        if hits > limit:
            window_end = window_start.timestamp() + window_seconds
            retry_after = max(1, math.ceil(window_end - current))
            return RateLimitResult(allowed=False, remaining=0, retry_after=retry_after)
        return RateLimitResult(allowed=True, remaining=limit - hits, retry_after=0)

    async def areset(self) -> None:
        """Drop every counter. Used by tests between cases."""
        async with self._engine.connect() as conn:
            await conn.execute(text("DELETE FROM rate_limit_hits"))
            await conn.commit()

    def reset(self) -> None:
        """The memory store's reset is a no-op here: the counters live in the
        database the test fixtures recreate; `areset()` empties them."""


def build_limiter() -> RateLimiter | PostgresRateLimiter:
    """The store RATE_LIMIT_STORE names; anything else stops the app (no
    silent fallback to a per-process limiter in a multi-worker deployment)."""
    store = settings.RATE_LIMIT_STORE
    if store == MEMORY_STORE:
        return RateLimiter()
    if store == POSTGRES_STORE:
        return PostgresRateLimiter(database.engine)
    raise RuntimeError(
        f"RATE_LIMIT_STORE={store!r} is not implemented; use {MEMORY_STORE!r} or {POSTGRES_STORE!r}"
    )


limiter = build_limiter()


def _forwarded_chain(scope: Scope) -> list[str]:
    """The non-empty entries of `X-Forwarded-For`, left to right."""
    for name, value in scope.get("headers", []):
        if name.lower() == b"x-forwarded-for":
            return [entry.strip() for entry in value.decode("latin-1").split(",") if entry.strip()]
    return []


def client_identity(scope: Scope) -> str:
    """Best available identifier for the caller.

    `X-Forwarded-For` is client-supplied, so believing it when nothing strips
    or overwrites it lets anyone bypass the limiter by rotating a fake value.
    Two ways in, both off by default:

    - RATE_LIMIT_TRUSTED_PROXIES (D20): the browser reaches the API through the
      frontend's Next.js proxy, so the peer is the frontend container and the
      real client is the entry that proxy APPENDED — the rightmost. Only a
      request whose peer is one of the named proxies is identified that way;
      whatever a client wrote into the header itself sits further left and is
      ignored. Compose names `frontend` (app/trusted_proxies.py).
    - RATE_LIMIT_TRUST_FORWARDED_FOR: for a deployment behind a reverse proxy
      the operator controls (nginx/Traefik/ALB) that OVERWRITES the header —
      the first entry is taken from any peer (S12 describes why that is only
      safe behind an overwriting proxy).
    """
    client = scope.get("client")
    peer = client[0] if client else None
    chain = _forwarded_chain(scope)

    if settings.RATE_LIMIT_TRUST_FORWARDED_FOR and chain:
        return chain[0]
    if chain and trusted_proxies_for(settings.RATE_LIMIT_TRUSTED_PROXIES).is_trusted(peer):
        return chain[-1]

    if peer:
        return peer
    # No peer address (e.g. a unix socket): bucket these together rather than
    # letting them through unthrottled.
    return "unknown"


class RateLimitMiddleware:
    """Rejects throttled requests before routing hands off to the endpoint."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        routes: Iterable[BaseRoute],
        limiter: RateLimiter | PostgresRateLimiter,
    ) -> None:
        self.app = app
        # Held by reference, not copied: routers included after this middleware
        # is registered still get matched.
        self.routes = routes
        self.limiter = limiter

    def _tier_for(self, scope: Scope) -> str | None:
        # Walked through FastAPI's route contexts: since 0.142 the included
        # routers are nested nodes and only their contexts know the full path.
        for context in iter_api_routes(self.routes):
            match, _ = route_matcher(context).matches(scope)
            if match is Match.FULL:
                return getattr(context.endpoint, _TIER_ATTR, None)
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not settings.RATE_LIMIT_ENABLED:
            await self.app(scope, receive, send)
            return

        tier = self._tier_for(scope)
        if tier is None:
            await self.app(scope, receive, send)
            return

        limit, window = tier_limits(tier)
        try:
            result = await self.limiter.acheck(tier, client_identity(scope), limit, window)
        except RateLimitStoreError as exc:
            if tier in FAIL_CLOSED_TIERS:
                logger.error("rate limit store unavailable; refusing a %s request: %s", tier, exc)
                response = JSONResponse(
                    {"detail": "Service unavailable"},
                    status_code=503,
                    headers={"Retry-After": "5"},
                )
                await response(scope, receive, send)
                return
            logger.warning(
                "rate limit store unavailable; letting a %s request through: %s", tier, exc
            )
            await self.app(scope, receive, send)
            return

        if not result.allowed:
            response = JSONResponse(
                {"detail": "Too many requests"},
                status_code=429,
                headers={
                    "Retry-After": str(result.retry_after),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                },
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
