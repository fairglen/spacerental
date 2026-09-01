from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.ratelimit import RateLimitMiddleware, limiter
from app.routers import auth, spaces, bookings, packages, admin
from app.routers import webhooks

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
app.include_router(packages.router, prefix=API_PREFIX)
app.include_router(admin.router, prefix=API_PREFIX)
app.include_router(webhooks.router, prefix=API_PREFIX)


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
