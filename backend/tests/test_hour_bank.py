"""H02 — the hour bank: packs pooled, purchase history kept.

A booking draws on as many active, unexpired purchases as it needs, soonest-
expiring first, one `booking_package_debits` row each; money starts only when
the bank is empty. Every hour goes back to the exact purchase it came from
when the booking stops holding it. The invariant `hours_used + hours_remaining
== hours_total` is checked at every balance read.
"""

import asyncio
import importlib.util
import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from app import clock
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.package import BookingPackageDebit, Package, PurchaseStatus, UserPackagePurchase
from app.models.space import AvailabilityRule
from sqlalchemy import select, text

API = "/api/v1"
RATE = Decimal("11.00")  # conftest's test_room

pytestmark = pytest.mark.usefixtures("test_member")


def _monday(days_out: int = 14, hour: int = 8) -> datetime:
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


@pytest_asyncio.fixture
async def long_day(db_session, test_room) -> None:
    """Open the test room until 21:00 so a 13h block (08-21) fits in a day."""
    for day in range(6):
        db_session.add(
            AvailabilityRule(
                room_id=test_room.id, day_of_week=day, open_time=time(20, 0), close_time=time(21, 0)
            )
        )
    await db_session.commit()


async def _purchase(
    db_session,
    *,
    org,
    user,
    package,
    hours: str,
    expires_in_days: int = 30,
    status: PurchaseStatus = PurchaseStatus.active,
) -> UserPackagePurchase:
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
        status=status,
    )
    db_session.add(purchase)
    await db_session.commit()
    await db_session.refresh(purchase)
    return purchase


@pytest_asyncio.fixture
async def a_two(db_session, test_org, test_user, pack) -> UserPackagePurchase:
    """Pack A: 2h left, lapses first."""
    return await _purchase(
        db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=5
    )


@pytest_asyncio.fixture
async def b_ten(db_session, test_org, test_user, pack) -> UserPackagePurchase:
    """Pack B: 10h left, lapses later."""
    return await _purchase(
        db_session, org=test_org, user=test_user, package=pack, hours="10", expires_in_days=60
    )


async def _book(client, headers, room, start: datetime, hours: int, method="mixed"):
    return await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": method,
        },
        headers=headers,
    )


async def _balance(db_session, purchase) -> tuple[Decimal, Decimal]:
    """(remaining, used), with the ledger invariant checked on the way."""
    row = (
        await db_session.execute(
            select(UserPackagePurchase)
            .where(UserPackagePurchase.id == purchase.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert row.hours_used + row.hours_remaining == row.hours_total
    assert row.hours_remaining >= 0
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


class TestDrawingOnTheBank:
    async def test_five_hours_take_two_from_a_and_three_from_b(
        self, client, auth_headers, test_room, db_session, a_two, b_ten
    ):
        resp = await _book(client, auth_headers, test_room, _monday(), hours=5)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        booking = body["booking"]
        # The bank covers the block: no money, confirmed at once.
        assert booking["payment_method"] == "package"
        assert booking["status"] == "confirmed"
        assert body["checkout_url"] is None
        assert Decimal(booking["package_hours_used"]) == Decimal(5)
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(3),
        }
        assert await _balance(db_session, a_two) == (Decimal(0), Decimal(2))
        assert await _balance(db_session, b_ten) == (Decimal(7), Decimal(3))
        # The deprecated single link is no longer written.
        assert (await _db_booking(db_session, booking["id"])).package_purchase_id is None

    async def test_thirteen_hours_take_twelve_from_packs_and_charge_one(
        self, client, auth_headers, test_room, db_session, payments, long_day, a_two, b_ten
    ):
        resp = await _book(client, auth_headers, test_room, _monday(), hours=13)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        booking = body["booking"]
        assert booking["payment_method"] == "mixed"
        assert booking["status"] == "pending"
        assert Decimal(booking["package_hours_used"]) == Decimal(12)
        assert Decimal(booking["total_amount"]) == RATE
        assert body["checkout_url"]
        session = payments.sessions[f"cs_stub_{uuid.UUID(booking['id']).hex}"]
        assert session["amount_cents"] == 1100
        assert session["description"] == "1h Sala A (12h pagas com o pack)"
        assert await _debits(db_session, booking["id"]) == {
            a_two.id: Decimal(2),
            b_ten.id: Decimal(10),
        }
        assert await _balance(db_session, a_two) == (Decimal(0), Decimal(2))
        assert await _balance(db_session, b_ten) == (Decimal(0), Decimal(10))

    async def test_the_package_method_is_all_or_nothing_across_the_bank(
        self, client, auth_headers, test_room, db_session, test_org, test_user, pack
    ):
        a = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=5
        )
        b = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=60
        )
        resp = await _book(client, auth_headers, test_room, _monday(), hours=5, method="package")
        assert resp.status_code == 409, resp.text
        # Refused before anything was written: both balances exactly as they were.
        assert await _balance(db_session, a) == (Decimal(2), Decimal(0))
        assert await _balance(db_session, b) == (Decimal(2), Decimal(0))
        assert (await db_session.execute(select(BookingPackageDebit))).first() is None

    async def test_an_expired_pack_is_not_in_the_bank(
        self, client, auth_headers, test_room, db_session, test_org, test_user, pack, b_ten
    ):
        lapsed = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=-1
        )
        before = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert Decimal(before.json()["balance"]["hours_available"]) == Decimal(10)

        resp = await _book(client, auth_headers, test_room, _monday(), hours=5)
        assert resp.status_code == 201, resp.text
        assert await _debits(db_session, resp.json()["booking"]["id"]) == {b_ten.id: Decimal(5)}
        assert await _balance(db_session, lapsed) == (Decimal(2), Decimal(0))
        assert await _balance(db_session, b_ten) == (Decimal(5), Decimal(5))

    async def test_two_concurrent_bookings_cannot_overdraw_the_sum(
        self, client, auth_headers, test_room, db_session, payments, a_two, b_ten
    ):
        """Two 7h blocks against a 12h bank: whatever the interleaving, exactly
        12 hours leave the bank, no purchase goes negative, and each booking's
        debit rows add up to its own pack share."""
        first, second = await asyncio.gather(
            _book(client, auth_headers, test_room, _monday(hour=8), hours=7),
            _book(client, auth_headers, test_room, _monday(days_out=15, hour=8), hours=7),
        )
        assert first.status_code == 201, first.text
        assert second.status_code == 201, second.text
        bookings = [first.json()["booking"], second.json()["booking"]]
        used = sum(Decimal(b["package_hours_used"]) for b in bookings)
        assert used == Decimal(12)
        for b in bookings:
            debits = await _debits(db_session, b["id"])
            assert sum(debits.values(), Decimal(0)) == Decimal(b["package_hours_used"])
        remaining_a, used_a = await _balance(db_session, a_two)
        remaining_b, used_b = await _balance(db_session, b_ten)
        assert remaining_a + remaining_b == Decimal(0)
        assert used_a + used_b == Decimal(12)
        # One block was fully covered, the other paid for its uncovered 2h.
        assert sorted(b["payment_method"] for b in bookings) == ["mixed", "package"]


class TestHoursGoBackWhereTheyCameFrom:
    async def test_cancelling_restores_two_to_a_and_three_to_b_exactly(
        self, client, auth_headers, test_room, db_session, a_two, b_ten
    ):
        made = await _book(client, auth_headers, test_room, _monday(), hours=5)
        booking = made.json()["booking"]
        gone = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert gone.status_code == 204, gone.text
        assert await _balance(db_session, a_two) == (Decimal(2), Decimal(0))
        assert await _balance(db_session, b_ten) == (Decimal(10), Decimal(0))
        # The rows are gone; the split stays on the booking for the record.
        assert await _debits(db_session, booking["id"]) == {}
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.cancelled
        assert stored.package_hours_used == Decimal(5)

    async def test_a_lapsed_hold_restores_each_purchase(
        self, client, auth_headers, test_room, db_session, payments, long_day, a_two, b_ten,
        monkeypatch,
    ):  # fmt: skip
        made = await _book(client, auth_headers, test_room, _monday(), hours=13)
        assert made.status_code == 201, made.text
        booking = made.json()["booking"]
        assert await _balance(db_session, b_ten) == (Decimal(0), Decimal(10))

        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert Decimal(mine.json()["balance"]["hours_available"]) == Decimal(12)
        assert await _balance(db_session, a_two) == (Decimal(2), Decimal(0))
        assert await _balance(db_session, b_ten) == (Decimal(10), Decimal(0))
        assert await _debits(db_session, booking["id"]) == {}
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.expired

    async def test_reinstating_after_cancel_redebits_from_whatever_is_available(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        x = (await _book(client, auth_headers, test_room, _monday(), hours=5)).json()["booking"]
        assert (
            await client.delete(f"{API}/bookings/{x['id']}", headers=auth_headers)
        ).status_code == 204
        # Meanwhile A's two hours go to another booking.
        y = await _book(client, auth_headers, test_room, _monday(days_out=15), hours=2)
        assert y.status_code == 201, y.text
        assert await _debits(db_session, y.json()["booking"]["id"]) == {a_two.id: Decimal(2)}

        back = await client.put(
            f"{API}/admin/bookings/{x['id']}",
            params=_org(test_org),
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert back.status_code == 200, back.text
        # X's five hours now come entirely from B: A has nothing left to give.
        assert await _debits(db_session, x["id"]) == {b_ten.id: Decimal(5)}
        assert await _balance(db_session, a_two) == (Decimal(0), Decimal(2))
        assert await _balance(db_session, b_ten) == (Decimal(5), Decimal(5))
        assert back.json()["booking"]["package_debits"] == [
            {
                "purchase_id": str(b_ten.id),
                "hours": "5.00",
                "package_name": "Pack 10h",
                "expires_at": back.json()["booking"]["package_debits"][0]["expires_at"],
            }
        ]

    async def test_reinstating_is_refused_when_the_bank_cannot_cover_it(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        x = (await _book(client, auth_headers, test_room, _monday(), hours=5)).json()["booking"]
        await client.delete(f"{API}/bookings/{x['id']}", headers=auth_headers)
        spent = await _book(client, auth_headers, test_room, _monday(days_out=15), hours=10)
        assert spent.status_code == 201, spent.text
        back = await client.put(
            f"{API}/admin/bookings/{x['id']}",
            params=_org(test_org),
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert back.status_code == 409, back.text
        # Nothing moved: the two hours the bank still had are still there.
        assert await _balance(db_session, a_two) == (Decimal(0), Decimal(2))
        assert await _balance(db_session, b_ten) == (Decimal(2), Decimal(8))
        assert await _debits(db_session, x["id"]) == {}
        assert (await _db_booking(db_session, x["id"])).status is BookingStatus.cancelled


class TestWhatPeopleSee:
    async def test_the_balance_sums_the_bank_and_names_what_lapses_first(
        self, client, auth_headers, admin_headers, test_org, test_user, db_session, pack, a_two,
        b_ten,
    ):  # fmt: skip
        # Neither of these is in the bank: unpaid, and cancelled.
        await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="5",
            status=PurchaseStatus.pending,
        )  # fmt: skip
        await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="5",
            status=PurchaseStatus.cancelled,
        )  # fmt: skip
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert mine.status_code == 200
        body = mine.json()
        assert len(body["purchases"]) == 4  # history is kept exactly as today
        expiring = body["balance"]["hours_expiring_next"]
        assert body["balance"] == {
            "hours_available": "12.00",
            "hours_expiring_next": {"hours": "2.00", "expires_at": expiring["expires_at"]},
        }
        assert datetime.fromisoformat(body["balance"]["hours_expiring_next"]["expires_at"]) == (
            a_two.expires_at
        )

        # The operator's customer page shows the same bank.
        page = await client.get(
            f"{API}/admin/users/{test_user.id}", params=_org(test_org), headers=admin_headers
        )
        assert page.status_code == 200, page.text
        assert page.json()["balance"] == body["balance"]

    async def test_an_empty_bank_has_nothing_expiring_next(self, client, auth_headers):
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert mine.json()["balance"] == {"hours_available": "0", "hours_expiring_next": None}

    async def test_the_operator_sees_the_split_and_the_customer_does_not(
        self, client, auth_headers, admin_headers, test_org, test_room, db_session, a_two, b_ten
    ):
        made = await _book(client, auth_headers, test_room, _monday(), hours=5)
        booking_id = made.json()["booking"]["id"]

        listed = await client.get(
            f"{API}/admin/bookings", params=_org(test_org), headers=admin_headers
        )
        assert listed.status_code == 200, listed.text
        row = next(b for b in listed.json()["bookings"] if b["id"] == booking_id)
        split = [(d["purchase_id"], d["hours"], d["package_name"]) for d in row["package_debits"]]
        assert split == [(str(a_two.id), "2.00", "Pack 10h"), (str(b_ten.id), "3.00", "Pack 10h")]

        mine = await client.get(f"{API}/bookings/me", headers=auth_headers)
        customer_row = next(b for b in mine.json()["bookings"] if b["id"] == booking_id)
        assert "package_debits" not in customer_row
        assert Decimal(customer_row["package_hours_used"]) == Decimal(5)


def _migration_sql(name: str) -> str:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0011_booking_package_debits.py"
    )
    spec = importlib.util.spec_from_file_location("migration_0011", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return getattr(module, name)


class TestMigrationBackfill:
    async def test_hour_holding_bookings_get_one_debit_row_and_the_sums_match(
        self, db_session, test_org, test_user, test_room, pack, a_two, b_ten
    ):
        """The migration's backfill, run against a real schema: pre-H02 rows
        (one purchase each) become one debit row apiece while they hold their
        hours, and none for those that already gave them back."""
        # Balances as the old code left them: the two live bookings are debited.
        a_two.hours_remaining, a_two.hours_used = Decimal(0), Decimal(2)
        b_ten.hours_remaining, b_ten.hours_used = Decimal(7), Decimal(3)

        def legacy(
            hours: str, status: BookingStatus, purchase, method=PaymentMethod.package, day=14
        ):
            start = _monday(days_out=day)
            return Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=int(hours)),
                duration_hours=Decimal(hours),
                total_amount=Decimal(hours) * RATE,
                status=status,
                payment_method=method,
                package_purchase_id=purchase.id if purchase else None,
                package_hours_used=Decimal(hours) if purchase else Decimal(0),
            )  # fmt: skip

        confirmed = legacy("2", BookingStatus.confirmed, a_two)
        pending = legacy("3", BookingStatus.pending, b_ten, PaymentMethod.mixed, day=15)
        cancelled = legacy("4", BookingStatus.cancelled, b_ten, day=16)
        hourly = legacy("1", BookingStatus.confirmed, None, PaymentMethod.hourly, day=17)
        db_session.add_all([confirmed, pending, cancelled, hourly])
        await db_session.commit()

        before = {p.id: await _balance(db_session, p) for p in (a_two, b_ten)}
        await db_session.execute(text(_migration_sql("BACKFILL_SQL")))
        await db_session.commit()

        assert await _debits(db_session, confirmed.id) == {a_two.id: Decimal(2)}
        assert await _debits(db_session, pending.id) == {b_ten.id: Decimal(3)}
        assert await _debits(db_session, cancelled.id) == {}
        assert await _debits(db_session, hourly.id) == {}
        total_rows = (await db_session.execute(select(BookingPackageDebit.hours))).scalars().all()
        assert (
            sum(total_rows, Decimal(0)) == confirmed.package_hours_used + pending.package_hours_used
        )
        # A schema backfill rewrites no balance.
        assert {p.id: await _balance(db_session, p) for p in (a_two, b_ten)} == before

        # The downgrade's recovery: a post-H02 booking (no single link) gets
        # the purchase it drew the most from, so the old code can credit one.
        db_session.add(
            BookingPackageDebit(
                org_id=test_org.id, booking_id=hourly.id, purchase_id=a_two.id, hours=Decimal(1)
            )
        )
        db_session.add(
            BookingPackageDebit(
                org_id=test_org.id, booking_id=hourly.id, purchase_id=b_ten.id, hours=Decimal(3)
            )
        )
        await db_session.commit()
        await db_session.execute(text(_migration_sql("RECOVER_LINK_SQL")))
        await db_session.commit()
        assert (await _db_booking(db_session, hourly.id)).package_purchase_id == b_ten.id
        # An existing link is left alone.
        assert (await _db_booking(db_session, confirmed.id)).package_purchase_id == a_two.id
