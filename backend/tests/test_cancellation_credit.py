"""K01 — cancelling a paid booking puts its hours in the bank, never money.

A `hourly` booking, the money share of a `mixed` one, or an operator's
`manual` one, once cancelled, becomes a `cancellation_credit` purchase row:
`total_amount / hourly_rate` hours, no package, CANCELLATION_CREDIT_VALIDITY_DAYS
of validity. Unpaid holds, expired bookings and `package` bookings credit
nothing (their pack share goes back the H02 way). One credit per booking.
Reinstating takes the credit back unless any of it was spent.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import clock
from app.config import settings
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.package import (
    BookingPackageDebit,
    Package,
    PurchaseSource,
    PurchaseStatus,
    UserPackagePurchase,
)
from app.payments import CheckoutKind
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from tests.conftest import checkout_completed_event
from tests.test_mixed_payment import admin  # noqa: F401 — the operator's headers

API = "/api/v1"
RATE = Decimal("11.00")  # conftest's test_room

pytestmark = pytest.mark.usefixtures("test_member")


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


async def _purchase(db_session, *, org, user, package, hours: str) -> UserPackagePurchase:
    now = datetime.now(tz=UTC)
    purchase = UserPackagePurchase(
        user_id=user.id,
        package_id=package.id,
        org_id=org.id,
        hours_total=Decimal(hours),
        hours_used=Decimal(0),
        hours_remaining=Decimal(hours),
        purchased_at=now,
        expires_at=now + timedelta(days=30),
        status=PurchaseStatus.active,
    )
    db_session.add(purchase)
    await db_session.commit()
    await db_session.refresh(purchase)
    return purchase


async def _book(client, headers, room, start: datetime, hours: int, method="hourly"):
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


async def _pay(client, payments, booking: dict) -> None:
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


async def _paid(client, payments, headers, room, start, hours=2, method="hourly") -> dict:
    booking = await _book(client, headers, room, start, hours, method)
    await _pay(client, payments, booking)
    return booking


async def _credits(db_session, booking_id) -> list[UserPackagePurchase]:
    rows = (
        await db_session.execute(
            select(UserPackagePurchase)
            .where(UserPackagePurchase.source_booking_id == uuid.UUID(str(booking_id)))
            .execution_options(populate_existing=True)
        )
    ).scalars()
    return list(rows)


async def _db_booking(db_session, booking_id) -> Booking:
    return (
        await db_session.execute(
            select(Booking)
            .where(Booking.id == uuid.UUID(str(booking_id)))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


class TestCustomerCancellation:
    async def test_a_paid_hourly_booking_becomes_hours_in_the_bank(
        self, client, auth_headers, test_room, payments, db_session, emails, monkeypatch
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        at = datetime.now(tz=UTC).replace(microsecond=0)
        _pin(monkeypatch, at)

        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text

        (credit,) = await _credits(db_session, booking["id"])
        assert credit.source is PurchaseSource.cancellation_credit
        assert credit.package_id is None
        assert credit.user_id == uuid.UUID(booking["user_id"])
        assert credit.status is PurchaseStatus.active
        assert credit.hours_total == credit.hours_remaining == Decimal("2.00")
        assert credit.hours_used == 0
        # Money stays recorded, never moved: the credit "cost" what was paid.
        assert credit.amount_paid == RATE * 2
        assert credit.expires_at == at + timedelta(days=settings.CANCELLATION_CREDIT_VALIDITY_DAYS)
        assert (await _db_booking(db_session, booking["id"])).total_amount == RATE * 2

        # The customer sees it in the bank, with no package behind it.
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert mine.status_code == 200, mine.text
        rows = mine.json()["purchases"]
        assert [r["source"] for r in rows] == ["cancellation_credit"]
        assert rows[0]["package"] is None
        assert rows[0]["source_booking_id"] == booking["id"]
        assert Decimal(rows[0]["hours_remaining"]) == Decimal("2.00")

        # The cancellation email says where the hours went.
        cancellation = emails.sent[-1]
        assert cancellation.subject.startswith("Reserva cancelada")
        assert "As 2 horas pagas ficaram no seu banco de horas" in cancellation.text_body
        assert "válidas até" in cancellation.text_body
        assert "/dashboard" in cancellation.html_body

    async def test_a_mixed_booking_restores_the_pack_and_credits_only_the_paid_share(
        self, client, auth_headers, test_room, test_org, test_user, pack, payments, db_session
    ):
        seven = await _purchase(db_session, org=test_org, user=test_user, package=pack, hours="7")
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), 8, "mixed")
        assert Decimal(booking["package_hours_used"]) == Decimal(7)

        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text

        await db_session.refresh(seven)
        assert (seven.hours_remaining, seven.hours_used) == (Decimal(7), Decimal(0))
        (credit,) = await _credits(db_session, booking["id"])
        assert credit.hours_total == Decimal("1.00")
        assert credit.amount_paid == RATE

    async def test_the_credit_is_the_overridden_amount_at_the_rooms_rate(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        payments,
        db_session,
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        fixed = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"total_amount": "25.00", "reason": "desconto combinado"},
            headers=admin,
        )
        assert fixed.status_code == 200, fixed.text

        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        (credit,) = await _credits(db_session, booking["id"])
        # 25,00 € at 11,00 €/h is 2,27 h, rounded to the cent of an hour.
        assert credit.hours_total == Decimal("2.27")
        assert credit.amount_paid == Decimal("25.00")

    async def test_a_second_cancel_credits_nothing_more(
        self, client, auth_headers, test_room, payments, db_session
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        ).status_code == 204
        again = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert again.status_code == 400
        assert len(await _credits(db_session, booking["id"])) == 1

    async def test_an_unpaid_hold_credits_nothing(
        self, client, auth_headers, test_room, db_session, emails
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), 2)
        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        assert await _credits(db_session, booking["id"]) == []
        assert "banco de horas" not in emails.sent[-1].text_body

    async def test_a_package_booking_goes_back_on_the_pack_and_credits_nothing(
        self, client, auth_headers, test_room, test_org, test_user, pack, db_session
    ):
        ten = await _purchase(db_session, org=test_org, user=test_user, package=pack, hours="10")
        booking = await _book(client, auth_headers, test_room, _monday(), 2, "package")
        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code == 204, resp.text
        await db_session.refresh(ten)
        assert (ten.hours_remaining, ten.hours_used) == (Decimal(10), Decimal(0))
        assert await _credits(db_session, booking["id"]) == []

    async def test_only_one_credit_row_per_booking_can_exist(
        self, client, auth_headers, test_room, test_org, payments, db_session
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        ).status_code == 204
        (credit,) = await _credits(db_session, booking["id"])
        db_session.add(
            UserPackagePurchase(
                user_id=credit.user_id,
                package_id=None,
                org_id=test_org.id,
                hours_total=Decimal(1),
                hours_used=Decimal(0),
                hours_remaining=Decimal(1),
                amount_paid=RATE,
                status=PurchaseStatus.active,
                source=PurchaseSource.cancellation_credit,
                source_booking_id=credit.source_booking_id,
                purchased_at=credit.purchased_at,
                expires_at=credit.expires_at,
            )
        )
        with pytest.raises(IntegrityError, match="uq_user_package_purchases_source_booking_id"):
            await db_session.flush()
        await db_session.rollback()


class TestSpendingTheCredit:
    async def test_credited_hours_pay_for_a_new_booking_without_checkout(
        self, client, auth_headers, test_room, payments, db_session
    ):
        first = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{first['id']}", headers=auth_headers)
        ).status_code == 204
        (credit,) = await _credits(db_session, first["id"])

        rebooked = await _book(client, auth_headers, test_room, _monday(21), 2, "package")
        assert rebooked["status"] == "confirmed"
        assert rebooked["payment_method"] == "package"
        assert Decimal(rebooked["package_hours_used"]) == Decimal(2)
        # The slot's value is recorded as every package booking's is; no
        # checkout session was opened for it.
        assert Decimal(rebooked["total_amount"]) == RATE * 2
        assert f"cs_stub_{uuid.UUID(rebooked['id']).hex}" not in payments.sessions
        await db_session.refresh(credit)
        assert (credit.hours_remaining, credit.hours_used) == (Decimal(0), Decimal(2))
        debit = (
            await db_session.execute(
                select(BookingPackageDebit).where(
                    BookingPackageDebit.booking_id == uuid.UUID(rebooked["id"])
                )
            )
        ).scalar_one()
        assert debit.purchase_id == credit.id

    async def test_a_mixed_booking_draws_the_credit_first_and_pays_the_rest(
        self, client, auth_headers, test_room, payments, db_session
    ):
        first = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{first['id']}", headers=auth_headers)
        ).status_code == 204

        longer = await _book(client, auth_headers, test_room, _monday(21), 3, "mixed")
        assert Decimal(longer["package_hours_used"]) == Decimal(2)
        assert Decimal(longer["total_amount"]) == RATE

    async def test_an_expired_credit_is_not_spendable(
        self, client, auth_headers, test_room, payments, db_session
    ):
        first = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{first['id']}", headers=auth_headers)
        ).status_code == 204
        (credit,) = await _credits(db_session, first["id"])
        credit.expires_at = datetime.now(tz=UTC) - timedelta(days=1)
        await db_session.commit()

        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": _monday(21).isoformat(),
                "end_time": (_monday(21) + timedelta(hours=2)).isoformat(),
                "payment_method": "package",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        await db_session.refresh(credit)
        assert credit.hours_remaining == Decimal(2)


class TestOperatorCancellation:
    async def test_an_operator_cancel_credits_by_default_and_answers_with_the_credit(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        payments,
        db_session,
        emails,
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "cancelled"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        (credit,) = await _credits(db_session, booking["id"])
        assert body["credit"] == {
            "id": str(credit.id),
            "hours": "2.00",
            "expires_at": credit.expires_at.isoformat(),
        }
        assert "banco de horas" in emails.sent[-1].text_body

        detail = await client.get(
            f"{API}/admin/bookings/{booking['id']}", params=_org(test_org), headers=admin
        )
        assert detail.status_code == 200, detail.text
        shown = detail.json()["booking"]["cancellation_credit"]
        assert shown["id"] == str(credit.id)
        assert Decimal(shown["hours_total"]) == Decimal(2)
        assert shown["status"] == "active"

        listed = await client.get(f"{API}/admin/purchases", params=_org(test_org), headers=admin)
        assert listed.status_code == 200, listed.text
        row = next(p for p in listed.json()["purchases"] if p["id"] == str(credit.id))
        assert row["source"] == "cancellation_credit"
        assert row["package"] is None
        assert row["source_booking_id"] == booking["id"]

    async def test_a_manual_booking_is_credited_too(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        test_user,
        db_session,
    ):
        start = _monday()
        db_session.add(
            Booking(
                user_id=test_user.id,
                room_id=test_room.id,
                org_id=test_org.id,
                start_time=start,
                end_time=start + timedelta(hours=3),
                duration_hours=Decimal(3),
                total_amount=RATE * 3,
                payment_method=PaymentMethod.manual,
                status=BookingStatus.confirmed,
            )
        )
        await db_session.commit()
        booking = (await db_session.execute(select(Booking))).scalar_one()
        resp = await client.put(
            f"{API}/admin/bookings/{booking.id}",
            params=_org(test_org),
            json={"status": "cancelled"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        (credit,) = await _credits(db_session, booking.id)
        assert credit.hours_total == Decimal("3.00")

    async def test_unticking_the_credit_needs_a_reason_and_credits_nothing(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        payments,
        db_session,
        emails,
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        url = f"{API}/admin/bookings/{booking['id']}"
        no_reason = await client.put(
            url, params=_org(test_org), json={"status": "cancelled", "credit_hours": False},
            headers=admin,
        )  # fmt: skip
        assert no_reason.status_code == 422, no_reason.text
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.confirmed

        resp = await client.put(
            url,
            params=_org(test_org),
            json={"status": "cancelled", "credit_hours": False, "reason": "no-show combinado"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert "credit" not in resp.json()
        assert await _credits(db_session, booking["id"]) == []
        assert "banco de horas" not in emails.sent[-1].text_body

        trail = await client.get(
            f"{API}/admin/bookings/{booking['id']}/history", params=_org(test_org), headers=admin
        )
        assert trail.status_code == 200, trail.text
        last = trail.json()["actions"][0]
        assert last["action"] == "cancel"
        assert last["reason"] == "no-show combinado"

    async def test_an_expired_booking_cancelled_by_the_operator_credits_nothing(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        db_session,
        monkeypatch,
    ):
        booking = await _book(client, auth_headers, test_room, _monday(), 2)
        _pin(monkeypatch, datetime.now(tz=UTC) + timedelta(minutes=16))
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "cancelled"},
            headers=admin,
        )
        assert resp.status_code == 200, resp.text
        assert await _credits(db_session, booking["id"]) == []


class TestReinstatement:
    async def test_reinstating_takes_the_unspent_credit_back(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        payments,
        db_session,
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        ).status_code == 204
        back = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "confirmed"},
            headers=admin,
        )
        assert back.status_code == 200, back.text
        (credit,) = await _credits(db_session, booking["id"])
        assert credit.status is PurchaseStatus.cancelled
        assert credit.hours_remaining == 0
        mine = await client.get(f"{API}/packages/me", headers=auth_headers)
        assert [r["status"] for r in mine.json()["purchases"]] == ["cancelled"]

        # Cancelled again: the same row comes back, with a fresh expiry.
        again = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert again.status_code == 204, again.text
        (same,) = await _credits(db_session, booking["id"])
        assert same.id == credit.id
        assert same.status is PurchaseStatus.active
        assert same.hours_remaining == Decimal("2.00")

    async def test_reinstating_after_the_credit_was_spent_is_refused(
        self,
        client,
        auth_headers,
        admin,
        test_room,
        test_org,
        payments,
        db_session,
    ):
        booking = await _paid(client, payments, auth_headers, test_room, _monday(), hours=2)
        assert (
            await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        ).status_code == 204
        await _book(client, auth_headers, test_room, _monday(21), 1, "package")

        back = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "confirmed"},
            headers=admin,
        )
        assert back.status_code == 409, back.text
        assert "already used" in back.json()["detail"]
        assert (await _db_booking(db_session, booking["id"])).status is BookingStatus.cancelled
        (credit,) = await _credits(db_session, booking["id"])
        assert credit.status is PurchaseStatus.active
        assert (credit.hours_remaining, credit.hours_used) == (Decimal(1), Decimal(1))
