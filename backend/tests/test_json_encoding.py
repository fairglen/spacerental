"""P2.3: ORJSONResponse is the default — the wire format must not move.

Money stays a two-decimal string, ids strings, instants ISO-8601 with an
explicit offset, and the HTML stub page is still HTML.
"""

import re
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.booking import Booking, BookingStatus, PaymentMethod
from fastapi.responses import ORJSONResponse

# Pydantic's JSON mode writes UTC as `Z` (the rows); a plain isoformat writes
# `+00:00` (the availability slots). Both predate orjson and both must stay.
ISO_WITH_OFFSET = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def test_the_default_response_class_is_orjson():
    from app.main import app

    assert app.router.default_response_class is ORJSONResponse


class TestWireFormat:
    async def test_a_booking_row_and_a_room_keep_their_types(
        self, client, auth_headers, test_member, test_room, test_user, test_space, db_session
    ):
        start = (datetime.now(UTC) + timedelta(days=2)).replace(
            hour=10, minute=0, second=0, microsecond=0
        )
        db_session.add(
            Booking(
                org_id=test_room.org_id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                duration_hours=Decimal("1.50"),
                total_amount=Decimal("16.50"),
                status=BookingStatus.confirmed,
                payment_method=PaymentMethod.manual,
            )
        )
        await db_session.commit()

        resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/json"
        [row] = resp.json()["bookings"]
        assert row["total_amount"] == "16.50"
        assert row["duration_hours"] == "1.50"
        assert row["room"]["hourly_rate"] == "11.00"
        assert UUID.match(row["id"]) and UUID.match(row["room_id"])
        assert ISO_WITH_OFFSET.match(row["start_time"]), row["start_time"]
        assert ISO_WITH_OFFSET.match(row["created_at"]), row["created_at"]

        resp = await client.get(f"/api/v1/spaces/{test_space.id}")
        [room] = resp.json()["rooms"]
        assert room["hourly_rate"] == "11.00"
        assert room["capacity"] == 4
        assert room["is_active"] is True
        assert room["availability_rules"][0]["open_time"] == "08:00:00"

    async def test_errors_and_health_are_json_too(self, client):
        resp = await client.get("/api/v1/bookings/me")
        assert resp.status_code == 401
        assert resp.headers["content-type"] == "application/json"
        assert resp.json() == {"detail": "Not authenticated"}
        resp = await client.get("/health")
        assert resp.headers["content-type"] == "application/json"
        assert resp.json() == {"status": "ok"}

    async def test_the_stub_checkout_page_is_still_html(
        self, client, auth_headers, test_member, test_room, payments
    ):
        # A real stub session: the page route declares HTMLResponse and must
        # keep it while JSON is the default elsewhere.
        day = datetime.now(UTC) + timedelta(days=2)
        while day.weekday() == 6:  # the test room is closed on Sundays
            day += timedelta(days=1)
        start = day.replace(hour=10, minute=0, second=0, microsecond=0)
        created = await client.post(
            "/api/v1/bookings",
            headers=auth_headers,
            json={
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
        )
        assert created.status_code == 201, created.text
        checkout_url = created.json()["checkout_url"]
        assert checkout_url
        resp = await client.get(checkout_url.replace("http://test", ""))
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        # And a missing session is a JSON 404, as every error is.
        resp = await client.get("/checkout/stub/cs_stub_does_not_exist")
        assert resp.status_code == 404
        assert resp.headers["content-type"] == "application/json"
