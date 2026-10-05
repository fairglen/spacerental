import mimetypes

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles

from app.cache_headers import CacheControlMiddleware
from app.config import settings
from app.media import LocalMediaStorage, get_media_storage
from app.ratelimit import RateLimitMiddleware, limiter
from app.request_id import RequestIdMiddleware
from app.routers import (
    admin,
    auth,
    bookings,
    checkout_stub,
    media,
    packages,
    recurrences,
    spaces,
    support,
    test_hooks,
    webhooks,
)
from app.security_headers import SECURITY_HEADERS, SecurityHeadersMiddleware

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

# P2.1: JSON above a kilobyte is gzipped for a client that accepts it — a
# dashboard of a few dozen bookings is a fifth of its size on the wire;
# anything smaller, a 204 or a photo (already WebP) is left alone.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Outside the rate limiter: a refused request still gets an id on its
# response, and every audit row written during a request carries it (G01).
app.add_middleware(RequestIdMiddleware)

# P2.1: every response says what a cache may do with it (app/cache_headers.py);
# before this nothing did, and a shared cache had to guess about JSON that
# carries a customer's bookings.
app.add_middleware(CacheControlMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    # The methods the API actually serves (Q55): a wildcard would also
    # pre-approve PATCH, HEAD and anything a future route forgets to think
    # about. OPTIONS is the preflight itself.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Outermost of the user middleware (Q52): every response — JSON, /media
# files, the stub Checkout page, a 429, a preflight — carries the same static
# security headers. Starlette's own ServerErrorMiddleware still sits outside
# it and writes the 500 for an unhandled exception, so that one response is
# built here instead, with the headers and without internals.
app.add_middleware(SecurityHeadersMiddleware)


@app.exception_handler(Exception)
async def _unhandled(_request: Request, _exc: Exception) -> JSONResponse:
    return JSONResponse(
        {"detail": "Internal Server Error"}, status_code=500, headers=SECURITY_HEADERS
    )


API_PREFIX = "/api/v1"

app.include_router(auth.router, prefix=API_PREFIX)
app.include_router(spaces.router, prefix=API_PREFIX)
app.include_router(bookings.router, prefix=API_PREFIX)
app.include_router(recurrences.router, prefix=API_PREFIX)
app.include_router(packages.router, prefix=API_PREFIX)
# Every /admin route: one package, one router (Q50).
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(media.router, prefix=API_PREFIX)
app.include_router(support.router, prefix=API_PREFIX)
app.include_router(webhooks.router, prefix=API_PREFIX)
# No API_PREFIX: this is a browser-facing HTML page (T10), not a JSON route —
# see app/routers/checkout_stub.py.
app.include_router(checkout_stub.router)
# Local-only (G03): the stub mailbox for browser tests; never in production.
test_hooks.mount(
    app,
    enabled=settings.TEST_HOOKS_ENABLED,
    email_mode=settings.EMAIL_MODE,
    app_env=settings.APP_ENV,
)


# python:3.12-slim ships no /etc/mime.types and its built-in table has no WebP,
# so the photos were served as text/plain — which, with the `nosniff` every
# response now carries (app.security_headers), a browser refuses to render as
# an image.
mimetypes.add_type("image/webp", ".webp")

# Local storage only: the API itself serves what it stored (C14), read-only
# and re-encoded by `app.media`. With object storage, MEDIA_BASE_URL points at
# the bucket and nothing is mounted here.
_storage = get_media_storage()
if isinstance(_storage, LocalMediaStorage):
    app.mount("/media", StaticFiles(directory=_storage.root), name="media")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
