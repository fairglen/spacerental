import asyncio
import json
import os
import shutil
import tempfile
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# IMPORTANT: set test DB URL BEFORE importing app
_CONFIGURED_TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental_test",
)
# One database per xdist worker (Q48): `pytest -n auto` starts workers gw0,
# gw1, … that would otherwise drop and recreate the same tables under each
# other. `worker_database` below creates and drops it; a plain `pytest` run
# keeps the configured name and touches nothing.
_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
TEST_DATABASE_URL = (
    f"{_CONFIGURED_TEST_DATABASE_URL}_{_WORKER}" if _WORKER else _CONFIGURED_TEST_DATABASE_URL
)
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SECRET_KEY"] = "test-secret-key-32-chars-min-test-test"
# The stub mailbox hook (G03) is an opt-in; the suite tests it.
os.environ["TEST_HOOKS_ENABLED"] = "true"
# Uploaded photos go to a throwaway directory, never into the checkout (C14).
os.environ["MEDIA_ROOT"] = tempfile.mkdtemp(prefix="spacerental-test-media-")
# Two origins, as `.env.remote` sets them (D19): tests/test_cors.py proves the
# second one is admitted and an unlisted one is not; the space after the comma
# is deliberate (the list is stripped).
os.environ["CORS_ORIGINS"] = "http://localhost:3000, http://192.168.1.42:3000"

from app.auth import create_access_token, hash_password  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.email import StubEmailGateway, get_email_gateway  # noqa: E402
from app.locks import StubLockGateway, get_lock_gateway  # noqa: E402
from app.main import app  # noqa: E402
from app.models.organization import (  # noqa: E402
    MemberRole,
    Organization,
    OrganizationMember,
    OrgPlan,
)
from app.models.space import AvailabilityRule, Room, Space  # noqa: E402
from app.models.user import User  # noqa: E402
from app.payments import (  # noqa: E402
    CheckoutKind,
    StubPaymentGateway,
    get_payment_gateway,
)
from app.ratelimit import limiter  # noqa: E402

TEST_STRIPE_WEBHOOK_SECRET = "whsec_test_not_a_real_secret"


def checkout_completed_event(
    *,
    session_id: str,
    kind: CheckoutKind,
    reference_id,
    org_id,
    payment_status: str = "paid",
    event_type: str = "checkout.session.completed",
) -> bytes:
    """Serialize a Stripe `checkout.session.completed` payload."""
    return json.dumps(
        {
            "id": "evt_test_1",
            "object": "event",
            "type": event_type,
            "data": {
                "object": {
                    "id": session_id,
                    "object": "checkout.session",
                    "payment_status": payment_status,
                    "client_reference_id": str(reference_id),
                    "metadata": {
                        "kind": kind.value,
                        "reference_id": str(reference_id),
                        "org_id": str(org_id),
                    },
                }
            },
        }
    ).encode()


@pytest.fixture(scope="session", autouse=True)
def worker_database():
    """This xdist worker's own database: created before its first test,
    dropped after its last. The configured URL's database (the one a serial
    run uses) is the maintenance connection's neighbour, so the worker needs
    nothing but the same credentials (a Compose/CI PostgreSQL user owns the
    cluster)."""
    if not _WORKER:
        yield
        return

    import asyncpg

    base, name = TEST_DATABASE_URL.rsplit("/", 1)
    maintenance = base.replace("postgresql+asyncpg://", "postgresql://") + "/postgres"

    async def run(sql: str) -> None:
        conn = await asyncpg.connect(maintenance)
        try:
            await conn.execute(sql)
        finally:
            await conn.close()

    # Its own loop: the session loop pytest-asyncio runs the tests on
    # (pytest.ini, `asyncio_default_*_loop_scope`) belongs to the tests.
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        loop.run_until_complete(run(f'CREATE DATABASE "{name}"'))
        yield
        loop.run_until_complete(run(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    finally:
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


@pytest.fixture(autouse=True)
def clean_media_root():
    """Each test starts and ends with an empty media directory."""
    yield
    root = os.environ["MEDIA_ROOT"]
    for entry in os.listdir(root):
        shutil.rmtree(os.path.join(root, entry), ignore_errors=True)


@pytest_asyncio.fixture
async def engine():
    """Per-test async engine with NullPool so connections never leak across event loops.

    asyncpg connections are tied to the loop that created them; reusing them
    from another loop raises "another operation is in progress". NullPool +
    a function-scoped engine sidesteps the issue entirely at a small perf cost.
    """
    eng = create_async_engine(TEST_DATABASE_URL, echo=False, future=True, poolclass=NullPool)
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
        with suppress(Exception):
            await session.rollback()


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
async def payments(client) -> StubPaymentGateway:
    """The stub payment gateway the app under test will use.

    It is the same StubPaymentGateway that STRIPE_MODE=stub serves in dev, so
    tests exercise the production checkout/webhook code path — pinned to a
    known webhook secret so payloads can be signed here. No network, and no
    Stripe credentials required to run the suite.
    """
    gateway = StubPaymentGateway(
        webhook_secret=TEST_STRIPE_WEBHOOK_SECRET,
        currency="eur",
        success_url="http://test/success",
        cancel_url="http://test/cancel",
        checkout_base_url="http://test",
    )
    app.dependency_overrides[get_payment_gateway] = lambda: gateway
    yield gateway
    app.dependency_overrides.pop(get_payment_gateway, None)


@pytest_asyncio.fixture
async def emails(client) -> StubEmailGateway:
    """The stub email gateway the app under test will use.

    Same StubEmailGateway that EMAIL_MODE=stub serves in dev — `.sent` is the
    observable side effect tests assert against instead of a Resend
    dashboard. No network, no credentials required to run the suite.
    """
    gateway = StubEmailGateway()
    app.dependency_overrides[get_email_gateway] = lambda: gateway
    yield gateway
    app.dependency_overrides.pop(get_email_gateway, None)


@pytest_asyncio.fixture
async def locks(client) -> StubLockGateway:
    """The stub Seam gateway the app under test will use.

    Same StubLockGateway that SEAM_MODE=stub serves in dev — `.issued_code_for`
    and `.revoked_booking_ids` are the observable side effects tests assert
    against instead of a Seam dashboard. No network, no credentials required.
    """
    gateway = StubLockGateway()
    app.dependency_overrides[get_lock_gateway] = lambda: gateway
    yield gateway
    app.dependency_overrides.pop(get_lock_gateway, None)


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
    m = OrganizationMember(org_id=test_org.id, user_id=test_user.id, role=MemberRole.member)
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
    db_session.add(OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.owner))
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
        # UTC on purpose (R01): hundreds of tests pin UTC instants against the
        # 08-20 rules below; Lisbon-clock behaviour has its own tests.
        timezone="UTC",
        images=[],
        amenities=[],
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


@pytest_asyncio.fixture
async def test_room(db_session, test_org, test_space) -> Room:
    from datetime import time
    from decimal import Decimal

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


@pytest_asyncio.fixture
async def ledger(db_session, test_org, test_user, test_member, test_room) -> SimpleNamespace:
    """September 2026 as a small operator saw it (I02); the dashboard (I03)
    and the invoice records (I05) read the same month.

    Lisbon is UTC+1 all month. Two customers: `ana` (test_user) and `bruno`.
    What counts, by `paid_at` (I01): an hourly booking, a mixed one (card
    part 11 € for 1 of 2 hours), a manual booking with an amount, a bought
    pack each, a booking cancelled after it was paid (the money stayed), and
    an hourly booking paid at 2026-08-31 23:30 UTC — 1 September 00:30 in
    Lisbon. What does not: a pending hold, a pack-paid booking, a
    complimentary grant, a cancellation credit, a pending pack purchase, a
    booking paid at 2026-09-30 23:30 UTC (1 October in Lisbon), and another
    organisation's pack sale. `expected` holds the hand-computed totals.
    """
    from decimal import Decimal

    from app.auth import hash_password
    from app.models.booking import Booking, BookingStatus, PaymentMethod
    from app.models.organization import MemberRole, OrganizationMember, OrgPlan
    from app.models.package import Package, PurchaseSource, PurchaseStatus, UserPackagePurchase

    def at(day: int, hour: int = 10, month: int = 9, minute: int = 0) -> datetime:
        return datetime(2026, month, day, hour, minute, tzinfo=UTC)

    w = SimpleNamespace(org=test_org, ana=test_user, room=test_room)
    w.bruno = User(
        email="bruno@test.com", name="Bruno Costa", password_hash=hash_password("password123")
    )
    w.other_org = Organization(name="Outra", slug="outra-ledger", plan=OrgPlan.starter, settings={})
    db_session.add_all([w.bruno, w.other_org])
    await db_session.flush()
    db_session.add(
        OrganizationMember(org_id=test_org.id, user_id=w.bruno.id, role=MemberRole.member)
    )
    w.pack10 = Package(
        org_id=test_org.id, name="Pack 10h", hours=10, price=Decimal("100.00"), validity_days=365
    )
    w.pack5 = Package(
        org_id=test_org.id, name="Pack 5h", hours=5, price=Decimal("55.00"), validity_days=365
    )
    w.other_pack = Package(
        org_id=w.other_org.id,
        name="Outro pack",
        hours=10,
        price=Decimal("90.00"),
        validity_days=365,
    )
    db_session.add_all([w.pack10, w.pack5, w.other_pack])
    await db_session.flush()

    def booking(user, *, day, hours, amount, status, method, paid_at, used="0.00", **extra):
        start = at(day, 9, month=10)
        return Booking(
            org_id=test_org.id,
            room_id=test_room.id,
            user_id=user.id,
            start_time=start,
            end_time=start + timedelta(hours=hours),
            duration_hours=Decimal(f"{hours}.00"),
            total_amount=Decimal(amount),
            package_hours_used=Decimal(used),
            status=status,
            payment_method=method,
            paid_at=paid_at,
            **extra,
        )

    confirmed, cancelled, pending = (
        BookingStatus.confirmed,
        BookingStatus.cancelled,
        BookingStatus.pending,
    )
    w.hourly_ana = booking(
        w.ana,
        day=1,
        hours=1,
        amount="11.00",
        status=confirmed,
        method=PaymentMethod.hourly,
        paid_at=at(5),
    )
    w.mixed_ana = booking(
        w.ana,
        day=2,
        hours=2,
        amount="11.00",
        status=confirmed,
        method=PaymentMethod.mixed,
        paid_at=at(10),
        used="1.00",
    )
    w.manual_bruno = booking(
        w.bruno,
        day=3,
        hours=2,
        amount="22.00",
        status=confirmed,
        method=PaymentMethod.manual,
        paid_at=at(12),
    )
    w.cancelled_paid_bruno = booking(
        w.bruno,
        day=4,
        hours=1,
        amount="11.00",
        status=cancelled,
        method=PaymentMethod.hourly,
        paid_at=at(22),
    )
    w.pending_ana = booking(
        w.ana,
        day=5,
        hours=1,
        amount="11.00",
        status=pending,
        method=PaymentMethod.hourly,
        paid_at=None,
        hold_expires_at=at(28, month=10),
    )
    w.package_ana = booking(
        w.ana,
        day=6,
        hours=2,
        amount="22.00",
        status=confirmed,
        method=PaymentMethod.package,
        paid_at=None,
        used="2.00",
    )
    w.edge_in_ana = booking(
        w.ana,
        day=7,
        hours=1,
        amount="11.00",
        status=confirmed,
        method=PaymentMethod.hourly,
        paid_at=at(31, 23, month=8, minute=30),
    )
    w.edge_out_ana = booking(
        w.ana,
        day=8,
        hours=1,
        amount="11.00",
        status=confirmed,
        method=PaymentMethod.hourly,
        paid_at=at(30, 23, minute=30),
    )
    db_session.add_all(
        [
            w.hourly_ana,
            w.mixed_ana,
            w.manual_bruno,
            w.cancelled_paid_bruno,
            w.pending_ana,
            w.package_ana,
            w.edge_in_ana,
            w.edge_out_ana,
        ]
    )
    await db_session.flush()

    def purchase(user, package, *, org=None, hours, amount, source, status, paid_at, **extra):
        return UserPackagePurchase(
            user_id=user.id,
            package_id=package.id if package is not None else None,
            org_id=(org or test_org).id,
            hours_total=Decimal(hours),
            hours_used=Decimal("0.00"),
            hours_remaining=Decimal(hours),
            amount_paid=Decimal(amount),
            source=source,
            status=status,
            purchased_at=paid_at or at(1),
            paid_at=paid_at,
            expires_at=at(1, month=12),
            **extra,
        )

    bought, active = PurchaseSource.purchase, PurchaseStatus.active
    w.pack_bruno = purchase(
        w.bruno,
        w.pack10,
        hours="10.00",
        amount="100.00",
        source=bought,
        status=active,
        paid_at=at(15),
    )
    w.pack_ana = purchase(
        w.ana, w.pack5, hours="5.00", amount="55.00", source=bought, status=active, paid_at=at(20)
    )
    w.gift_ana = purchase(
        w.ana,
        w.pack5,
        hours="2.00",
        amount="0.00",
        source=PurchaseSource.complimentary,
        status=active,
        paid_at=at(21),
    )
    w.credit_bruno = purchase(
        w.bruno,
        None,
        hours="1.00",
        amount="11.00",
        source=PurchaseSource.cancellation_credit,
        status=active,
        paid_at=None,
        source_booking_id=w.cancelled_paid_bruno.id,
    )
    w.pending_pack_ana = purchase(
        w.ana,
        w.pack10,
        hours="10.00",
        amount="100.00",
        source=bought,
        status=PurchaseStatus.pending,
        paid_at=None,
    )
    w.other_org_pack = purchase(
        w.ana,
        w.other_pack,
        org=w.other_org,
        hours="10.00",
        amount="90.00",
        source=bought,
        status=active,
        paid_at=at(16),
    )
    db_session.add_all(
        [w.pack_bruno, w.pack_ana, w.gift_ana, w.credit_bruno, w.pending_pack_ana, w.other_org_pack]
    )
    await db_session.commit()

    w.params = {"org_id": str(test_org.id), "from": "2026-09-01", "to": "2026-09-30"}
    w.expected = {
        "received_total": "221.00",
        "by_channel": {"online": "199.00", "manual": "22.00"},
        "pack_sales": [
            {
                "package_id": str(w.pack10.id),
                "name": "Pack 10h",
                "count": 1,
                "amount": "100.00",
                "hours": "10.00",
            },
            {
                "package_id": str(w.pack5.id),
                "name": "Pack 5h",
                "count": 1,
                "amount": "55.00",
                "hours": "5.00",
            },
        ],
        "hourly": {"count": 3, "amount": "33.00", "hours": "3.00"},
        "mixed": {"count": 1, "amount": "11.00", "hours": "1.00"},
        "manual": {"count": 1, "amount": "22.00", "hours": "2.00"},
        "transactions_count": 7,
        "ana": {"amount": "88.00", "hours": "8.00", "transactions_count": 4},
        "bruno": {"amount": "133.00", "hours": "13.00", "transactions_count": 3},
    }
    return w
