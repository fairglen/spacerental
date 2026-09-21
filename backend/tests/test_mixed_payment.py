"""C13 — pack hours first, pay only the extra hours (`mixed`).

Prepaid hours are money the customer already paid, and a mixed booking moves
both hours and money, so these tests care most about the hours coming back
whenever the booking stops holding its slot, never coming back twice, and the
amount charged being computed by the server alone.
"""

import asyncio
import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import clock
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.user import User
from app.payments import CheckoutKind
from sqlalchemy import select

from tests.conftest import checkout_completed_event

API = "/api/v1"
RATE = Decimal("11.00")  # conftest's test_room


def _monday(days_out: int = 14, hour: int = 10) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    day = today + timedelta(days=days_ahead + days_out)
    return datetime.combine(day, time(hour, 0), tzinfo=UTC)


def _pin(monkeypatch, at: datetime) -> None:
    monkeypatch.setattr(clock, "utcnow", lambda: at)


@pytest_asyncio.fixture
async def pack(db_session, test_org) -> Package:
    p = Package(
        org_id=test_org.id, name="Pack 10h", hours=10, price=Decimal("100.00"), validity_days=180
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


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
async def seven_hours(db_session, test_org, test_user, pack) -> UserPackagePurchase:
    return await _purchase(db_session, org=test_org, user=test_user, package=pack, hours="7")


async def _book(client, headers, room, start: datetime, hours: int, method="mixed", **extra):
    return await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": method,
            **extra,
        },
        headers=headers,
    )


async def _balance(db_session, purchase) -> tuple[Decimal, Decimal]:
    row = (
        await db_session.execute(
            select(UserPackagePurchase)
            .where(UserPackagePurchase.id == purchase.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    # The ledger invariant, checked wherever a balance is read.
    assert row.hours_used + row.hours_remaining == row.hours_total
    return row.hours_remaining, row.hours_used


async def _db_booking(db_session, booking_id: str) -> Booking:
    return (
        await db_session.execute(
            select(Booking)
            .where(Booking.id == uuid.UUID(booking_id))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _pay(client, payments, booking: dict) -> dict:
    payload = checkout_completed_event(
        session_id=f"cs_stub_{uuid.UUID(booking['id']).hex}",
        kind=CheckoutKind.booking,
        reference_id=booking["id"],
        org_id=booking["org_id"],
    )
    resp = await client.post(
        f"{API}/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": payments.sign_payload(payload)},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest_asyncio.fixture
async def admin(db_session, test_org) -> dict:
    u = User(email="op@test.com", name="Op", password_hash=hash_password("password123"))
    db_session.add(u)
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=test_org.id, user_id=u.id, role=MemberRole.owner))
    await db_session.commit()
    token = create_access_token({"sub": str(u.id), "email": u.email, "name": u.name})
    return {"Authorization": f"Bearer {token}"}


class TestTheSplit:
    async def test_seven_pack_hours_and_one_paid_hour(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        resp = await _book(client, auth_headers, test_room, _monday(), hours=8)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        booking = body["booking"]

        assert booking["payment_method"] == "mixed"
        assert Decimal(booking["package_hours_used"]) == Decimal(7)
        assert Decimal(booking["duration_hours"]) == Decimal(8)
        # total_amount is the money charged, not the value of the slot.
        assert Decimal(booking["total_amount"]) == RATE
        assert booking["status"] == "pending"
        assert body["checkout_url"]

        session = payments.sessions[f"cs_stub_{uuid.UUID(booking['id']).hex}"]
        assert session["amount_cents"] == 1100
        assert session["description"] == "1h Sala A (7h pagas com o pack)"

        # Reserved at creation, before any payment.
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))
        stored = await _db_booking(db_session, booking["id"])
        assert stored.package_purchase_id == seven_hours.id

    async def test_client_numbers_are_ignored(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        resp = await _book(
            client,
            auth_headers,
            test_room,
            _monday(),
            hours=8,
            package_hours_used="1",
            total_amount="0.00",
            package_purchase_id=str(uuid.uuid4()),
        )
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
        assert Decimal(booking["package_hours_used"]) == Decimal(7)
        assert Decimal(booking["total_amount"]) == RATE

    async def test_a_pack_that_covers_everything_makes_it_a_package_booking(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        resp = await _book(client, auth_headers, test_room, _monday(), hours=7)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["booking"]["payment_method"] == "package"
        assert body["booking"]["status"] == "confirmed"
        assert body["checkout_url"] is None
        assert Decimal(body["booking"]["package_hours_used"]) == Decimal(7)
        assert payments.sessions == {}
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_no_usable_hours_makes_it_an_hourly_booking(
        self, client, auth_headers, test_room, test_member, payments, db_session, test_org,
        test_user, pack,
    ):  # fmt: skip
        expired = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="5", expires_in_days=-1
        )
        unpaid = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="5",
            status=PurchaseStatus.pending,
        )  # fmt: skip
        resp = await _book(client, auth_headers, test_room, _monday(), hours=2)
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
        assert booking["payment_method"] == "hourly"
        assert Decimal(booking["package_hours_used"]) == Decimal(0)
        assert Decimal(booking["total_amount"]) == 2 * RATE
        assert (await _db_booking(db_session, booking["id"])).package_purchase_id is None
        for purchase in (expired, unpaid):
            assert await _balance(db_session, purchase) == (Decimal(5), Decimal(0))

    async def test_a_whole_block_pack_wins_over_a_sooner_expiring_partial_one(
        self, client, auth_headers, test_room, test_member, payments, db_session, test_org,
        test_user, pack,
    ):  # fmt: skip
        soon = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="2", expires_in_days=5
        )
        big = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="10", expires_in_days=60
        )
        resp = await _book(client, auth_headers, test_room, _monday(), hours=8)
        assert resp.status_code == 201, resp.text
        assert resp.json()["booking"]["payment_method"] == "package"
        assert await _balance(db_session, soon) == (Decimal(2), Decimal(0))
        assert await _balance(db_session, big) == (Decimal(2), Decimal(8))

    async def test_the_soonest_expiring_pack_pays_the_partial_share(
        self, client, auth_headers, test_room, test_member, payments, db_session, test_org,
        test_user, pack,
    ):  # fmt: skip
        later = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="5", expires_in_days=60
        )
        soon = await _purchase(
            db_session, org=test_org, user=test_user, package=pack, hours="3", expires_in_days=5
        )
        resp = await _book(client, auth_headers, test_room, _monday(), hours=8)
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
        assert booking["payment_method"] == "mixed"
        # One pack per booking: the 3h that lapse first, not 3h + 5h.
        assert Decimal(booking["package_hours_used"]) == Decimal(3)
        assert Decimal(booking["total_amount"]) == 5 * RATE
        assert await _balance(db_session, soon) == (Decimal(0), Decimal(3))
        assert await _balance(db_session, later) == (Decimal(5), Decimal(0))

    async def test_another_orgs_pack_is_never_touched(
        self, client, auth_headers, test_room, test_member, payments, db_session, test_user
    ):
        from app.models.organization import Organization, OrgPlan

        other = Organization(name="Other", slug="other", plan=OrgPlan.starter, settings={})
        db_session.add(other)
        await db_session.flush()
        other_pack = Package(
            org_id=other.id, name="P", hours=10, price=Decimal("1.00"), validity_days=30
        )
        db_session.add(other_pack)
        await db_session.commit()
        foreign = await _purchase(
            db_session, org=other, user=test_user, package=other_pack, hours="7"
        )
        resp = await _book(client, auth_headers, test_room, _monday(), hours=8)
        assert resp.status_code == 201, resp.text
        assert resp.json()["booking"]["payment_method"] == "hourly"
        assert await _balance(db_session, foreign) == (Decimal(7), Decimal(0))


class TestHoursComeBack:
    async def test_confirming_keeps_the_hours_spent(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        assert (await _pay(client, payments, booking))["handled"] is True
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.confirmed
        assert stored.payment_method is PaymentMethod.mixed
        assert stored.total_amount == RATE
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))
        # A duplicate delivery moves nothing.
        assert (await _pay(client, payments, booking))["handled"] is False
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_backing_out_of_checkout_restores_them(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        session_id = f"cs_stub_{uuid.UUID(booking['id']).hex}"
        resp = await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        assert resp.status_code == 303, resp.text
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.expired
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

    async def test_an_abandoned_hold_restores_them_when_the_customer_looks(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))

        # Their packs page alone must already show the hours back.
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert mine.status_code == 200, mine.text
        assert Decimal(mine.json()["purchases"][0]["hours_remaining"]) == Decimal(7)
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.expired

        # Reading the bookings afterwards must not credit a second time.
        await client.get(f"{API}/bookings/me", headers=auth_headers)
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

    async def test_an_abandoned_hold_restores_them_when_someone_else_takes_the_slot(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        test_org, monkeypatch,
    ):  # fmt: skip
        start = _monday()
        await _book(client, auth_headers, test_room, start, 8)
        other = User(email="o@test.com", name="O", password_hash=hash_password("password123"))
        db_session.add(other)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=other.id, role=MemberRole.member)
        )
        await db_session.commit()
        other_headers = {
            "Authorization": "Bearer "
            + create_access_token({"sub": str(other.id), "email": other.email, "name": "O"})
        }

        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        taken = await _book(client, other_headers, test_room, start, 1, method="hourly")
        assert taken.status_code == 201, taken.text
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

    async def test_the_next_booking_can_spend_hours_a_lapsed_hold_still_had(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        await _book(client, auth_headers, test_room, _monday(), 8)
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        again = await _book(client, auth_headers, test_room, _monday(21), 7, method="package")
        assert again.status_code == 201, again.text
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_cancelling_a_confirmed_mixed_booking_restores_hours_and_moves_no_money(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        await _pay(client, payments, booking)
        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.cancelled
        # Exactly the pack's share comes back — 7, not the booking's 8 hours.
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))
        assert stored.total_amount == RATE
        assert stored.package_hours_used == Decimal(7)
        # A second cancel is refused and credits nothing.
        again = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert again.status_code == 400
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

    async def test_cancelling_the_unpaid_hold_restores_them(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

    async def test_an_operator_cancel_and_reinstate_move_the_packs_share_only(
        self, client, auth_headers, admin, test_room, test_member, test_org, payments, db_session,
        seven_hours,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        await _pay(client, payments, booking)
        url = f"{API}/admin/bookings/{booking['id']}"
        org = {"org_id": str(test_org.id)}

        cancelled = await client.put(url, params=org, json={"status": "cancelled"}, headers=admin)
        assert cancelled.status_code == 200, cancelled.text
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

        back = await client.put(url, params=org, json={"status": "confirmed"}, headers=admin)
        assert back.status_code == 200, back.text
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))
        assert Decimal(back.json()["booking"]["package_hours_used"]) == Decimal(7)


class TestRetryAndLateMoney:
    async def test_pay_now_on_an_expired_mixed_hold_takes_the_hours_again(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        await client.get(f"{API}/bookings/me", headers=auth_headers)
        assert await _balance(db_session, seven_hours) == (Decimal(7), Decimal(0))

        retry = await client.post(f"{API}/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert retry.status_code == 200, retry.text
        assert retry.json()["booking"]["status"] == "pending"
        assert Decimal(retry.json()["booking"]["total_amount"]) == RATE
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_pay_now_is_refused_when_the_hours_went_elsewhere(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        spent = await _book(client, auth_headers, test_room, _monday(21), 7, method="package")
        assert spent.status_code == 201, spent.text

        retry = await client.post(f"{API}/bookings/{booking['id']}/checkout", headers=auth_headers)
        assert retry.status_code == 409, retry.text
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.expired
        # Never recomputed: the expired row keeps the split it was made with.
        assert stored.package_hours_used == Decimal(7)
        assert stored.total_amount == RATE
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_late_money_confirms_and_takes_the_hours_again(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        await client.get(f"{API}/bookings/me", headers=auth_headers)

        assert (await _pay(client, payments, booking))["handled"] is True
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.confirmed
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_late_money_before_anything_noticed_the_lapse_does_not_double_move(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        # Still `pending` in the database: nothing reconciled the lapsed hold yet.
        assert (await _pay(client, payments, booking))["handled"] is True
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.confirmed
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))

    async def test_late_money_without_the_hours_is_kept_for_a_person(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours,
        monkeypatch,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        spent = await _book(client, auth_headers, test_room, _monday(21), 7, method="package")
        assert spent.status_code == 201, spent.text

        assert (await _pay(client, payments, booking))["handled"] is True
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.paid_unfulfilled
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))


class TestConcurrency:
    async def test_two_mixed_bookings_race_for_one_pack_and_one_gets_the_hours(
        self, client, auth_headers, test_room, test_member, payments, db_session, seven_hours
    ):
        first, second = await asyncio.gather(
            _book(client, auth_headers, test_room, _monday(14), 8),
            _book(client, auth_headers, test_room, _monday(21), 8),
        )
        assert (first.status_code, second.status_code) == (201, 201), (first.text, second.text)
        bookings = [first.json()["booking"], second.json()["booking"]]
        used = sorted(Decimal(b["package_hours_used"]) for b in bookings)
        assert used == [Decimal(0), Decimal(7)]
        by_method = {b["payment_method"]: b for b in bookings}
        assert set(by_method) == {"hourly", "mixed"}
        assert Decimal(by_method["mixed"]["total_amount"]) == RATE
        assert Decimal(by_method["hourly"]["total_amount"]) == 8 * RATE
        # The seven hours were sold once.
        assert await _balance(db_session, seven_hours) == (Decimal(0), Decimal(7))


class TestReportingAndShapes:
    async def test_revenue_counts_the_money_part_of_a_mixed_booking(
        self, client, auth_headers, admin, test_room, test_member, test_org, payments, db_session,
        seven_hours,
    ):  # fmt: skip
        booking = (await _book(client, auth_headers, test_room, _monday(), 8)).json()["booking"]
        await _pay(client, payments, booking)
        resp = await client.get(
            f"{API}/admin/dashboard", params={"org_id": str(test_org.id)}, headers=admin
        )
        assert resp.status_code == 200, resp.text
        assert Decimal(str(resp.json()["total_revenue"])) == RATE

    async def test_the_operator_list_shows_the_split(
        self, client, auth_headers, admin, test_room, test_member, test_org, payments, seven_hours
    ):
        await _book(client, auth_headers, test_room, _monday(), 8)
        resp = await client.get(
            f"{API}/admin/bookings", params={"org_id": str(test_org.id)}, headers=admin
        )
        assert resp.status_code == 200, resp.text
        [row] = resp.json()["bookings"]
        assert row["payment_method"] == "mixed"
        assert Decimal(row["package_hours_used"]) == Decimal(7)
        assert Decimal(row["total_amount"]) == RATE

    async def test_plain_methods_report_their_pack_share_too(
        self, client, auth_headers, test_room, test_member, payments, seven_hours
    ):
        hourly = await _book(client, auth_headers, test_room, _monday(), 1, method="hourly")
        package = await _book(client, auth_headers, test_room, _monday(21), 2, method="package")
        assert Decimal(hourly.json()["booking"]["package_hours_used"]) == Decimal(0)
        assert Decimal(package.json()["booking"]["package_hours_used"]) == Decimal(2)

    @pytest.mark.parametrize("used", [Decimal(-1), Decimal(9)])
    async def test_the_schema_refuses_an_impossible_pack_share(
        self, db_session, test_org, test_room, test_user, used
    ):
        from sqlalchemy.exc import IntegrityError

        start = _monday()
        db_session.add(
            Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=8),
                duration_hours=Decimal(8),
                total_amount=Decimal(0),
                status=BookingStatus.cancelled,
                payment_method=PaymentMethod.mixed,
                package_hours_used=used,
            )
        )
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()
