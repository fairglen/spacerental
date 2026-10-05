"""Cache-Control by response class (P2.1).

The API never sent one, so browsers — and any cache in front of them — had
to guess, and for JSON that carries a customer's bookings a wrong guess is a
leak into a shared cache. One ASGI middleware sets it on every response that
does not already carry one:

- ``/media/**`` — ``public, max-age=31536000, immutable``: photo names are
  content-addressed (``app.media.new_photo_keys``: a new upload is a new
  name), so a file never changes under its URL.
- the public catalog, read anonymously — ``GET /api/v1/spaces``,
  ``/api/v1/spaces/{id}``, ``/api/v1/packages``: ``public, max-age=60,
  stale-while-revalidate=300``, the minute the clients already trust it for.
- availability — ``no-cache``: it changes with every booking; a client may
  keep a copy but must revalidate it.
- everything else — authenticated reads, writes, errors, ``/health``, the
  stub checkout page: ``no-store``.
"""

import re

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

IMMUTABLE = "public, max-age=31536000, immutable"
PUBLIC_CATALOG = "public, max-age=60, stale-while-revalidate=300"
NO_CACHE = "no-cache"
NO_STORE = "no-store"

MEDIA_PREFIX = "/media/"
_CATALOG = re.compile(r"^/api/v1/(spaces(/[^/]+)?|packages)$")
_AVAILABILITY = re.compile(r"^/api/v1/rooms/[^/]+/availability$")


def cache_control_for(method: str, path: str, status: int, authenticated: bool) -> str:
    """The policy for one response. Only a successful anonymous GET is ever cacheable."""
    if method not in ("GET", "HEAD") or status >= 300:
        return NO_STORE
    if path.startswith(MEDIA_PREFIX):
        return IMMUTABLE
    if authenticated:
        return NO_STORE
    if _CATALOG.match(path):
        return PUBLIC_CATALOG
    if _AVAILABILITY.match(path):
        return NO_CACHE
    return NO_STORE


class CacheControlMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authenticated = "authorization" in Headers(scope=scope)

        async def send_with_cache_control(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # A route that chose its own policy keeps it.
                if "cache-control" not in headers:
                    headers["Cache-Control"] = cache_control_for(
                        scope["method"], scope["path"], message["status"], authenticated
                    )
            await send(message)

        await self.app(scope, receive, send_with_cache_control)
