"""H03 — the operator's "Alterar horário", the two ways it really failed.

(a) A booking paid with pack hours could not be shortened: the duration was
    recomputed but not the pack share, so the CHECK constraint fired at flush
    and the API answered with a misleading conflict. Now the share is settled
    through the hour bank: shrinking credits the surplus back, growing draws
    the extra from the bank and reports what it could not cover.
(b) A booking that had already started could not be edited at all: the
    past-start rule applied even when only the end (or the room) changed.
    Now an operator may keep an original start that is in the past.
Money never moves here, in either direction.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import clock
from app.models.booking import Booking, BookingStatus
from app.models.package import BookingPackageDebit, Package, PurchaseStatus, UserPackagePurchase
from app.models.space import AvailabilityRule, Room
from sqlalchemy import select

API = "/api/v1"
RATE = Decimal("11.00")

pytestmark = pytest.mark.usefixtures("test_member")


def _monday(days_out: int = 14, hour: int = 9) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    day = today + timedelta(days=days_ahead + days_out)
    return datetime.combine(day, time(hour, 0), tzinfo=UTC)


def _pin(monkeypatch, at: datetime) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: at)


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


@pytest_asyncio.fixture
async def pack(db_session, test_org) -> Package:
    p = Package(
        org_id=test_org.id, name="Pack 10h", hours=10, price=Decimal("100.00"), validity_days=180
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


async def _purchase(db_session, *, org, user, package, hours: str, expires_in_days: int):
    now = datetime.now(tz=UTC)
    purchase = UserPackagePurchase(
        user_id=user.id,
        package_id=package.id,
        org_id=org.id,
        hours_total=Decimal(hours),
        hours_used=Decimal(0),
        hours_remaining=Decimal(hours),
        purchased_at=now,
        expires_at=now + timedelta(days=expires_in_days),
        status=PurchaseStatus.active,
    )
    db_session.add(purchase)
    await db_session.commit()
    await db_session.refresh(purchase)
    return purchase


@pytest_asyncio.fixture
async def second_room(db_session, test_org, test_space) -> Room:
    r = Room(
        space_id=test_space.id,
        org_id=test_org.id,
        name="Sala B",
        capacity=2,
        hourly_rate=Decimal("15.00"),
        color="#B8D4E8",
        images=[],
        amenities=[],
    )
    db_session.add(r)
    await db_session.flush()
    for day in range(6):
        db_session.add(
            AvailabilityRule(
                room_id=r.id, day_of_week=day, open_time=time(8, 0), close_time=time(20, 0)
            )
        )
    await db_session.commit()
    await db_session.refresh(r)
    return r


@pytest_asyncio.fixture
async def a_two(db_session, test_org, test_user, pack):
    return await _purchase(
        db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=5
    )


@pytest_asyncio.fixture
async def b_ten(db_session, test_org, test_user, pack):
    return await _purchase(
        db_session, org=test_org, user=test_user, package=pack, hours="10", expires_in_days=60
    )


async def _book(client, headers, room, start: datetime, hours: int, method="mixed"):
    resp = await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": method,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["booking"]


async def _move(client, admin_headers, test_org, booking_id, start: datetime, hours: int, **extra):
    return await client.put(
        f"{API}/admin/bookings/{booking_id}",
        params=_org(test_org),
        json={
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            **extra,
        },
        headers=admin_headers,
    )


async def _balance(db_session, purchase) -> tuple[Decimal, Decimal]:
    row = (
        await db_session.execute(
            select(UserPackagePurchase)
            .where(UserPackagePurchase.id == purchase.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert row.hours_used + row.hours_remaining == row.hours_total
    return row.hours_remaining, row.hours_used


async def _debits(db_session, booking_id) -> dict[uuid.UUID, Decimal]:
    rows = (
        await db_session.execute(
            select(BookingPackageDebit)
            .where(BookingPackageDebit.booking_id == uuid.UUID(str(booking_id)))
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return {d.purchase_id: d.hours for d in rows}


async def _db_booking(db_session, booking_id) -> Booking:
    return (
        await db_session.execute(
            select(Booking)
            .where(Booking.id == uuid.UUID(str(booking_id)))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


class TestShrinkingAPackBooking:
    async def test_the_reproduction_nine_pack_hours_moved_to_six(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        """09:00-18:00 paid with 9h of pack (2 from A, 7 from B), moved to
        09:00-15:00: the three surplus hours go back — from B, the last drawn,
        so A's sooner-lapsing hours stay spent — and nothing else changes."""
        booking = await _book(client, auth_headers, test_room, _monday(), hours=9)
        assert booking["payment_method"] == "package"
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(7),
        }

        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(), hours=6)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["hours"] == {"before": "9.00", "after": "6.00"}
        assert "uncovered" not in body["hours"]
        assert Decimal(body["booking"]["package_hours_used"]) == Decimal(6)
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(4),
        }
        assert await _balance(db_session, a_two) == (Decimal(0), Decimal(2))
        assert await _balance(db_session, b_ten) == (Decimal(6), Decimal(4))
        stored = await _db_booking(db_session, booking["id"])
        assert stored.duration_hours == Decimal(6)
        # The slot's value is recorded as before; no money moved.
        assert stored.total_amount == 9 * RATE

    async def test_shrinking_past_the_last_drawn_purchase_frees_the_earlier_one_too(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), hours=9)
        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(), hours=1)
        assert resp.status_code == 200, resp.text
        # B's seven all come back and one of A's two: the surviving hour is A's.
        assert await _debits(db_session, booking["id"]) == {a_two.id: Decimal(1)}
        assert await _balance(db_session, a_two) == (Decimal(1), Decimal(1))
        assert await _balance(db_session, b_ten) == (Decimal(10), Decimal(0))

    async def test_a_mixed_booking_keeps_its_money_and_returns_only_the_pack_hours_past_the_new_end(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, payments, b_ten
    ):
        # 10h pack + 1h money, 12h → shrink to 8h: the pack share drops to 8,
        # two hours go back to B; the 11,00 € charged stays charged.
        booking = await _book(client, auth_headers, test_room, _monday(hour=8), hours=12)
        assert booking["payment_method"] == "mixed"
        assert Decimal(booking["total_amount"]) == 2 * RATE
        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(hour=8), hours=8)
        assert resp.status_code == 200, resp.text
        assert resp.json()["hours"] == {"before": "12.00", "after": "8.00"}
        stored = await _db_booking(db_session, booking["id"])
        assert stored.package_hours_used == Decimal(8)
        assert stored.total_amount == 2 * RATE
        assert await _balance(db_session, b_ten) == (Decimal(2), Decimal(8))
        assert len(payments.sessions) == 1


class TestGrowingAPackBooking:
    async def test_growing_draws_the_extra_from_the_bank(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), hours=5)  # A2 + B3
        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(), hours=7)
        assert resp.status_code == 200, resp.text
        assert resp.json()["hours"] == {"before": "5.00", "after": "7.00"}
        assert Decimal(resp.json()["booking"]["package_hours_used"]) == Decimal(7)
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(5),
        }
        assert await _balance(db_session, b_ten) == (Decimal(5), Decimal(5))

    async def test_what_the_bank_cannot_cover_is_reported_not_charged(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), hours=9)  # A2 + B7
        # Bank left: 3h on B. Growing by 5 covers 3 and leaves 2 for a person.
        resp = await _move(
            client, admin_headers, test_org, booking["id"], _monday(hour=8), hours=14
        )
        assert resp.status_code == 400  # 08:00-22:00 is outside the room's hours
        resp = await _move(
            client, admin_headers, test_org, booking["id"], _monday(hour=8), hours=12
        )
        assert resp.status_code == 200, resp.text
        # 12h: 9 were pack; 3 extra, bank gives its 3 → all covered.
        assert resp.json()["hours"] == {"before": "9.00", "after": "12.00"}
        assert await _balance(db_session, b_ten) == (Decimal(0), Decimal(10))

        # Now nothing is left in the bank: a further hour is uncovered. Move
        # back first to 11h (returns one hour), then to 12h with an empty bank
        # after spending it elsewhere.
        shrink = await _move(
            client, admin_headers, test_org, booking["id"], _monday(hour=8), hours=11
        )
        assert shrink.status_code == 200, shrink.text
        assert await _balance(db_session, b_ten) == (Decimal(1), Decimal(9))
        other = await _book(client, auth_headers, test_room, _monday(days_out=15), hours=1)
        assert other["payment_method"] == "package"
        grow = await _move(
            client, admin_headers, test_org, booking["id"], _monday(hour=8), hours=12
        )
        assert grow.status_code == 200, grow.text
        assert grow.json()["hours"] == {"before": "11.00", "after": "12.00", "uncovered": "1.00"}
        stored = await _db_booking(db_session, booking["id"])
        assert stored.duration_hours == Decimal(12)
        assert stored.package_hours_used == Decimal(11)
        assert stored.total_amount == 9 * RATE  # untouched: no money movement
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(9),
        }

    async def test_an_hourly_booking_is_reported_as_before_and_touches_no_pack(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, b_ten, payments
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), hours=2, method="hourly")
        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(), hours=3)
        assert resp.status_code == 200, resp.text
        assert resp.json()["hours"] == {"before": "2.00", "after": "3.00"}
        assert await _balance(db_session, b_ten) == (Decimal(10), Decimal(0))
        assert await _debits(db_session, booking["id"]) == {}


class TestEditingABookingThatHasStarted:
    async def test_changing_only_the_end_of_a_booking_in_progress(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch, b_ten
    ):
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=3)
        # Half past nine, the booking runs 09:00-12:00: shorten it to 11:00.
        _pin(monkeypatch, start + timedelta(minutes=30))
        resp = await _move(client, admin_headers, test_org, booking["id"], start, hours=2)
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["end_time"].startswith(
            (start + timedelta(hours=2)).strftime("%Y-%m-%dT%H")
        )

    async def test_changing_the_room_of_a_booking_in_progress(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        monkeypatch,
        b_ten,
        second_room,
    ):
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=3)
        _pin(monkeypatch, start + timedelta(minutes=30))
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"room_id": str(second_room.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["room_id"] == str(second_room.id)

    async def test_the_new_end_must_still_lie_ahead(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch, b_ten
    ):
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=3)
        _pin(monkeypatch, start + timedelta(hours=2, minutes=30))
        resp = await _move(client, admin_headers, test_org, booking["id"], start, hours=2)
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == "end_time cannot be in the past"

    async def test_moving_the_start_earlier_than_now_is_still_refused(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch, b_ten
    ):
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=3)
        _pin(monkeypatch, start + timedelta(minutes=30))
        resp = await _move(
            client, admin_headers, test_org, booking["id"], start - timedelta(hours=1), hours=4
        )
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == "start_time cannot be in the past"

    async def test_a_start_between_the_original_and_now_is_allowed(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch, b_ten
    ):
        """Keeping what has already happened honest: an operator may say the
        session actually began later than booked, as long as it is not moved
        to before it was booked for."""
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=3)
        _pin(monkeypatch, start + timedelta(hours=1, minutes=30))
        resp = await _move(
            client, admin_headers, test_org, booking["id"], start + timedelta(hours=1), hours=2
        )
        assert resp.status_code == 200, resp.text

    async def test_the_customer_path_stays_strict(
        self, client, auth_headers, test_room, monkeypatch, b_ten
    ):
        start = _monday()
        _pin(monkeypatch, start + timedelta(minutes=30))
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "payment_method": "mixed",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "start_time cannot be in the past"

    async def test_a_conflict_with_another_booking_is_still_409(
        self, client, auth_headers, admin_headers, test_org, test_room, monkeypatch, b_ten
    ):
        start = _monday()
        booking = await _book(client, auth_headers, test_room, start, hours=2)
        await _book(client, auth_headers, test_room, start + timedelta(hours=3), hours=1)
        _pin(monkeypatch, start + timedelta(minutes=30))
        resp = await _move(client, admin_headers, test_org, booking["id"], start, hours=4)
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"] == "This time slot is already booked"


class TestNoFiveHundreds:
    async def test_a_constraint_the_settle_could_not_prevent_is_a_409_with_detail(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, b_ten,
        monkeypatch,
    ):  # fmt: skip
        """Belt and braces: if anything still trips a CHECK at flush, the
        operator gets a conflict naming it, never a server error."""
        from app.routers import admin as admin_router

        booking = await _book(client, auth_headers, test_room, _monday(), hours=3)

        async def broken_settle(*args, **kwargs):
            stored = kwargs.get("booking") or args[1]
            stored.package_hours_used = Decimal(99)
            return Decimal(0)

        monkeypatch.setattr(admin_router.package_hours, "settle_moved_booking", broken_settle)
        resp = await _move(client, admin_headers, test_org, booking["id"], _monday(), hours=2)
        assert resp.status_code == 409, resp.text
        assert "ck_bookings_package_hours_used_within_duration" in resp.json()["detail"]
        # Nothing was written.
        assert (await _db_booking(db_session, booking["id"])).duration_hours == Decimal(3)
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.confirmed
