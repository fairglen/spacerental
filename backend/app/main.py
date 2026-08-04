from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import init_db
from app.ratelimit import RateLimitMiddleware, limiter
from app.routers import auth, spaces, bookings, packages, admin


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="SpaceRental API",
    version="1.0.0",
    description="Production-ready backend for the SpaceRental platform",
    lifespan=lifespan,
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


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok"}
