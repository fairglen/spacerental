"""A01 — what an operator needs to be able to do with a booking.

Reschedule/move, create for a customer with `manual` payment, mark as paid,
and a private note. Every path is tenant-scoped first. No money is ever moved
by an operator action: a changed duration is reported, not charged.
"""

import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import clock
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.space import AvailabilityRule, Room
from app.models.user import User
from app.payments import CheckoutKind
from sqlalchemy import select

from tests.conftest import checkout_completed_event

API = "/api/v1"


def _monday(days_out: int = 14, hour: int = 10) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    day = today + timedelta(days=days_ahead + days_out)
    return datetime.combine(day, time(hour, 0), tzinfo=UTC)


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


async def _db_booking(db_session, booking_id) -> Booking:
    return (
        await db_session.execute(
            select(Booking)
            .where(Booking.id == uuid.UUID(str(booking_id)))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _customer_booking(client, auth_headers, room, start: datetime, hours=1, method="hourly"):
    resp = await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            "payment_method": method,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["booking"]


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
async def other_org(db_session) -> tuple[Organization, Room, dict]:
    """Another tenant: its org, a room in it, and its owner's headers."""
    org = Organization(name="Other", slug="other", plan=OrgPlan.starter, settings={})
    op = User(email="other-op@test.com", name="Op", password_hash=hash_password("x" * 12))
    db_session.add_all([org, op])
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=op.id, role=MemberRole.owner))
    from app.models.space import Space

    space = Space(org_id=org.id, name="Other space", images=[], amenities=[])
    db_session.add(space)
    await db_session.flush()
    room = Room(
        space_id=space.id,
        org_id=org.id,
        name="Other room",
        capacity=1,
        hourly_rate=Decimal("9.00"),
        color="#fff",
        images=[],
        amenities=[],
    )
    db_session.add(room)
    await db_session.commit()
    headers = {
        "Authorization": "Bearer "
        + create_access_token({"sub": str(op.id), "email": op.email, "name": op.name})
    }
    return org, room, headers


class TestReschedule:
    async def test_moves_a_paid_booking_to_another_time_and_emails_the_customer(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        payments,
        emails,
        db_session,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday(), hours=2)
        await _pay(client, payments, booking)
        emails.sent.clear()
        new_start = _monday(hour=14)
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=2)).isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["booking"]["start_time"].startswith(new_start.strftime("%Y-%m-%dT14:00"))
        assert body["booking"]["status"] == "confirmed"
        assert Decimal(body["booking"]["total_amount"]) == Decimal("22.00")
        assert body["hours"] == {"before": "2.00", "after": "2.00"}
        # Exactly one email, the confirmation, saying the booking changed.
        assert len(emails.sent) == 1
        assert "alterada" in emails.sent[0].text_body
        # Rendered in Lisbon time: 14:00 UTC is 15:00 there in summer.
        assert "15:00 às 17:00" in emails.sent[0].text_body

    async def test_a_changed_duration_moves_no_money_and_reports_both_hour_counts(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        payments,
        db_session,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday(), hours=2)
        await _pay(client, payments, booking)
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"end_time": (_monday() + timedelta(hours=3)).isoformat()},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["hours"] == {"before": "2.00", "after": "3.00"}
        stored = await _db_booking(db_session, booking["id"])
        assert stored.duration_hours == Decimal("3.00")
        # Charged for two hours; still charged for two. The admin settles it.
        assert stored.total_amount == Decimal("22.00")
        # No new Checkout Session was minted for the difference.
        assert len(payments.sessions) == 1

    async def test_moves_to_another_room_of_the_same_org(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        second_room,
        test_member,
        payments,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"room_id": str(second_room.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["room_id"] == str(second_room.id)

    async def test_cannot_move_to_another_orgs_room(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member, other_org
    ):
        _, foreign_room, _ = other_org
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"room_id": str(foreign_room.id)},
            headers=admin_headers,
        )
        assert resp.status_code == 404, resp.text

    async def test_no_24h_rule_for_admins_but_the_same_validity_and_conflicts(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        monkeypatch,
        payments,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        other = await _customer_booking(client, auth_headers, test_room, _monday(hour=15))
        # Paid, so it still holds its slot once the clock below moves weeks
        # ahead (an unpaid hold would have lapsed by then).
        await _pay(client, payments, other)
        url = f"{API}/admin/bookings/{booking['id']}"
        # Inside 24h: allowed for an operator.
        monkeypatch.setattr(clock, "utcnow", lambda: _monday() - timedelta(hours=2))
        soon = _monday(hour=12)
        ok = await client.put(
            url,
            params=_org(test_org),
            json={
                "start_time": soon.isoformat(),
                "end_time": (soon + timedelta(hours=1)).isoformat(),
            },
            headers=admin_headers,
        )
        assert ok.status_code == 200, ok.text
        # Outside opening hours, in the past, onto another booking: refused.
        closed = _monday(hour=22)
        assert (
            await client.put(
                url,
                params=_org(test_org),
                json={
                    "start_time": closed.isoformat(),
                    "end_time": (closed + timedelta(hours=1)).isoformat(),
                },
                headers=admin_headers,
            )
        ).status_code == 400
        past = _monday() - timedelta(days=30)
        assert (
            await client.put(
                url,
                params=_org(test_org),
                json={
                    "start_time": past.isoformat(),
                    "end_time": (past + timedelta(hours=1)).isoformat(),
                },
                headers=admin_headers,
            )
        ).status_code == 400
        taken = await client.put(
            url,
            params=_org(test_org),
            json={
                "start_time": _monday(hour=15).isoformat(),
                "end_time": _monday(hour=16).isoformat(),
            },
            headers=admin_headers,
        )
        assert taken.status_code == 409, taken.text
        assert other["id"] != booking["id"]

    async def test_another_orgs_admin_gets_404_and_nothing_moves(
        self, client, auth_headers, test_org, test_room, test_member, other_org, db_session
    ):
        foreign_org, _, headers = other_org
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params={"org_id": str(foreign_org.id)},
            json={
                "start_time": _monday(hour=14).isoformat(),
                "end_time": _monday(hour=15).isoformat(),
            },
            headers=headers,
        )
        assert resp.status_code == 404, resp.text
        stored = await _db_booking(db_session, booking["id"])
        assert stored.start_time == _monday()

    async def test_a_plain_status_change_still_works_and_reports_no_hours(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["status"] == "cancelled"
        assert "hours" not in resp.json()


class TestManualBooking:
    async def test_creates_a_confirmed_booking_for_a_member_with_code_and_email(
        self,
        client,
        admin_headers,
        test_org,
        test_room,
        test_user,
        test_member,
        emails,
        locks,
        db_session,
    ):
        start = _monday()
        resp = await client.post(
            f"{API}/admin/bookings",
            params=_org(test_org),
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=2)).isoformat(),
                "admin_note": "Pago em dinheiro no balcão",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
        assert booking["status"] == "confirmed"
        assert booking["payment_method"] == "manual"
        assert booking["user_id"] == str(test_user.id)
        assert Decimal(booking["total_amount"]) == Decimal("22.00")
        assert booking["admin_note"] == "Pago em dinheiro no balcão"
        assert booking["access_code"] and len(booking["access_code"]) == 6
        [message] = emails.sent
        assert message.to == test_user.email
        assert "confirmada" in message.subject

    async def test_the_customer_must_be_a_member_of_the_org(
        self, client, admin_headers, test_org, test_room, test_user
    ):
        # test_user without test_member: not enrolled here.
        start = _monday()
        resp = await client.post(
            f"{API}/admin/bookings",
            params=_org(test_org),
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 404, resp.text

    async def test_same_conflict_checks_as_a_customer_booking(
        self, client, auth_headers, admin_headers, test_org, test_room, test_user, test_member
    ):
        await _customer_booking(client, auth_headers, test_room, _monday())
        start = _monday()
        resp = await client.post(
            f"{API}/admin/bookings",
            params=_org(test_org),
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text

    async def test_the_customer_api_rejects_manual(
        self, client, auth_headers, test_room, test_member, db_session
    ):
        start = _monday()
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "payment_method": "manual",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert (await db_session.execute(select(Booking))).scalars().all() == []

    async def test_another_orgs_admin_cannot_book_our_room(
        self, client, test_org, test_room, test_user, test_member, other_org
    ):
        foreign_org, _, headers = other_org
        start = _monday()
        resp = await client.post(
            f"{API}/admin/bookings",
            params={"org_id": str(foreign_org.id)},
            json={
                "user_id": str(test_user.id),
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
            },
            headers=headers,
        )
        assert resp.status_code == 404, resp.text


class TestMarkPaid:
    async def test_a_pending_hourly_hold_becomes_confirmed_manual_with_code_and_email(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        payments,
        emails,
        db_session,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        emails.sent.clear()
        resp = await client.post(
            f"{API}/admin/bookings/{booking['id']}/mark-paid",
            params=_org(test_org),
            json={"reason": "Pagou por MB WAY"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        paid = resp.json()["booking"]
        assert paid["status"] == "confirmed"
        assert paid["payment_method"] == "manual"
        assert paid["hold_expires_at"] is None
        assert paid["access_code"]
        assert "Pagou por MB WAY" in paid["admin_note"]
        assert len(emails.sent) == 1
        # The open Checkout session was closed at the provider (the stub drops it).
        assert f"cs_stub_{uuid.UUID(booking['id']).hex}" not in payments.sessions

    async def test_a_late_webhook_after_mark_paid_does_not_double_confirm(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        payments,
        emails,
        locks,
        db_session,
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        await client.post(
            f"{API}/admin/bookings/{booking['id']}/mark-paid",
            params=_org(test_org),
            json={"reason": "cash"},
            headers=admin_headers,
        )
        emails.sent.clear()
        result = await _pay(client, payments, booking)
        assert result["handled"] is False
        stored = await _db_booking(db_session, booking["id"])
        assert stored.status is BookingStatus.confirmed
        assert stored.payment_method is PaymentMethod.manual
        assert emails.sent == []

    async def test_a_mixed_hold_keeps_its_pack_share(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        test_user,
        payments,
        db_session,
    ):
        pack = Package(org_id=test_org.id, name="P", hours=10, price=Decimal(1), validity_days=30)
        db_session.add(pack)
        await db_session.flush()
        now = datetime.now(tz=UTC)
        purchase = UserPackagePurchase(
            user_id=test_user.id,
            package_id=pack.id,
            org_id=test_org.id,
            hours_total=Decimal(1),
            hours_used=Decimal(0),
            hours_remaining=Decimal(1),
            purchased_at=now,
            expires_at=now + timedelta(days=30),
            status=PurchaseStatus.active,
        )
        db_session.add(purchase)
        await db_session.commit()
        booking = await _customer_booking(client, auth_headers, test_room, _monday(), 2, "mixed")
        assert booking["payment_method"] == "mixed"
        resp = await client.post(
            f"{API}/admin/bookings/{booking['id']}/mark-paid",
            params=_org(test_org),
            json={"reason": "cash for the extra hour"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["payment_method"] == "manual"
        assert Decimal(resp.json()["booking"]["package_hours_used"]) == Decimal(1)
        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal(0)

    @pytest.mark.parametrize("state", ["confirmed", "package", "cancelled"])
    async def test_only_an_unpaid_hourly_or_mixed_hold_can_be_marked(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        test_user,
        payments,
        db_session,
        state,
    ):
        if state == "package":
            pack = Package(
                org_id=test_org.id, name="P", hours=10, price=Decimal(1), validity_days=30
            )
            db_session.add(pack)
            await db_session.flush()
            now = datetime.now(tz=UTC)
            db_session.add(
                UserPackagePurchase(
                    user_id=test_user.id,
                    package_id=pack.id,
                    org_id=test_org.id,
                    hours_total=Decimal(5),
                    hours_used=Decimal(0),
                    hours_remaining=Decimal(5),
                    purchased_at=now,
                    expires_at=now + timedelta(days=30),
                    status=PurchaseStatus.active,
                )
            )
            await db_session.commit()
            booking = await _customer_booking(
                client, auth_headers, test_room, _monday(), 1, "package"
            )
        else:
            booking = await _customer_booking(client, auth_headers, test_room, _monday())
            if state == "confirmed":
                await _pay(client, payments, booking)
            else:
                await client.delete(f"{API}/bookings/{booking['id']}", headers=auth_headers)
        resp = await client.post(
            f"{API}/admin/bookings/{booking['id']}/mark-paid",
            params=_org(test_org),
            json={"reason": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text

    async def test_a_reason_is_required_and_another_org_gets_404(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member, other_org
    ):
        foreign_org, _, headers = other_org
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        url = f"{API}/admin/bookings/{booking['id']}/mark-paid"
        assert (
            await client.post(url, params=_org(test_org), json={}, headers=admin_headers)
        ).status_code == 422
        assert (
            await client.post(
                url, params=_org(test_org), json={"reason": ""}, headers=admin_headers
            )
        ).status_code == 422
        assert (
            await client.post(
                url, params={"org_id": str(foreign_org.id)}, json={"reason": "x"}, headers=headers
            )
        ).status_code == 404


class TestAdminNote:
    async def test_the_note_is_set_by_the_operator_and_never_shown_to_the_customer(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member, payments
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"admin_note": "Cliente pediu a sala mais silenciosa"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["admin_note"] == "Cliente pediu a sala mais silenciosa"

        mine = await client.get(f"{API}/bookings/me", headers=auth_headers)
        [row] = mine.json()["bookings"]
        assert "admin_note" not in row
        assert "silenciosa" not in mine.text
        # Nor from any customer-facing route that returns a booking.
        resumed = await client.post(
            f"{API}/bookings/{booking['id']}/checkout", headers=auth_headers
        )
        assert "silenciosa" not in resumed.text

    async def test_the_customer_cannot_write_it(self, client, auth_headers, test_room, test_member):
        start = _monday()
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(test_room.id),
                "start_time": start.isoformat(),
                "end_time": (start + timedelta(hours=1)).isoformat(),
                "admin_note": "sneaky",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert "sneaky" not in resp.text

    async def test_the_operator_list_shows_it(
        self, client, auth_headers, admin_headers, test_org, test_room, test_member
    ):
        booking = await _customer_booking(client, auth_headers, test_room, _monday())
        await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"admin_note": "nota interna"},
            headers=admin_headers,
        )
        listed = await client.get(
            f"{API}/admin/bookings", params=_org(test_org), headers=admin_headers
        )
        assert listed.json()["bookings"][0]["admin_note"] == "nota interna"


class TestAdminCancelSharesTheCustomerPath:
    async def test_admin_cancel_restores_pack_hours_and_frees_the_slot(
        self,
        client,
        auth_headers,
        admin_headers,
        test_org,
        test_room,
        test_member,
        test_user,
        db_session,
    ):
        pack = Package(org_id=test_org.id, name="P", hours=10, price=Decimal(1), validity_days=30)
        db_session.add(pack)
        await db_session.flush()
        now = datetime.now(tz=UTC)
        purchase = UserPackagePurchase(
            user_id=test_user.id,
            package_id=pack.id,
            org_id=test_org.id,
            hours_total=Decimal(5),
            hours_used=Decimal(0),
            hours_remaining=Decimal(5),
            purchased_at=now,
            expires_at=now + timedelta(days=30),
            status=PurchaseStatus.active,
        )
        db_session.add(purchase)
        await db_session.commit()
        booking = await _customer_booking(client, auth_headers, test_room, _monday(), 2, "package")
        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal(3)

        resp = await client.put(
            f"{API}/admin/bookings/{booking['id']}",
            params=_org(test_org),
            json={"status": "cancelled"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        await db_session.refresh(purchase)
        assert purchase.hours_remaining == Decimal(5)
        again = await _customer_booking(client, auth_headers, test_room, _monday(), 2, "package")
        assert again["status"] == "confirmed"
