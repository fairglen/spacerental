"""I01: `paid_at` marks the moment money was received, set exactly once.

Every money-receiving transition sets it; nothing moves it afterwards — a
repeated webhook, a cancellation (K01 credits hours), an operator edit. The
migration's backfill approximates it for rows that predate the column from
what they already say."""

import importlib.util
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.package import Package, PurchaseSource, PurchaseStatus, UserPackagePurchase
from app.payments import CheckoutKind
from sqlalchemy import select, text

from tests.conftest import checkout_completed_event

API = "/api/v1"
WEBHOOK_URL = f"{API}/webhooks/stripe"
MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0018_billing_paid_at_invoices.py"
)


def _next_monday(hour: int, weeks: int = 2) -> datetime:
    today = datetime.now(tz=UTC).date()
    days = (0 - today.weekday()) % 7 or 7
    return datetime.combine(
        today + timedelta(days=days + 7 * weeks), datetime.min.time(), tzinfo=UTC
    ).replace(hour=hour)


async def _book(client, headers, room, start: datetime, hours: int = 1, method: str = "hourly"):
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


async def _webhook(client, payments, *, kind: CheckoutKind, reference_id: str, org_id) -> None:
    payload = checkout_completed_event(
        session_id=f"cs_stub_{uuid.UUID(reference_id).hex}",
        kind=kind,
        reference_id=reference_id,
        org_id=org_id,
    )
    resp = await client.post(
        WEBHOOK_URL, content=payload, headers={"Stripe-Signature": payments.sign_payload(payload)}
    )
    assert resp.status_code == 200, resp.text


async def _booking_row(db_session, booking_id: str) -> Booking:
    return await db_session.scalar(
        select(Booking)
        .where(Booking.id == uuid.UUID(booking_id))
        .execution_options(populate_existing=True)
    )


class TestTransitions:
    async def test_an_hourly_booking_is_paid_once_at_the_webhook_and_a_repeat_does_not_move_it(
        self, client, auth_headers, test_member, test_room, test_org, payments, db_session
    ):
        booking = await _book(client, auth_headers, test_room, _next_monday(10))
        assert (await _booking_row(db_session, booking["id"])).paid_at is None
        await _webhook(
            client,
            payments,
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_org.id,
        )
        first = (await _booking_row(db_session, booking["id"])).paid_at
        assert first is not None
        await _webhook(
            client,
            payments,
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_org.id,
        )
        assert (await _booking_row(db_session, booking["id"])).paid_at == first

    async def test_a_cancellation_leaves_paid_at_where_it_was(
        self, client, auth_headers, test_member, test_room, test_org, payments, db_session
    ):
        booking = await _book(client, auth_headers, test_room, _next_monday(11))
        await _webhook(
            client,
            payments,
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=test_org.id,
        )
        paid = (await _booking_row(db_session, booking["id"])).paid_at
        resp = await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        assert resp.status_code in (200, 204), resp.text
        row = await _booking_row(db_session, booking["id"])
        assert row.status is BookingStatus.cancelled
        assert row.paid_at == paid

    async def test_a_bought_pack_is_paid_at_the_webhook_and_a_pending_one_is_not(
        self, client, auth_headers, test_member, test_org, payments, db_session
    ):
        package = Package(
            org_id=test_org.id, name="Pack 10", hours=10, price=Decimal("100.00"), validity_days=365
        )
        db_session.add(package)
        await db_session.commit()
        resp = await client.post(
            f"{API}/packages/{package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code in (200, 201), resp.text
        purchase_id = resp.json()["purchase"]["id"]
        row = await db_session.scalar(
            select(UserPackagePurchase).where(UserPackagePurchase.id == uuid.UUID(purchase_id))
        )
        assert row.status is PurchaseStatus.pending
        assert row.paid_at is None
        await _webhook(
            client,
            payments,
            kind=CheckoutKind.package_purchase,
            reference_id=purchase_id,
            org_id=test_org.id,
        )
        await db_session.refresh(row)
        assert row.status is PurchaseStatus.active
        first = row.paid_at
        assert first is not None
        await _webhook(
            client,
            payments,
            kind=CheckoutKind.package_purchase,
            reference_id=purchase_id,
            org_id=test_org.id,
        )
        await db_session.refresh(row)
        assert row.paid_at == first

    async def test_a_manual_booking_with_an_amount_is_paid_when_created(
        self, client, admin_headers, test_member, test_user, test_room, test_org, db_session
    ):
        start = _next_monday(12)
        resp = await client.post(
            f"{API}/admin/bookings",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
            json={
                "room_id": str(test_room.id),
                "user_id": str(test_user.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=2)).isoformat(),
                "reason": "Pago em numerário",
            },
        )
        assert resp.status_code == 201, resp.text
        row = await _booking_row(db_session, resp.json()["booking"]["id"])
        assert row.payment_method is PaymentMethod.manual
        assert row.total_amount > 0
        assert row.paid_at is not None

    async def test_mark_paid_sets_it_on_an_unpaid_hold(
        self, client, auth_headers, admin_headers, test_member, test_room, test_org, db_session
    ):
        booking = await _book(client, auth_headers, test_room, _next_monday(14))
        resp = await client.post(
            f"{API}/admin/bookings/{booking['id']}/mark-paid",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
            json={"reason": "Transferência recebida"},
        )
        assert resp.status_code == 200, resp.text
        row = await _booking_row(db_session, booking["id"])
        assert row.status is BookingStatus.confirmed
        assert row.paid_at is not None

    async def test_complimentary_hours_carry_a_paid_at_with_amount_zero(
        self, client, admin_headers, test_member, test_user, test_org, db_session
    ):
        package = Package(
            org_id=test_org.id, name="Pack 5", hours=5, price=Decimal("50.00"), validity_days=365
        )
        db_session.add(package)
        await db_session.commit()
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/complimentary-hours",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
            json={"package_id": str(package.id), "hours": "2.00", "reason": "Cortesia"},
        )
        assert resp.status_code == 201, resp.text
        row = await db_session.scalar(
            select(UserPackagePurchase).where(
                UserPackagePurchase.id == uuid.UUID(resp.json()["purchase"]["id"])
            )
        )
        assert row.source is PurchaseSource.complimentary
        assert row.amount_paid == 0
        assert row.paid_at is not None


class TestBackfill:
    """The migration's statements, run on rows that predate the column."""

    @pytest.fixture
    def statements(self):
        spec = importlib.util.spec_from_file_location("migration_0018", MIGRATION)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.BACKFILL_STATEMENTS

    async def test_rows_are_dated_by_what_they_already_say(
        self, db_session, statements, test_org, test_user, test_member, test_room
    ):
        created = datetime(2026, 9, 1, 9, 0, tzinfo=UTC)
        bought = datetime(2026, 9, 2, 10, 0, tzinfo=UTC)
        later = datetime(2026, 9, 3, 10, 0, tzinfo=UTC)
        package = Package(
            org_id=test_org.id, name="Pack", hours=10, price=Decimal("100.00"), validity_days=365
        )
        db_session.add(package)
        await db_session.flush()

        def booking(status, method, amount, hour):
            start = datetime(2026, 10, 20, hour, tzinfo=UTC)
            return Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                duration_hours=Decimal("1.00"),
                total_amount=Decimal(amount),
                status=status,
                payment_method=method,
                created_at=created,
            )

        def purchase(source, status, amount, **extra):
            return UserPackagePurchase(
                user_id=test_user.id,
                package_id=package.id if source is not PurchaseSource.cancellation_credit else None,
                org_id=test_org.id,
                hours_total=Decimal("10.00"),
                hours_used=Decimal("0.00"),
                hours_remaining=Decimal("10.00"),
                amount_paid=Decimal(amount),
                status=status,
                source=source,
                purchased_at=bought,
                expires_at=later + timedelta(days=365),
                **extra,
            )

        rows = {
            "hourly_confirmed": booking(BookingStatus.confirmed, PaymentMethod.hourly, "11.00", 8),
            "mixed_completed": booking(BookingStatus.completed, PaymentMethod.mixed, "5.50", 9),
            "hourly_unfulfilled": booking(
                BookingStatus.paid_unfulfilled, PaymentMethod.hourly, "11.00", 10
            ),
            "hourly_pending": booking(BookingStatus.pending, PaymentMethod.hourly, "11.00", 11),
            "hourly_expired": booking(BookingStatus.expired, PaymentMethod.hourly, "11.00", 12),
            "cancelled_with_credit": booking(
                BookingStatus.cancelled, PaymentMethod.hourly, "11.00", 13
            ),
            "cancelled_without_credit": booking(
                BookingStatus.cancelled, PaymentMethod.hourly, "11.00", 14
            ),
            "manual_paid": booking(BookingStatus.confirmed, PaymentMethod.manual, "22.00", 15),
            "manual_free": booking(BookingStatus.confirmed, PaymentMethod.manual, "0.00", 16),
            "package_booking": booking(BookingStatus.confirmed, PaymentMethod.package, "0.00", 17),
        }
        rows["hourly_pending"].hold_expires_at = later
        db_session.add_all(rows.values())
        await db_session.flush()
        purchases = {
            "bought_active": purchase(PurchaseSource.purchase, PurchaseStatus.active, "100.00"),
            "bought_cancelled": purchase(
                PurchaseSource.purchase, PurchaseStatus.cancelled, "100.00"
            ),
            "bought_pending": purchase(PurchaseSource.purchase, PurchaseStatus.pending, "100.00"),
            "granted": purchase(PurchaseSource.complimentary, PurchaseStatus.active, "0.00"),
            "credit": purchase(
                PurchaseSource.cancellation_credit,
                PurchaseStatus.active,
                "11.00",
                source_booking_id=rows["cancelled_with_credit"].id,
            ),
        }
        db_session.add_all(purchases.values())
        await db_session.commit()

        for statement in statements:
            await db_session.execute(text(statement))
        await db_session.commit()
        for row in list(rows.values()) + list(purchases.values()):
            await db_session.refresh(row)

        assert {k: v.paid_at for k, v in rows.items()} == {
            "hourly_confirmed": created,
            "mixed_completed": created,
            "hourly_unfulfilled": created,
            "hourly_pending": None,
            "hourly_expired": None,
            "cancelled_with_credit": created,
            "cancelled_without_credit": None,
            "manual_paid": created,
            "manual_free": None,
            "package_booking": None,
        }
        assert {k: v.paid_at for k, v in purchases.items()} == {
            "bought_active": bought,
            "bought_cancelled": bought,
            "bought_pending": None,
            "granted": bought,
            "credit": None,
        }
