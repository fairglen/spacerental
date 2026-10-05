"""P1.1: the three key reads on a 10 000-booking organisation.

Each test records bytes per row, SQL statements per request (and how many of
them write), the planner's choice for the query behind the list, and the
in-process latency (median of five). The deterministic numbers are asserted
against BUDGET — the baseline measured on b57f30c, which the P2 tasks lower;
latencies are recorded only, they belong to the machine.

Run with `pytest -m perf`; the default run deselects this module (pytest.ini).
"""

import statistics
from datetime import UTC, datetime, timedelta
from time import perf_counter

import pytest
from tests.perf.conftest import headers_for, plan_nodes, writes

pytestmark = pytest.mark.perf

# Measured, not wished. Baseline on b57f30c (2026-10-05): /bookings/me 2 340
# B/row with 4 statements of which one UPDATE, the admin list 2 530 B/row
# with 7 statements over a Seq Scan, availability 5 statements. After P2.2
# (room summary, null optionals and updated_at out of list rows, the
# read-first expiry): 587 and 771 B/row, no write on a read. P2.3 lowers the
# statements (the JWT lookup) and changes the admin list's plan (the index).
BUDGET = {
    "bookings_me": {"bytes_per_row": 587, "statements": 4, "writes": 0},
    "admin_bookings": {"bytes_per_row": 771, "statements": 7},
    "availability": {"statements": 5},
}


async def timed(client, url: str, headers: dict | None, sql_log: list[str], runs: int = 5):
    """`runs` requests; the response and statements are the last request's."""
    durations = []
    response = None
    for _ in range(runs):
        sql_log.clear()
        started = perf_counter()
        response = await client.get(url, headers=headers)
        durations.append((perf_counter() - started) * 1000)
    assert response is not None
    return response, round(statistics.median(durations), 1)


async def test_my_bookings(client, big_org, sql_log, perf_results, db_session):
    customer = big_org.users[0]
    response, p50 = await timed(client, "/api/v1/bookings/me", headers_for(customer), sql_log)
    assert response.status_code == 200
    rows = response.json()["bookings"]
    assert len(rows) == big_org.per_customer
    metrics = {
        "rows": len(rows),
        "bytes": len(response.content),
        # On the wire (P2.1: gzip when the client accepts it; httpx does by default).
        "wire_bytes": response.num_bytes_downloaded,
        "bytes_per_row": len(response.content) // len(rows),
        "statements": len(sql_log),
        "writes": len(writes(sql_log)),
        "p50_ms": p50,
        "plan": await plan_nodes(
            db_session,
            "SELECT * FROM bookings WHERE user_id = :user_id ORDER BY start_time DESC",
            {"user_id": customer.id},
        ),
    }
    perf_results["bookings_me"] = metrics
    print("\nGET /bookings/me", metrics)
    budget = BUDGET["bookings_me"]
    assert metrics["bytes_per_row"] <= budget["bytes_per_row"]
    assert metrics["statements"] <= budget["statements"]
    assert metrics["writes"] <= budget["writes"]


async def test_admin_bookings_list(
    client, big_org, admin_headers, sql_log, perf_results, db_session
):
    url = f"/api/v1/admin/bookings?org_id={big_org.org.id}&page_size=100"
    response, p50 = await timed(client, url, admin_headers, sql_log)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == big_org.count
    rows = body["bookings"]
    assert len(rows) == 100
    metrics = {
        "rows": len(rows),
        "total": body["total"],
        "bytes": len(response.content),
        # On the wire (P2.1: gzip when the client accepts it; httpx does by default).
        "wire_bytes": response.num_bytes_downloaded,
        "bytes_per_row": len(response.content) // len(rows),
        "statements": len(sql_log),
        "writes": len(writes(sql_log)),
        "p50_ms": p50,
        "plan": await plan_nodes(
            db_session,
            "SELECT * FROM bookings WHERE org_id = :org_id "
            "ORDER BY start_time DESC, id DESC LIMIT 100",
            {"org_id": big_org.org.id},
        ),
    }
    perf_results["admin_bookings"] = metrics
    print("\nGET /admin/bookings", metrics)
    budget = BUDGET["admin_bookings"]
    assert metrics["bytes_per_row"] <= budget["bytes_per_row"]
    assert metrics["statements"] <= budget["statements"]


async def test_availability(client, big_org, sql_log, perf_results):
    room = big_org.rooms[0]
    day = (datetime.now(UTC) + timedelta(days=3)).date()
    response, p50 = await timed(
        client, f"/api/v1/rooms/{room.id}/availability?date={day.isoformat()}", None, sql_log
    )
    assert response.status_code == 200
    slots = response.json()["slots"]
    assert len(slots) == 14
    metrics = {
        "slots": len(slots),
        "bytes": len(response.content),
        # On the wire (P2.1: gzip when the client accepts it; httpx does by default).
        "wire_bytes": response.num_bytes_downloaded,
        "statements": len(sql_log),
        "writes": len(writes(sql_log)),
        "p50_ms": p50,
    }
    perf_results["availability"] = metrics
    print("\nGET /rooms/{id}/availability", metrics)
    assert metrics["statements"] <= BUDGET["availability"]["statements"]
