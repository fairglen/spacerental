import mimetypes

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

from app.config import settings
from app.media import LocalMediaStorage, get_media_storage
from app.ratelimit import RateLimitMiddleware, limiter
from app.routers import (
    admin,
    auth,
    bookings,
    checkout_stub,
    media,
    packages,
    recurrences,
    spaces,
    webhooks,
)

# The app does not create or migrate the schema. `alembic upgrade head` runs in
# backend/docker-entrypoint.sh before uvicorn starts, so the schema exists by
# the time the first request arrives. Bootstrapping it from startup as well
# would put two owners on the same schema — see backend/app/database.py.
app = FastAPI(
    title="SpaceRental API",
    version="1.0.0",
    description="Production-ready backend for the SpaceRental platform",
)

# Registered before CORS so CORS ends up the OUTER layer: 429 responses still
# carry CORS headers (the browser would otherwise report an opaque network
# error), and preflight OPTIONS are answered by CORS without spending quota.
# `app.router.routes` is passed by reference so routers included below are
# matched too.
app.add_middleware(
    RateLimitMiddleware,
    routes=app.router.routes,
    limiter=limiter,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(spaces.router, prefix=API_PREFIX)
app.include_router(bookings.router, prefix=API_PREFIX)
app.include_router(recurrences.router, prefix=API_PREFIX)
app.include_router(packages.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(media.router, prefix=API_PREFIX)
app.include_router(webhooks.router, prefix=API_PREFIX)
# No API_PREFIX: this is a browser-facing HTML page (T10), not a JSON route —
# see app/routers/checkout_stub.py.
app.include_router(checkout_stub.router)


# python:3.12-slim ships no /etc/mime.types and its built-in table has no WebP,
# so the photos were served as text/plain — which, with `nosniff` below, a
# browser refuses to render as an image.
mimetypes.add_type("image/webp", ".webp")


class _MediaFiles(StaticFiles):
    """Read-only photo files. Everything here was re-encoded by `app.media`."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        # Defence in depth: served as exactly what we encoded, never sniffed.
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response


# Local storage only: the API itself serves what it stored (C14). With object
# storage, MEDIA_BASE_URL points at the bucket and nothing is mounted here.
_storage = get_media_storage()
if isinstance(_storage, LocalMediaStorage):
    app.mount("/media", _MediaFiles(directory=_storage.root), name="media")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
