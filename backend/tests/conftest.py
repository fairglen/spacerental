import os
import asyncio

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from sqlalchemy import text

# IMPORTANT: set test DB URL BEFORE importing app
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental_test",
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SECRET_KEY"] = "test-secret-key-32-chars-min-test-test"

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.ratelimit import limiter  # noqa: E402
from app.auth import hash_password, create_access_token  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.organization import (  # noqa: E402
    Organization,
    OrganizationMember,
    MemberRole,
    OrgPlan,
)
from app.models.space import Space, Room, AvailabilityRule  # noqa: E402


@pytest.fixture(scope="session")
def event_loop():
    """Single event loop for the whole test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Clear throttling state around every test.

    The limiter is process-global and every ASGI-transport request arrives from
    the same client address, so without this the auth-tier budget would be shared
    by the whole session and unrelated tests would start seeing 429s in whatever
    order pytest happens to run them.
    """
    limiter.reset()
    yield
    limiter.reset()


@pytest_asyncio.fixture
async def engine():
    """Per-test async engine with NullPool so connections never leak across event loops.

    asyncpg connections are tied to the loop that created them; reusing them
    from another loop raises "another operation is in progress". NullPool +
    a function-scoped engine sidesteps the issue entirely at a small perf cost.
    """
    eng = create_async_engine(
        TEST_DATABASE_URL, echo=False, future=True, poolclass=NullPool
    )
    async with eng.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    """Session factory bound to the test engine."""
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def db_session(engine, session_factory):
    """Fresh DB schema for each test; yields a fixture-side session.

    Fixtures use this session to seed data and commit. The HTTP route
    handler will use a DIFFERENT session (via session_factory) so it
    doesn't suffer identity-map staleness on objects already loaded here.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        yield session
        try:
            await session.rollback()
        except Exception:
            pass


@pytest_asyncio.fixture
async def client(session_factory, db_session):
    """HTTP client with overridden DB dependency.

    Each request gets a brand-new session (production-like). Fixture state
    committed via db_session is visible to these per-request sessions
    through normal DB reads — no identity-map sharing.
    """

    async def override_get_db():
        async with session_factory() as request_session:
            try:
                yield request_session
                await request_session.commit()
            except Exception:
                await request_session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_org(db_session) -> Organization:
    org = Organization(
        name="Test Org",
        slug="test-org",
        plan=OrgPlan.starter,
        settings={},
    )
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)
    return org


@pytest_asyncio.fixture
async def test_user(db_session) -> User:
    u = User(
        email="user@test.com",
        name="Test User",
        password_hash=hash_password("password123"),
    )
    db_session.add(u)
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def test_member(db_session, test_org, test_user) -> OrganizationMember:
    """Make test_user a regular member of test_org."""
    m = OrganizationMember(
        org_id=test_org.id, user_id=test_user.id, role=MemberRole.member
    )
    db_session.add(m)
    await db_session.commit()
    await db_session.refresh(m)
    return m


@pytest_asyncio.fixture
async def admin_user(db_session, test_org) -> User:
    u = User(
        email="admin@test.com",
        name="Admin",
        password_hash=hash_password("password123"),
    )
    db_session.add(u)
    await db_session.flush()
    db_session.add(
        OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.owner)
    )
    await db_session.commit()
    await db_session.refresh(u)
    return u


@pytest_asyncio.fixture
async def auth_headers(test_user):
    token = create_access_token(
        {
            "sub": str(test_user.id),
            "email": test_user.email,
            "name": test_user.name,
            "role": "member",
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def admin_headers(admin_user):
    token = create_access_token(
        {
            "sub": str(admin_user.id),
            "email": admin_user.email,
            "name": admin_user.name,
            "role": "owner",
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def test_space(db_session, test_org) -> Space:
    s = Space(
        org_id=test_org.id,
        name="Test Space",
        description="d",
        address="addr",
        city="Lisbon",
        images=[],
        amenities=[],
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


@pytest_asyncio.fixture
async def test_room(db_session, test_org, test_space) -> Room:
    from decimal import Decimal
    from datetime import time

    r = Room(
        space_id=test_space.id,
        org_id=test_org.id,
        name="Sala A",
        description="d",
        capacity=4,
        hourly_rate=Decimal("11.00"),
        color="#A8D5BA",
        images=[],
        amenities=[],
    )
    db_session.add(r)
    await db_session.flush()
    # Mon-Sat 08:00-20:00 (Sunday closed)
    for day in range(6):
        db_session.add(
            AvailabilityRule(
                room_id=r.id,
                day_of_week=day,
                open_time=time(8, 0),
                close_time=time(20, 0),
            )
        )
    await db_session.commit()
    await db_session.refresh(r)
    return r
