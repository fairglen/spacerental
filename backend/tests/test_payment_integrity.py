"""S05: what may confirm a booking or activate a package, and what may not.

`test_webhooks.py` already pins the signature itself: missing, invalid,
replayed, another org's booking event, an unpaid session, an unknown session.
This file pins the bindings around it. A correctly signed event acts on
exactly one row: the one whose id, org and checkout session all match. The
amount is the server's. Live mode has no stub surface. A door code exists only
for a confirmed booking.
"""

import time as clock_time
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import clock
from app.auth import create_access_token, hash_password
from app.main import app
from app.models.booking import Booking, BookingStatus
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.user import User
from app.payments import (
    DEFAULT_STUB_WEBHOOK_SECRET,
    SIGNATURE_TOLERANCE_SECONDS,
    CheckoutKind,
    StripeGateway,
    StubPaymentGateway,
    get_payment_gateway,
)
from sqlalchemy import func, select

from tests.conftest import checkout_completed_event

API = "/api/v1"
WEBHOOK = f"{API}/webhooks/stripe"


def _monday(hour: int) -> datetime:
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days_ahead + 7), time(hour, 0), tzinfo=UTC)


async def _book(client, headers, room, hour: int, hours: int = 1, **extra):
    start = _monday(hour)
    return await client.post(
        f"{API}/bookings",
        json={
            "room_id": str(room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=hours)).isoformat(),
            **extra,
        },
        headers=headers,
    )


def _session_of(booking_or_purchase_id: str) -> str:
    # The stub derives its session id from the row it charges for.
    return f"cs_stub_{uuid.UUID(booking_or_purchase_id).hex}"


async def _deliver(client, payments, payload: bytes, *, signature: str | None = None):
    header = payments.sign_payload(payload) if signature is None else signature
    return await client.post(WEBHOOK, content=payload, headers={"Stripe-Signature": header})


async def _booking(db_session, booking_id: str) -> Booking:
    result = await db_session.execute(
        select(Booking)
        .where(Booking.id == uuid.UUID(booking_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _purchase(db_session, purchase_id: str) -> UserPackagePurchase:
    result = await db_session.execute(
        select(UserPackagePurchase)
        .where(UserPackagePurchase.id == uuid.UUID(purchase_id))
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


@pytest_asyncio.fixture
async def package(db_session, test_org) -> Package:
    row = Package(
        org_id=test_org.id, name="Pack 10", hours=10, price=Decimal("99.00"), validity_days=180
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


@pytest_asyncio.fixture
async def pending_purchase(client, auth_headers, test_member, test_org, package) -> dict:
    resp = await client.post(
        f"{API}/packages/{package.id}/purchase",
        json={"org_id": str(test_org.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["purchase"]["status"] == "pending"
    return resp.json()["purchase"]


class TestAnEventActsOnExactlyOneRow:
    async def test_a_booking_cannot_be_confirmed_through_another_bookings_session(
        self, client, db_session, auth_headers, test_member, test_room, payments
    ):
        cheap = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        dear = (await _book(client, auth_headers, test_room, 11, hours=8)).json()["booking"]
        # Paid for the cheap one, asks for the dear one, and the other way round.
        for session_owner, target in ((cheap, dear), (dear, cheap)):
            payload = checkout_completed_event(
                session_id=_session_of(session_owner["id"]),
                kind=CheckoutKind.booking,
                reference_id=target["id"],
                org_id=target["org_id"],
            )
            resp = await _deliver(client, payments, payload)
            assert resp.status_code == 200, resp.text
            assert resp.json()["handled"] is False
        for row in (cheap, dear):
            assert (await _booking(db_session, row["id"])).status is BookingStatus.pending

    async def test_an_event_of_one_kind_never_touches_a_row_of_the_other(
        self, client, db_session, auth_headers, test_member, test_room, payments, pending_purchase
    ):
        booking = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        for kind, row in (
            (CheckoutKind.package_purchase, booking),
            (CheckoutKind.booking, pending_purchase),
        ):
            payload = checkout_completed_event(
                session_id=_session_of(row["id"]),
                kind=kind,
                reference_id=row["id"],
                org_id=row["org_id"],
            )
            resp = await _deliver(client, payments, payload)
            assert (resp.status_code, resp.json()["handled"]) == (200, False), resp.text
        assert (await _booking(db_session, booking["id"])).status is BookingStatus.pending
        assert (
            await _purchase(db_session, pending_purchase["id"])
        ).status is PurchaseStatus.pending

    async def test_a_purchase_event_naming_another_org_activates_nothing(
        self, client, db_session, payments, pending_purchase
    ):
        payload = checkout_completed_event(
            session_id=_session_of(pending_purchase["id"]),
            kind=CheckoutKind.package_purchase,
            reference_id=pending_purchase["id"],
            org_id=uuid.uuid4(),
        )
        resp = await _deliver(client, payments, payload)
        assert (resp.status_code, resp.json()["handled"]) == (200, False), resp.text
        assert (
            await _purchase(db_session, pending_purchase["id"])
        ).status is PurchaseStatus.pending

    async def test_a_duplicate_purchase_event_changes_no_balance(
        self, client, db_session, payments, pending_purchase
    ):
        payload = checkout_completed_event(
            session_id=_session_of(pending_purchase["id"]),
            kind=CheckoutKind.package_purchase,
            reference_id=pending_purchase["id"],
            org_id=pending_purchase["org_id"],
        )
        handled = [(await _deliver(client, payments, payload)).json()["handled"] for _ in range(3)]
        assert handled == [True, False, False]
        purchase = await _purchase(db_session, pending_purchase["id"])
        assert purchase.status is PurchaseStatus.active
        assert (purchase.hours_total, purchase.hours_used, purchase.hours_remaining) == (
            Decimal("10.00"),
            Decimal("0.00"),
            Decimal("10.00"),
        )

    @pytest.mark.parametrize(
        "skew", [-(SIGNATURE_TOLERANCE_SECONDS + 60), SIGNATURE_TOLERANCE_SECONDS + 60]
    )
    async def test_a_valid_digest_outside_the_replay_window_is_refused(
        self, client, db_session, auth_headers, test_member, test_room, payments, skew
    ):
        booking = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        payload = checkout_completed_event(
            session_id=_session_of(booking["id"]),
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=booking["org_id"],
        )
        stale = payments.sign_payload(payload, timestamp=int(clock_time.time()) + skew)
        resp = await _deliver(client, payments, payload, signature=stale)
        assert resp.status_code == 400, resp.text
        assert (await _booking(db_session, booking["id"])).status is BookingStatus.pending


class TestTheAmountIsTheServers:
    async def test_a_booking_is_charged_rate_times_hours_whatever_the_client_sends(
        self, client, auth_headers, test_member, test_room, payments
    ):
        resp = await _book(
            client,
            auth_headers,
            test_room,
            9,
            hours=2,
            total_amount="0.01",
            amount="0.01",
            amount_cents=1,
            hourly_rate="0.01",
            currency="usd",
        )
        assert resp.status_code == 201, resp.text
        booking = resp.json()["booking"]
        session = payments.sessions[_session_of(booking["id"])]
        assert (session["amount_cents"], session["currency"]) == (2200, "eur")
        assert Decimal(str(booking["total_amount"])) == Decimal("22.00")

    async def test_a_purchase_is_charged_the_packages_price_and_ignores_a_hostile_body(
        self, client, db_session, auth_headers, test_member, test_org, test_user, package, payments
    ):
        resp = await client.post(
            f"{API}/packages/{package.id}/purchase",
            json={
                "org_id": str(test_org.id),
                "price": "0.01",
                "amount_cents": 1,
                "hours": 999,
                "hours_total": "999.00",
                "hours_remaining": "999.00",
                "status": "active",
                "user_id": str(uuid.uuid4()),
                "expires_at": "2099-01-01T00:00:00Z",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        purchase = await _purchase(db_session, resp.json()["purchase"]["id"])
        assert payments.sessions[_session_of(str(purchase.id))]["amount_cents"] == 9900
        assert purchase.status is PurchaseStatus.pending
        assert purchase.user_id == test_user.id
        assert (purchase.hours_total, purchase.hours_remaining) == (
            Decimal("10.00"),
            Decimal("10.00"),
        )
        assert purchase.expires_at < datetime.now(tz=UTC) + timedelta(days=181)


@contextmanager
def _live_mode(payments):
    """Serve the real gateway with made-up keys for the duration of the block.

    Nothing reaches the network: the stub routes refuse before any provider
    call, and Stripe verifies webhook signatures locally.
    """
    gateway = StripeGateway(
        secret_key="sk_test_not_a_real_key",
        webhook_secret="whsec_live_not_the_stub_secret",
        currency="eur",
        success_url="http://test/success",
        cancel_url="http://test/cancel",
    )
    app.dependency_overrides[get_payment_gateway] = lambda: gateway
    try:
        yield gateway
    finally:
        app.dependency_overrides[get_payment_gateway] = lambda: payments


class TestLiveModeHasNoStubSurface:
    async def test_every_stub_checkout_route_answers_404(
        self, client, db_session, auth_headers, test_member, test_room, payments
    ):
        booking = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        session_id = _session_of(booking["id"])
        # Control: in stub mode the page exists, so the 404s below mean "live".
        assert (await client.get(f"/checkout/stub/{session_id}")).status_code == 200
        with _live_mode(payments):
            page = await client.get(f"/checkout/stub/{session_id}")
            pay = await client.post(f"/checkout/stub/{session_id}/pay")
            cancel = await client.post(f"/checkout/stub/{session_id}/cancel")
        assert (page.status_code, pay.status_code, cancel.status_code) == (404, 404, 404)
        assert (await _booking(db_session, booking["id"])).status is BookingStatus.pending

    async def test_the_public_stub_secret_verifies_nothing(
        self, client, db_session, auth_headers, test_member, test_room, payments
    ):
        booking = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        payload = checkout_completed_event(
            session_id=_session_of(booking["id"]),
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=booking["org_id"],
        )
        forged = StubPaymentGateway(webhook_secret=DEFAULT_STUB_WEBHOOK_SECRET).sign_payload(
            payload
        )
        with _live_mode(payments):
            resp = await client.post(WEBHOOK, content=payload, headers={"Stripe-Signature": forged})
        assert resp.status_code == 400, resp.text
        assert (await _booking(db_session, booking["id"])).status is BookingStatus.pending


class TestADoorCodeExistsOnlyForAConfirmedBooking:
    async def test_no_code_while_pending_then_one_for_the_owner_and_never_by_email(
        self, client, db_session, auth_headers, test_member, test_room, payments, locks, emails
    ):
        booking = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        booking_id = uuid.UUID(booking["id"])
        assert booking["access_code"] is None
        assert locks.issued_code_for(booking_id) is None

        payload = checkout_completed_event(
            session_id=_session_of(booking["id"]),
            kind=CheckoutKind.booking,
            reference_id=booking["id"],
            org_id=booking["org_id"],
        )
        assert (await _deliver(client, payments, payload)).json()["handled"] is True
        issued = locks.issued_code_for(booking_id)
        assert issued is not None
        mine = await client.get(f"{API}/bookings/me", headers=auth_headers)
        assert [b["access_code"] for b in mine.json()["bookings"]] == [issued.code]
        assert emails.sent, "the confirmation email is this test's subject"
        for message in emails.sent:
            assert issued.code not in message.subject
            assert issued.code not in message.html_body
            assert issued.code not in message.text_body

    async def test_a_payment_that_lost_its_slot_gets_no_code(
        self,
        client,
        db_session,
        auth_headers,
        test_member,
        test_org,
        test_room,
        payments,
        locks,
        monkeypatch,
    ):
        rival = User(
            email="rival@test.com", name="Rival", password_hash=hash_password("password123")
        )
        db_session.add(rival)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=rival.id, role=MemberRole.member)
        )
        await db_session.commit()
        rival_headers = {
            "Authorization": "Bearer "
            + create_access_token({"sub": str(rival.id), "email": rival.email, "role": "member"})
        }

        late = (await _book(client, auth_headers, test_room, 9)).json()["booking"]
        after_the_hold = datetime.now(tz=UTC) + timedelta(hours=1)
        monkeypatch.setattr(clock, "utcnow", lambda: after_the_hold)
        winner = await _book(client, rival_headers, test_room, 9)
        assert winner.status_code == 201, winner.text

        payload = checkout_completed_event(
            session_id=_session_of(late["id"]),
            kind=CheckoutKind.booking,
            reference_id=late["id"],
            org_id=late["org_id"],
        )
        assert (await _deliver(client, payments, payload)).json()["handled"] is True
        assert (await _booking(db_session, late["id"])).status is BookingStatus.paid_unfulfilled
        assert locks.issued_code_for(uuid.UUID(late["id"])) is None
        confirmed = await db_session.scalar(
            select(func.count())
            .select_from(Booking)
            .where(Booking.status == BookingStatus.confirmed)
        )
        assert confirmed == 0
