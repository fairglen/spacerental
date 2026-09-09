"""Story 2.4 — redeeming prepaid package hours at booking time.

Prepaid hours are money-equivalent, so these tests care as much about what is
*not* deducted when a booking fails, and about two requests racing for the same
last hour, as they do about the happy path.
"""

import asyncio
import uuid
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import text, func, select

from app import package_hours
from app.models.booking import Booking, PaymentMethod
from app.models.organization import Organization, OrgPlan
from app.models.package import Package, PurchaseStatus, UserPackagePurchase


def _future_slot(*, days_offset: int = 0, hour: int = 10, duration_hours: int = 2):
    """(start, end) ISO strings on an upcoming Monday, inside opening hours."""
    today = datetime.now(tz=timezone.utc).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    target_date = today + timedelta(days=days_ahead + 7 + days_offset)
    start = datetime.combine(target_date, time(hour, 0), tzinfo=timezone.utc)
    end = start + timedelta(hours=duration_hours)
    return start.isoformat(), end.isoformat()


@pytest_asyncio.fixture
async def test_package(db_session, test_org) -> Package:
    p = Package(
        org_id=test_org.id,
        name="Starter Pack",
        hours=10,
        price=Decimal("99.00"),
        validity_days=180,
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


async def _make_purchase(
    db_session,
    *,
    org,
    user,
    package,
    hours: str,
    status: PurchaseStatus = PurchaseStatus.active,
    expires_in_days: int = 30,
) -> UserPackagePurchase:
    now = datetime.now(tz=timezone.utc)
    purchase = UserPackagePurchase(
        user_id=user.id,
        package_id=package.id,
        org_id=org.id,
        hours_total=Decimal(hours),
        hours_used=Decimal("0"),
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
async def active_purchase(db_session, test_org, test_user, test_package):
    return await _make_purchase(
        db_session, org=test_org, user=test_user, package=test_package, hours="10"
    )


async def _book_with_package(client, headers, room, *, days_offset=0, duration_hours=2):
    start, end = _future_slot(days_offset=days_offset, duration_hours=duration_hours)
    return await client.post(
        "/api/v1/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start,
            "end_time": end,
            "payment_method": "package",
        },
        headers=headers,
    )


class TestRedeemHappyPath:
    async def test_booking_is_confirmed_without_checkout_and_hours_drop(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 201, resp.text
        body = resp.json()

        booking = body["booking"]
        assert booking["status"] == "confirmed"
        assert booking["payment_method"] == "package"
        # Prepaid: nothing left to charge, so no Checkout Session was opened.
        assert body.get("checkout_url") is None
        assert payments.sessions == {}

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("8.00")
        assert active_purchase.hours_used == Decimal("2.00")

    async def test_hours_are_debited_per_booking(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        first = await _book_with_package(client, auth_headers, test_room)
        assert first.status_code == 201, first.text
        second = await _book_with_package(
            client, auth_headers, test_room, days_offset=1, duration_hours=3
        )
        assert second.status_code == 201, second.text

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("5.00")
        assert active_purchase.hours_used == Decimal("5.00")


class TestRedeemRejected:
    async def test_insufficient_hours_deducts_nothing_and_creates_no_booking(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        db_session,
    ):
        purchase = await _make_purchase(
            db_session, org=test_org, user=test_user, package=test_package, hours="1"
        )

        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 409, resp.text

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("1.00")
        assert purchase.hours_used == Decimal("0.00")

        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert listed.json()["bookings"] == []

    async def test_no_package_at_all_is_rejected(
        self, client, auth_headers, test_room, test_member
    ):
        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 409, resp.text

        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert listed.json()["bookings"] == []

    async def test_unpaid_purchase_hours_are_not_spendable(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        db_session,
    ):
        """A purchase stays `pending` until the Stripe webhook lands (story 2.3)."""
        purchase = await _make_purchase(
            db_session,
            org=test_org,
            user=test_user,
            package=test_package,
            hours="10",
            status=PurchaseStatus.pending,
        )

        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 409, resp.text

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("10.00")

    async def test_expired_purchase_is_rejected(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        db_session,
    ):
        purchase = await _make_purchase(
            db_session,
            org=test_org,
            user=test_user,
            package=test_package,
            hours="10",
            expires_in_days=-1,
        )

        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 409, resp.text

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("10.00")

    async def test_purchase_from_another_org_is_not_spendable_here(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_user,
        db_session,
    ):
        """Hours are tenant-scoped: another org's package cannot pay here (§4)."""
        other_org = Organization(
            name="Other Org", slug="other-org", plan=OrgPlan.starter, settings={}
        )
        db_session.add(other_org)
        await db_session.flush()
        other_package = Package(
            org_id=other_org.id,
            name="Other Pack",
            hours=10,
            price=Decimal("99.00"),
            validity_days=180,
        )
        db_session.add(other_package)
        await db_session.commit()
        await db_session.refresh(other_org)
        await db_session.refresh(other_package)

        purchase = await _make_purchase(
            db_session, org=other_org, user=test_user, package=other_package, hours="10"
        )

        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 409, resp.text

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("10.00")


class TestRedeemConcurrency:
    """The last hour must not be sold twice.

    Both tests run against real PostgreSQL connections — the row lock is the
    only thing standing between them and a double spend.
    """

    async def test_two_concurrent_bookings_only_one_wins(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        db_session,
        payments,
    ):
        purchase = await _make_purchase(
            db_session, org=test_org, user=test_user, package=test_package, hours="2"
        )

        # Different slots, so the only thing the two requests contend for is
        # the single 2-hour balance.
        first, second = await asyncio.gather(
            _book_with_package(client, auth_headers, test_room, days_offset=0),
            _book_with_package(client, auth_headers, test_room, days_offset=1),
        )

        assert sorted([first.status_code, second.status_code]) == [201, 409], (
            first.text,
            second.text,
        )

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("0.00")
        assert purchase.hours_used == Decimal("2.00")

        booked = await db_session.execute(
            select(func.count(Booking.id)).where(
                Booking.user_id == test_user.id,
                Booking.payment_method == PaymentMethod.package,
            )
        )
        assert booked.scalar_one() == 1

    async def test_second_redeemer_blocks_on_the_row_lock_then_re_checks(
        self,
        session_factory,
        db_session,
        test_org,
        test_user,
        test_package,
    ):
        """Prove the row lock — not the scheduler — is what serializes redemption.

        Two live connections: the first holds `SELECT ... FOR UPDATE` on the
        purchase without committing; the second must park on that lock instead
        of reading the pre-deduction balance and overdrawing it.
        """
        purchase = await _make_purchase(
            db_session, org=test_org, user=test_user, package=test_package, hours="2"
        )
        args = {
            "user_id": test_user.id,
            "org_id": test_org.id,
            "hours": Decimal("2.00"),
            "now": datetime.now(tz=timezone.utc),
        }

        async with session_factory() as first, session_factory() as second:
            winner = await package_hours.redeem_hours(first, **args)
            assert winner is not None
            assert winner.hours_remaining == Decimal("0.00")

            contender = asyncio.create_task(package_hours.redeem_hours(second, **args))
            await asyncio.sleep(0.3)
            # The first transaction has not committed, so the contender is
            # parked on the lock. Without FOR UPDATE it would already have read
            # 2 spendable hours and deducted them a second time.
            assert not contender.done()

            await first.commit()

            assert await asyncio.wait_for(contender, timeout=10) is None
            await second.rollback()

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("0.00")
        assert purchase.hours_used == Decimal("2.00")


class TestHourlyPathUnchanged:
    async def test_hourly_booking_still_gets_a_checkout_url(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        """An available package must not silently pay for an hourly booking."""
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["booking"]["status"] == "pending"
        assert body["checkout_url"]
        assert len(payments.sessions) == 1

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("10.00")


class TestRefundOnCancel:
    """Cancelling gives the hours back to the purchase they came from.

    The invariant under test throughout is
    `hours_used + hours_remaining == hours_total` — a booking must never be able
    to consume hours permanently once it is cancelled.
    """

    async def test_cancelling_credits_the_hours_back(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        created = await _book_with_package(client, auth_headers, test_room)
        assert created.status_code == 201, created.text
        booking_id = created.json()["booking"]["id"]

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("8.00")

        cancelled = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert cancelled.status_code == 204, cancelled.text

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("10.00")
        assert active_purchase.hours_used == Decimal("0.00")
        assert (
            active_purchase.hours_used + active_purchase.hours_remaining
            == active_purchase.hours_total
        )

    async def test_refunded_hours_are_spendable_again(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        payments,
        db_session,
    ):
        """The whole point of the refund: the customer is made whole."""
        purchase = await _make_purchase(
            db_session, org=test_org, user=test_user, package=test_package, hours="2"
        )

        first = await _book_with_package(client, auth_headers, test_room)
        assert first.status_code == 201, first.text

        # Balance is now zero, so a second booking cannot be paid for.
        blocked = await _book_with_package(
            client, auth_headers, test_room, days_offset=1
        )
        assert blocked.status_code == 409, blocked.text

        cancelled = await client.delete(
            f"/api/v1/bookings/{first.json()['booking']['id']}", headers=auth_headers
        )
        assert cancelled.status_code == 204, cancelled.text

        retried = await _book_with_package(
            client, auth_headers, test_room, days_offset=1
        )
        assert retried.status_code == 201, retried.text

        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("0.00")
        assert purchase.hours_used == Decimal("2.00")

    async def test_cancelling_twice_refunds_once(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        """A repeated DELETE must not mint hours out of nothing."""
        created = await _book_with_package(client, auth_headers, test_room)
        booking_id = created.json()["booking"]["id"]

        first = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert first.status_code == 204
        second = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert second.status_code == 400, second.text

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("10.00")
        assert active_purchase.hours_used == Decimal("0.00")

    async def test_cancelling_an_hourly_booking_touches_no_package(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        db_session,
        active_purchase,
    ):
        start, end = _future_slot()
        created = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert created.status_code == 201, created.text

        cancelled = await client.delete(
            f"/api/v1/bookings/{created.json()['booking']['id']}",
            headers=auth_headers,
        )
        assert cancelled.status_code == 204

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("10.00")
        assert active_purchase.hours_used == Decimal("0.00")


class TestAdminStatusChangesMoveHours:
    """An admin flipping the status moves hours exactly like a member cancel.

    Without this the admin panel is a hole in the ledger: an admin-cancelled
    package booking would burn the customer's prepaid hours.
    """

    async def test_admin_cancel_credits_the_hours_back(
        self,
        client,
        auth_headers,
        admin_headers,
        test_room,
        test_member,
        test_org,
        payments,
        db_session,
        active_purchase,
    ):
        created = await _book_with_package(client, auth_headers, test_room)
        booking_id = created.json()["booking"]["id"]

        updated = await client.put(
            f"/api/v1/admin/bookings/{booking_id}",
            params={"org_id": str(test_org.id)},
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert updated.status_code == 200, updated.text

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("10.00")
        assert active_purchase.hours_used == Decimal("0.00")

    async def test_admin_reinstating_takes_the_hours_back(
        self,
        client,
        auth_headers,
        admin_headers,
        test_room,
        test_member,
        test_org,
        payments,
        db_session,
        active_purchase,
    ):
        """Cancel then re-confirm must not hand out a free booking."""
        created = await _book_with_package(client, auth_headers, test_room)
        booking_id = created.json()["booking"]["id"]

        for new_status in ("cancelled", "confirmed"):
            resp = await client.put(
                f"/api/v1/admin/bookings/{booking_id}",
                params={"org_id": str(test_org.id)},
                json={"status": new_status},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text

        await db_session.refresh(active_purchase)
        assert active_purchase.hours_remaining == Decimal("8.00")
        assert active_purchase.hours_used == Decimal("2.00")

    async def test_admin_reinstating_fails_when_the_hours_are_gone(
        self,
        client,
        auth_headers,
        admin_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        payments,
        db_session,
    ):
        """The refunded hours can legitimately be spent before the re-confirm."""
        purchase = await _make_purchase(
            db_session, org=test_org, user=test_user, package=test_package, hours="2"
        )
        created = await _book_with_package(client, auth_headers, test_room)
        booking_id = created.json()["booking"]["id"]

        cancelled = await client.put(
            f"/api/v1/admin/bookings/{booking_id}",
            params={"org_id": str(test_org.id)},
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert cancelled.status_code == 200, cancelled.text

        # The customer immediately rebooks elsewhere with the refunded hours.
        rebooked = await _book_with_package(
            client, auth_headers, test_room, days_offset=1
        )
        assert rebooked.status_code == 201, rebooked.text

        reinstated = await client.put(
            f"/api/v1/admin/bookings/{booking_id}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert reinstated.status_code == 409, reinstated.text

        # The failed reinstatement changed nothing.
        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal("0.00")
        assert purchase.hours_used == Decimal("2.00")

        listed = await client.get("/api/v1/bookings/me", headers=auth_headers)
        statuses = {b["id"]: b["status"] for b in listed.json()["bookings"]}
        assert statuses[booking_id] == "cancelled"


class TestRedemptionEmails:
    """Epic 4 sends a confirmation whenever a booking becomes `confirmed`.

    A package booking confirms inside `create_booking` and never reaches the
    Stripe webhook that sends the mail for hourly bookings, so it needs its own
    hook — otherwise prepaid customers are the only ones who hear nothing.
    """

    async def test_package_booking_sends_a_confirmation_email(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_user,
        payments,
        emails,
        active_purchase,
    ):
        resp = await _book_with_package(client, auth_headers, test_room)
        assert resp.status_code == 201, resp.text

        assert len(emails.sent) == 1
        message = emails.sent[0]
        assert message.to == test_user.email
        assert "confirmada" in message.subject.lower()

    async def test_hourly_booking_still_waits_for_the_webhook(
        self, client, auth_headers, test_room, test_member, payments, emails
    ):
        """Creating an unpaid booking must not claim it is confirmed."""
        start, end = _future_slot()
        resp = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert emails.sent == []

    async def test_cancelling_a_package_booking_sends_the_cancellation_email(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        payments,
        emails,
        active_purchase,
    ):
        created = await _book_with_package(client, auth_headers, test_room)
        booking_id = created.json()["booking"]["id"]

        cancelled = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert cancelled.status_code == 204

        subjects = [m.subject.lower() for m in emails.sent]
        assert any("cancel" in s for s in subjects), subjects


class TestLinkedPurchase:
    async def test_booking_records_which_purchase_paid_for_it(
        self,
        client,
        auth_headers,
        test_room,
        test_member,
        test_org,
        test_user,
        test_package,
        payments,
        db_session,
    ):
        """With two purchases, the refund has to know which one was debited."""
        soon = await _make_purchase(
            db_session,
            org=test_org,
            user=test_user,
            package=test_package,
            hours="5",
            expires_in_days=10,
        )
        later = await _make_purchase(
            db_session,
            org=test_org,
            user=test_user,
            package=test_package,
            hours="5",
            expires_in_days=200,
        )
        assert soon.expires_at < later.expires_at

        created = await _book_with_package(client, auth_headers, test_room)
        assert created.status_code == 201, created.text

        booking = await db_session.execute(
            select(Booking).where(
                Booking.id == uuid.UUID(created.json()["booking"]["id"])
            )
        )
        # Soonest-expiring hours are spent first so nothing lapses unused.
        assert booking.scalar_one().package_purchase_id == soon.id

        await db_session.refresh(soon)
        await db_session.refresh(later)
        assert soon.hours_remaining == Decimal("3.00")
        assert later.hours_remaining == Decimal("5.00")

    async def test_hourly_booking_records_no_purchase(
        self, client, auth_headers, test_room, test_member, payments, db_session
    ):
        start, end = _future_slot()
        created = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert created.status_code == 201, created.text

        booking = await db_session.execute(
            select(Booking).where(
                Booking.id == uuid.UUID(created.json()["booking"]["id"])
            )
        )
        assert booking.scalar_one().package_purchase_id is None


class TestRevenueAccounting:
    async def test_package_bookings_do_not_count_as_booking_revenue(
        self,
        client,
        auth_headers,
        admin_headers,
        test_room,
        test_member,
        test_org,
        payments,
        active_purchase,
    ):
        """The pack was paid for when it was bought, not when it is spent.

        Counting the slot's rack rate again here would report revenue that was
        never charged — and packs are sold at a discount, so it would not even
        be the right number.
        """
        booked = await _book_with_package(client, auth_headers, test_room)
        assert booked.status_code == 201, booked.text

        stats = await client.get(
            "/api/v1/admin/dashboard",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        assert stats.status_code == 200, stats.text
        body = stats.json()
        assert body["total_revenue"] == 0
        # The booking itself still counts — it occupies the room.
        assert body["total_bookings"] == 1

    async def test_hourly_bookings_still_count_as_revenue(
        self,
        client,
        auth_headers,
        admin_headers,
        test_room,
        test_member,
        test_org,
        payments,
        db_session,
    ):
        start, end = _future_slot()
        created = await client.post(
            "/api/v1/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start,
                "end_time": end,
                "payment_method": "hourly",
            },
            headers=auth_headers,
        )
        assert created.status_code == 201, created.text

        # Only a confirmed booking counts, so walk it through the admin path.
        confirmed = await client.put(
            f"/api/v1/admin/bookings/{created.json()['booking']['id']}",
            params={"org_id": str(test_org.id)},
            json={"status": "confirmed"},
            headers=admin_headers,
        )
        assert confirmed.status_code == 200, confirmed.text

        stats = await client.get(
            "/api/v1/admin/dashboard",
            params={"org_id": str(test_org.id)},
            headers=admin_headers,
        )
        # 2h at the seeded 11.00/h.
        assert stats.json()["total_revenue"] == 22.0


@pytest.mark.parametrize("actors,target", [
    (("member", "member"), "cancelled"),
    (("member", "admin"), "cancelled"),
    (("admin", "admin"), "cancelled"),
    (("admin", "admin"), "confirmed"),
])
async def test_concurrent_status_transition_moves_hours_once(
    client, auth_headers, admin_headers, test_room, test_member, test_org,
    payments, emails, db_session, session_factory, active_purchase, actors, target,
):
    created = await _book_with_package(client, auth_headers, test_room)
    assert created.status_code == 201, created.text
    booking_id = created.json()["booking"]["id"]
    if target == "confirmed":
        cancelled = await client.delete(
            f"/api/v1/bookings/{booking_id}", headers=auth_headers
        )
        assert cancelled.status_code == 204, cancelled.text
    emails.sent.clear()

    async def transition(actor):
        if actor == "member":
            return await client.delete(
                f"/api/v1/bookings/{booking_id}", headers=auth_headers
            )
        return await client.put(
            f"/api/v1/admin/bookings/{booking_id}",
            params={"org_id": str(test_org.id)},
            json={"status": target}, headers=admin_headers,
        )

    async with session_factory() as blocker, session_factory() as observer:
        await blocker.execute(
            select(Booking).where(Booking.id == uuid.UUID(booking_id)).with_for_update()
        )
        requests = [asyncio.create_task(transition(actor)) for actor in actors]
        try:
            # Hold the row until both HTTP transactions are waiting in PostgreSQL.
            # Without the route lock both can decide from the old booking status.
            async def both_waiting():
                while True:
                    count = await observer.scalar(text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND wait_event_type = 'Lock'"
                    ))
                    await observer.rollback()
                    if count >= 2:
                        return
                    await asyncio.sleep(0.01)
            await asyncio.wait_for(both_waiting(), timeout=10)
            await blocker.commit()
            responses = await asyncio.wait_for(asyncio.gather(*requests), timeout=10)
        finally:
            await blocker.rollback()
            for request in requests:
                if not request.done():
                    request.cancel()
            await asyncio.gather(*requests, return_exceptions=True)

    codes = sorted(response.status_code for response in responses)
    if actors == ("member", "member"):
        assert codes == [204, 400]
    elif actors == ("member", "admin"):
        assert codes in ([200, 204], [200, 400])
    else:
        assert codes == [200, 200]
    await db_session.refresh(active_purchase)
    assert active_purchase.hours_remaining == Decimal("10" if target == "cancelled" else "8")
    assert active_purchase.hours_used == Decimal("0" if target == "cancelled" else "2")
    booking = await db_session.get(Booking, uuid.UUID(booking_id))
    assert booking.status.value == target
    assert len(emails.sent) == 1


async def test_package_confirmation_issues_access_and_cancel_revokes_it(
    client, auth_headers, test_room, test_member, payments, active_purchase, locks,
):
    response = await _book_with_package(client, auth_headers, test_room)
    assert response.status_code == 201, response.text
    booking = response.json()["booking"]
    booking_id = uuid.UUID(booking["id"])
    assert booking["access_code"] == locks.issued_code_for(booking_id).code
    cancelled = await client.delete(f"/api/v1/bookings/{booking_id}", headers=auth_headers)
    assert cancelled.status_code == 204, cancelled.text
    assert locks.issued_code_for(booking_id) is None
