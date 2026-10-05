"""Fixtures for the `perf` marker (P1.1).

A 10 000-booking organisation built with bulk inserts, a per-request SQL
statement log hooked on the test engine, and a results file so the numbers a
run produced can be quoted in a PR without re-reading the log.
"""

import json
import os
import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.space import AvailabilityRule, Room
from app.models.user import User
from sqlalchemy import event, insert, text

BOOKINGS = 10_000
CUSTOMERS = 200
ROOMS = 3
OPEN_HOUR, CLOSE_HOUR = 8, 22
RESULTS_FILE = os.environ.get("PERF_RESULTS", "perf-results/api.json")

# Argon2 at the production parameters costs ~0.1 s a hash; the perf customers
# never log in, so one hash serves all of them.
_PASSWORD_HASH = hash_password("password123")


def headers_for(user: User, role: str = "member") -> dict[str, str]:
    token = create_access_token(
        {"sub": str(user.id), "email": user.email, "name": user.name, "role": role}
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def big_org(db_session, test_org, test_space):
    """`test_org` with 3 rooms open every day 08-22, 200 customers and 10 000
    one-hour bookings: every open hour of every room from 120 days ago onwards,
    one customer in ten cancelled, so each customer owns 50 rows."""
    rooms = [
        Room(
            space_id=test_space.id,
            org_id=test_org.id,
            name=f"Sala {i + 1}",
            description="Gabinete tranquilo e acolhedor, preparado para consultas individuais.",
            capacity=4,
            hourly_rate=Decimal("11.00"),
            color="#A8D5BA",
            images=[],
            amenities=["WiFi", "Quadro branco", "Ecrã"],
        )
        for i in range(ROOMS)
    ]
    db_session.add_all(rooms)
    await db_session.flush()
    # Four photos a room, as the seed gives the demo rooms: a booking row
    # carries its room, and the room carries these, so the row size the owner
    # measured (≈2.4 KB) only shows up with them.
    for room in rooms:
        room.photos = [
            {
                "id": str(uuid.uuid4()),
                "key": f"rooms/{room.id}/{uuid.uuid4().hex}.webp",
                "thumb_key": f"rooms/{room.id}/{uuid.uuid4().hex}_thumb.webp",
                "width": 1600,
                "height": 1200,
            }
            for _ in range(4)
        ]
    db_session.add_all(
        AvailabilityRule(
            room_id=room.id,
            day_of_week=day,
            open_time=time(OPEN_HOUR),
            close_time=time(CLOSE_HOUR),
        )
        for room in rooms
        for day in range(7)
    )
    users = [
        User(email=f"perf-{i:04d}@test.com", name=f"Cliente {i}", password_hash=_PASSWORD_HASH)
        for i in range(CUSTOMERS)
    ]
    db_session.add_all(users)
    await db_session.flush()
    db_session.add_all(
        OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.member) for u in users
    )
    await db_session.commit()

    first_day = (datetime.now(UTC) - timedelta(days=120)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    hours_per_day = CLOSE_HOUR - OPEN_HOUR
    rows = []
    for i in range(BOOKINGS):
        slot, room_index = divmod(i, ROOMS)
        day, hour = divmod(slot, hours_per_day)
        start = first_day + timedelta(days=day, hours=OPEN_HOUR + hour)
        rows.append(
            {
                "org_id": test_org.id,
                "room_id": rooms[room_index].id,
                "user_id": users[i % CUSTOMERS].id,
                "start_time": start,
                "end_time": start + timedelta(hours=1),
                "duration_hours": Decimal("1.00"),
                "total_amount": Decimal("11.00"),
                "package_hours_used": Decimal(0),
                "status": BookingStatus.cancelled if i % 10 == 0 else BookingStatus.confirmed,
                "payment_method": PaymentMethod.hourly,
            }
        )
    for n in range(0, len(rows), 1000):
        await db_session.execute(insert(Booking), rows[n : n + 1000])
    await db_session.commit()
    # Statistics as autovacuum would leave them, so EXPLAIN plans for 10 000 rows.
    await db_session.execute(text("ANALYZE bookings"))
    await db_session.commit()
    return SimpleNamespace(
        org=test_org,
        space=test_space,
        rooms=rooms,
        users=users,
        count=len(rows),
        per_customer=BOOKINGS // CUSTOMERS,
    )


@pytest.fixture
def sql_log(engine) -> list[str]:
    """Every statement the app's sessions send, in order; `clear()` it before
    the request you want to count."""
    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    yield statements
    event.remove(engine.sync_engine, "before_cursor_execute", record)


def writes(statements: list[str]) -> list[str]:
    return [s for s in statements if s.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE"))]


async def plan_nodes(db_session, sql: str, params: dict) -> list[str]:
    """The planner's tree for `sql`, flattened to `Node Type [using index] [on table]`."""
    result = await db_session.execute(text(f"EXPLAIN (FORMAT JSON) {sql}"), params)
    plan = result.scalar_one()
    if isinstance(plan, str):
        plan = json.loads(plan)
    nodes: list[str] = []

    def walk(node: dict) -> None:
        label = node["Node Type"]
        if "Index Name" in node:
            label += f" using {node['Index Name']}"
        if "Relation Name" in node:
            label += f" on {node['Relation Name']}"
        nodes.append(label)
        for child in node.get("Plans", []):
            walk(child)

    walk(plan[0]["Plan"])
    return nodes


@pytest.fixture(scope="session")
def perf_results():
    """Collected metrics, merged into RESULTS_FILE when the session ends."""
    data: dict[str, dict] = {}
    yield data
    if not data:
        return
    os.makedirs(os.path.dirname(RESULTS_FILE) or ".", exist_ok=True)
    existing: dict = {}
    if os.path.exists(RESULTS_FILE):
        with open(RESULTS_FILE) as f:
            existing = json.load(f)
    existing.update(data)
    existing["measured_at"] = datetime.now(UTC).isoformat()
    with open(RESULTS_FILE, "w") as f:
        json.dump(existing, f, indent=2, default=str)
