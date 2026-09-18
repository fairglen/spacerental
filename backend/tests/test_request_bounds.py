"""S09: hostile input is refused with a client error, never answered with a 500.

Almost no request field carried a bound, so over-long, out-of-range or
unstorable input reached PostgreSQL or date arithmetic and came back as a
server error. Each sweep below sends a family of such requests for one
audience and lists every offender, so a single run shows the whole picture.

`REFUSED` cases must be answered 4xx. `TOLERATED` cases are odd but valid
requests that only have to stay below 500.
"""

import uuid
from datetime import UTC, datetime, time, timedelta

import pytest_asyncio
from app.config import settings
from app.main import app
from app.routers import recurrences
from httpx import ASGITransport, AsyncClient

API = "/api/v1"
NUL = chr(0)
LONG = "x" * 300
HUGE = "x" * 200_000
INT32 = 2**31
REFUSED, TOLERATED = "refused", "tolerated"


def _monday(hour: int) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days_ahead + 7), time(hour, 0), tzinfo=UTC)


def _slot(hour: int) -> dict:
    start = _monday(hour)
    return {"start_time": start.isoformat(), "end_time": (start + timedelta(hours=1)).isoformat()}


@pytest_asyncio.fixture
async def soft_client(client):
    """The same app and overrides as `client`, but a crash comes back as a 500
    response instead of propagating, so a sweep can evaluate every case."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _sweep(soft_client, cases, **common) -> list[str]:
    offenders = []
    for label, expectation, method, path, kwargs in cases:
        merged = {**common, **kwargs}
        if "params" in common and "params" in kwargs:
            merged["params"] = {**common["params"], **kwargs["params"]}
        resp = await soft_client.request(method, path, **merged)
        refused = 400 <= resp.status_code < 500
        if resp.status_code >= 500 or (expectation == REFUSED and not refused):
            offenders.append(f"{label}: {method} {path} -> {resp.status_code}")
    return offenders


async def test_anonymous_input_is_refused_not_crashed(
    soft_client, test_org, test_room, monkeypatch
):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
    availability = f"{API}/rooms/{test_room.id}/availability"

    def register(email: str, name: str, operator: bool = False) -> tuple:
        path = f"{API}/auth/register/operator" if operator else f"{API}/auth/register"
        return ("POST", path, {"json": {"email": email, "password": "password123", "name": name}})

    cases = [
        ("register, 300-char name", REFUSED, *register("long@test.com", LONG)),
        ("operator register, 300-char name", REFUSED, *register("long-op@test.com", LONG, True)),
        ("register, 200k-char name", REFUSED, *register("huge@test.com", HUGE)),
        ("register, NUL in name", REFUSED, *register("nul@test.com", f"a{NUL}b")),
        ("operator register, NUL in name", REFUSED, *register("nul-op@test.com", f"a{NUL}b", True)),
        (
            "login, NUL in the address",
            REFUSED,
            "POST",
            f"{API}/auth/login",
            {"json": {"email": f"a{NUL}b@test.com", "password": "password123"}},
        ),
        (
            "availability, year 9999",
            TOLERATED,
            "GET",
            availability,
            {"params": {"date": "9999-12-31"}},
        ),
        (
            "availability, year 1",
            TOLERATED,
            "GET",
            availability,
            {"params": {"date": "0001-01-01"}},
        ),
        (
            "packages of an unknown org",
            TOLERATED,
            "GET",
            f"{API}/packages",
            {"params": {"org_id": str(uuid.uuid4())}},
        ),
    ]
    assert await _sweep(soft_client, cases) == []


async def test_customer_input_is_refused_not_crashed(
    soft_client, auth_headers, test_member, test_room, payments, monkeypatch
):
    monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", True)
    room = {"room_id": str(test_room.id)}
    far = {**room, "start_time": "9999-12-31T22:00:00Z", "end_time": "9999-12-31T23:00:00Z"}
    until = (_monday(16) + timedelta(days=7)).date().isoformat()
    cases = [
        (
            "booking, 200k-char notes",
            REFUSED,
            "POST",
            f"{API}/bookings",
            {"json": {**room, **_slot(10), "notes": HUGE}},
        ),
        (
            "booking, NUL in notes",
            REFUSED,
            "POST",
            f"{API}/bookings",
            {"json": {**room, **_slot(12), "notes": f"a{NUL}b"}},
        ),
        ("booking, year 9999", REFUSED, "POST", f"{API}/bookings", {"json": far}),
        (
            "series, year 9999 anchor",
            REFUSED,
            "POST",
            f"{API}/recurrences",
            {"json": {**far, "until_date": "9999-12-31"}},
        ),
        (
            "series, until year 9999",
            REFUSED,
            "POST",
            f"{API}/recurrences",
            {"json": {**room, **_slot(14), "until_date": "9999-12-31"}},
        ),
        (
            "series, 200k-char notes",
            REFUSED,
            "POST",
            f"{API}/recurrences",
            {"json": {**room, **_slot(16), "until_date": until, "notes": HUGE}},
        ),
        (
            "series, NUL in notes",
            REFUSED,
            "POST",
            f"{API}/recurrences",
            {"json": {**room, **_slot(17), "until_date": until, "notes": f"a{NUL}b"}},
        ),
    ]
    assert await _sweep(soft_client, cases, headers=auth_headers) == []


async def test_operator_input_is_refused_not_crashed(
    soft_client, admin_headers, admin_user, test_org, test_space, test_room
):
    spaces = f"{API}/admin/spaces"
    space = f"{spaces}/{test_space.id}"
    rooms = f"{space}/rooms"
    room = f"{API}/admin/rooms/{test_room.id}"
    rules = f"{room}/availability"
    packages = f"{API}/admin/packages"
    new_room = {"name": "Sala", "hourly_rate": "10.00"}
    new_pack = {"name": "Pack", "hours": 10, "price": "100.00"}
    rule = {"day_of_week": 0, "open_time": "08:00", "close_time": "20:00"}
    cases = [
        ("space, 300-char name", REFUSED, "POST", spaces, {"json": {"name": LONG}}),
        ("space, empty name", REFUSED, "POST", spaces, {"json": {"name": ""}}),
        (
            "space, 200-char city",
            REFUSED,
            "POST",
            spaces,
            {"json": {"name": "S", "city": "c" * 200}},
        ),
        ("space, NUL in name", REFUSED, "POST", spaces, {"json": {"name": f"a{NUL}b"}}),
        (
            "space, NUL in an amenity",
            REFUSED,
            "POST",
            spaces,
            {"json": {"name": "S", "amenities": [f"wi{NUL}fi"]}},
        ),
        (
            "space, 500 amenities",
            REFUSED,
            "POST",
            spaces,
            {"json": {"name": "S", "amenities": ["a"] * 500}},
        ),
        (
            "space, javascript: image",
            REFUSED,
            "POST",
            spaces,
            {"json": {"name": "S", "images": ["javascript:alert(1)"]}},
        ),
        ("space update, null name", REFUSED, "PUT", space, {"json": {"name": None}}),
        ("space update, null images", REFUSED, "PUT", space, {"json": {"images": None}}),
        ("room, 300-char name", REFUSED, "POST", rooms, {"json": {**new_room, "name": LONG}}),
        (
            "room, 50-char color",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "color": "#" + "f" * 49}},
        ),
        (
            "room, color that is not hex",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "color": "red;x:y"}},
        ),
        (
            "room, rate above the column",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "hourly_rate": "1e12"}},
        ),
        (
            "room, negative rate",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "hourly_rate": "-5.00"}},
        ),
        (
            "room, rate with three decimals",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "hourly_rate": "10.005"}},
        ),
        ("room, rate NaN", REFUSED, "POST", rooms, {"json": {**new_room, "hourly_rate": "NaN"}}),
        (
            "room, rate Infinity",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "hourly_rate": "Infinity"}},
        ),
        (
            "room, capacity above int32",
            REFUSED,
            "POST",
            rooms,
            {"json": {**new_room, "capacity": INT32}},
        ),
        ("room, capacity zero", REFUSED, "POST", rooms, {"json": {**new_room, "capacity": 0}}),
        (
            "room update, rate above the column",
            REFUSED,
            "PUT",
            room,
            {"json": {"hourly_rate": "1e12"}},
        ),
        ("room update, negative rate", REFUSED, "PUT", room, {"json": {"hourly_rate": "-5.00"}}),
        ("room update, capacity above int32", REFUSED, "PUT", room, {"json": {"capacity": INT32}}),
        ("room update, null name", REFUSED, "PUT", room, {"json": {"name": None}}),
        ("room update, null rate", REFUSED, "PUT", room, {"json": {"hourly_rate": None}}),
        ("room update, null is_active", REFUSED, "PUT", room, {"json": {"is_active": None}}),
        (
            "rules, weekday above int32",
            REFUSED,
            "POST",
            rules,
            {"json": {"rules": [{**rule, "day_of_week": INT32}]}},
        ),
        (
            "rules, weekday 7",
            REFUSED,
            "POST",
            rules,
            {"json": {"rules": [{**rule, "day_of_week": 7}]}},
        ),
        (
            "rules, closing before opening",
            REFUSED,
            "POST",
            rules,
            {"json": {"rules": [{**rule, "open_time": "20:00", "close_time": "08:00"}]}},
        ),
        ("rules, 500 of them", REFUSED, "POST", rules, {"json": {"rules": [rule] * 500}}),
        ("package, 300-char name", REFUSED, "POST", packages, {"json": {**new_pack, "name": LONG}}),
        (
            "package, hours above int32",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "hours": INT32}},
        ),
        ("package, 5000 hours", REFUSED, "POST", packages, {"json": {**new_pack, "hours": 5000}}),
        ("package, zero hours", REFUSED, "POST", packages, {"json": {**new_pack, "hours": 0}}),
        (
            "package, price above the column",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "price": "1e12"}},
        ),
        (
            "package, negative price",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "price": "-1.00"}},
        ),
        (
            "package, validity above int32",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "validity_days": INT32}},
        ),
        (
            "package, a billion validity days",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "validity_days": 10**9}},
        ),
        (
            "package, zero validity days",
            REFUSED,
            "POST",
            packages,
            {"json": {**new_pack, "validity_days": 0}},
        ),
        (
            "bookings list, page beyond int64",
            REFUSED,
            "GET",
            f"{API}/admin/bookings",
            {"params": {"page": 10**19}},
        ),
        (
            "bookings list, year-9999 window",
            TOLERATED,
            "GET",
            f"{API}/admin/bookings",
            {"params": {"from": "9999-12-31T23:59:59Z", "to": "9999-12-31T23:59:59Z"}},
        ),
    ]
    offenders = await _sweep(
        soft_client, cases, headers=admin_headers, params={"org_id": str(test_org.id)}
    )
    assert offenders == []


async def test_control_ordinary_operator_input_is_still_accepted(
    client, admin_headers, admin_user, test_org, test_space, test_room
):
    # The bounds are generous technical limits: nothing a real operator types
    # may start failing because of them.
    org = {"org_id": str(test_org.id)}
    space = await client.post(
        f"{API}/admin/spaces",
        params=org,
        headers=admin_headers,
        json={
            "name": "Espaço Calmo — Príncipe Real",
            "description": "Três salas insonorizadas.\nLuz natural.",
            "address": "Rua da Escola Politécnica, 42",
            "city": "Lisboa",
            "amenities": ["Wi-Fi", "Ar condicionado"],
            "images": ["https://images.example.com/sala.jpg"],
        },
    )
    assert space.status_code == 201, space.text
    room = await client.post(
        f"{API}/admin/spaces/{test_space.id}/rooms",
        params=org,
        headers=admin_headers,
        json={"name": "Sala Serena", "capacity": 6, "hourly_rate": "0.00", "color": "#A8D5BA"},
    )
    assert room.status_code == 201, room.text
    cleared = await client.put(
        f"{API}/admin/spaces/{test_space.id}",
        params=org,
        headers=admin_headers,
        json={"description": None, "city": None},
    )
    assert cleared.status_code == 200, cleared.text
    package = await client.post(
        f"{API}/admin/packages",
        params=org,
        headers=admin_headers,
        json={"name": "Pack 999h", "hours": 999, "price": "99999999.99", "validity_days": 3650},
    )
    assert package.status_code == 201, package.text
    rules = await client.post(
        f"{API}/admin/rooms/{test_room.id}/availability",
        params=org,
        headers=admin_headers,
        json={
            "rules": [
                {"day_of_week": 6, "open_time": "00:00", "close_time": "23:00"},
                {"day_of_week": 0, "open_time": "08:00", "close_time": "13:00"},
                {"day_of_week": 0, "open_time": "14:00", "close_time": "20:00"},
            ]
        },
    )
    assert rules.status_code in (200, 201), rules.text
