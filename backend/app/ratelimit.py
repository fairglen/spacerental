"""In-process, tier-based request throttling.

Kept in-process (no Redis) on purpose: the API runs as a single uvicorn process
per container today, so a shared store would add an operational dependency for
no gain. `RateLimiter` is the only thing that has to change when we scale to
multiple workers — the middleware and the endpoint markers stay as they are.

Enforcement lives in ASGI middleware rather than in a route dependency because
the limit has to reject *before* the endpoint's dependencies resolve — no DB
session, no query, and above all no Argon2 hash (64MB of memory per call) burnt
on traffic we are about to refuse.
"""

import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from threading import Lock
from typing import Callable, Iterable, Optional, TypeVar

from starlette.responses import JSONResponse
from starlette.routing import BaseRoute, Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import settings

AUTH_TIER = "auth"
PUBLIC_TIER = "public"

_TIER_ATTR = "__rate_limit_tier__"

F = TypeVar("F", bound=Callable)


def rate_limit(tier: str) -> Callable[[F], F]:
    """Mark an endpoint as throttled under `tier`.

    The marker is read by `RateLimitMiddleware` while resolving the route, i.e.
    before the endpoint (and its dependencies) is ever called.
    """
    if tier not in (AUTH_TIER, PUBLIC_TIER):
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
    raise ValueError(f"Unknown rate limit tier: {tier!r}")


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: int


class RateLimiter:
    """Sliding-window request log keyed by (tier, client identity).

    A sliding window rather than a fixed one: with fixed windows a caller can
    fire 2x the limit across a window boundary, which for the auth tier is
    exactly the burst we are trying to stop.
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
        now: Optional[float] = None,
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
            return RateLimitResult(
                allowed=True, remaining=limit - len(hits), retry_after=0
            )

    def reset(self) -> None:
        """Drop all recorded hits. Used by tests between cases."""
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_identity(scope: Scope) -> str:
    """Best available identifier for the caller.

    Trusting `X-Forwarded-For` is opt-in via RATE_LIMIT_TRUST_FORWARDED_FOR: the
    header is client-supplied, so trusting it when nothing strips or overwrites
    it lets anyone bypass the limiter by rotating a fake value. Enable it only
    when a proxy the deployment controls (nginx/Traefik/ALB) sets the header.
    Inside the docker-compose stack the frontend talks to `backend` directly,
    so the peer address is the real client and the default stays off.
    """
    if settings.RATE_LIMIT_TRUST_FORWARDED_FOR:
        for name, value in scope.get("headers", []):
            if name.lower() == b"x-forwarded-for":
                forwarded = value.decode("latin-1").split(",")[0].strip()
                if forwarded:
                    return forwarded

    client = scope.get("client")
    if client:
        return client[0]
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
        limiter: RateLimiter,
    ) -> None:
        self.app = app
        # Held by reference, not copied: routers included after this middleware
        # is registered still get matched.
        self.routes = routes
        self.limiter = limiter

    def _tier_for(self, scope: Scope) -> Optional[str]:
        for route in self.routes:
            match, _ = route.matches(scope)
            if match is Match.FULL:
                endpoint = getattr(route, "endpoint", None)
                return getattr(endpoint, _TIER_ATTR, None)
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
        result = self.limiter.check(tier, client_identity(scope), limit, window)

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
