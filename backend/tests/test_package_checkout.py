"""B68: a cancelled or abandoned pack checkout is cancelled, and only active
packs are packs — the stub's cancel, the `checkout.session.expired` webhook,
the sweeper, the list filter and the customer's cancel route."""

import json
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from app import clock, holds
from app.config import settings
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from sqlalchemy import select

API = "/api/v1"


async def _package(db_session, org, hours=10) -> Package:
    pkg = Package(
        org_id=org.id, name=f"Pack {hours}h", hours=hours, price=Decimal("90.00"), validity_days=365
    )
    db_session.add(pkg)
    await db_session.commit()
    await db_session.refresh(pkg)
    return pkg


async def _buy(client, headers, pkg, org) -> dict:
    resp = await client.post(
        f"{API}/packages/{pkg.id}/purchase", json={"org_id": str(org.id)}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _session_id(checkout_url: str) -> str:
    return checkout_url.rstrip("/").split("/")[-1]


async def _status(db_session, purchase_id: str) -> PurchaseStatus:
    db_session.expire_all()
    row = await db_session.scalar(
        select(UserPackagePurchase).where(UserPackagePurchase.id == uuid.UUID(purchase_id))
    )
    return row.status


def _expired_event(session_id: str, purchase: dict, kind: str = "package_purchase") -> bytes:
    return json.dumps(
        {
            "type": "checkout.session.expired",
            "data": {
                "object": {
                    "object": "checkout.session",
                    "id": session_id,
                    "payment_status": "unpaid",
                    "metadata": {
                        "kind": kind,
                        "reference_id": purchase["id"],
                        "org_id": purchase["org_id"],
                    },
                }
            },
        }
    ).encode()


@pytest.mark.asyncio
class TestStubCancel:
    async def test_cancel_on_the_stub_page_cancels_the_purchase(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        session_id = _session_id(body["checkout_url"])
        resp = await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        assert resp.status_code == 303
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.cancelled
        # Idempotent: the second cancel finds no pending row and still redirects.
        again = await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        assert again.status_code == 303
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.cancelled

    async def test_pay_after_cancel_does_not_activate(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        session_id = _session_id(body["checkout_url"])
        await client.post(f"/checkout/stub/{session_id}/cancel", follow_redirects=False)
        await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.cancelled


@pytest.mark.asyncio
class TestExpiredWebhook:
    async def test_an_expired_session_cancels_a_pending_purchase(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        session_id = _session_id(body["checkout_url"])
        payload = _expired_event(session_id, body["purchase"])
        resp = await client.post(
            f"{API}/webhooks/stripe",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": payments.sign_payload(payload),
            },
        )
        assert resp.status_code == 200
        assert resp.json() == {"received": True, "handled": True}
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.cancelled
        # Delivered twice: the second one changes nothing.
        again = await client.post(
            f"{API}/webhooks/stripe",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": payments.sign_payload(payload),
            },
        )
        assert again.json() == {"received": True, "handled": False}

    async def test_an_expired_session_does_not_touch_a_paid_purchase(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        session_id = _session_id(body["checkout_url"])
        await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.active
        payload = _expired_event(session_id, body["purchase"])
        resp = await client.post(
            f"{API}/webhooks/stripe",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": payments.sign_payload(payload),
            },
        )
        assert resp.json() == {"received": True, "handled": False}
        assert await _status(db_session, body["purchase"]["id"]) is PurchaseStatus.active

    async def test_an_expired_session_releases_a_pending_booking_hold(
        self, client, auth_headers, test_room, test_member, payments
    ):
        from tests.test_checkout_stub import _booking_status, _create_pending_booking

        body = await _create_pending_booking(client, auth_headers, test_room)
        session_id = body["checkout_url"].rstrip("/").split("/")[-1]
        payload = json.dumps(
            {
                "type": "checkout.session.expired",
                "data": {
                    "object": {
                        "object": "checkout.session",
                        "id": session_id,
                        "payment_status": "unpaid",
                        "metadata": {
                            "kind": "booking",
                            "reference_id": body["booking"]["id"],
                            "org_id": body["booking"]["org_id"],
                        },
                    }
                },
            }
        ).encode()
        resp = await client.post(
            f"{API}/webhooks/stripe",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": payments.sign_payload(payload),
            },
        )
        assert resp.json() == {"received": True, "handled": True}
        assert await _booking_status(client, auth_headers, body["booking"]["id"]) == "expired"


@pytest.mark.asyncio
class TestSweeper:
    async def test_pending_purchases_older_than_the_window_are_cancelled(
        self, client, auth_headers, test_org, test_member, db_session, payments, session_factory
    ):
        pkg = await _package(db_session, test_org)
        fresh = await _buy(client, auth_headers, pkg, test_org)
        stale = await _buy(client, auth_headers, pkg, test_org)
        row = await db_session.scalar(
            select(UserPackagePurchase).where(
                UserPackagePurchase.id == uuid.UUID(stale["purchase"]["id"])
            )
        )
        row.purchased_at = clock.utcnow() - timedelta(minutes=settings.PACKAGE_CHECKOUT_MINUTES + 1)
        await db_session.commit()
        assert await holds.sweep_lapsed_holds_once(session_factory) == 1
        assert await _status(db_session, stale["purchase"]["id"]) is PurchaseStatus.cancelled
        assert await _status(db_session, fresh["purchase"]["id"]) is PurchaseStatus.pending
        assert await holds.sweep_lapsed_holds_once(session_factory) == 0


@pytest.mark.asyncio
class TestMyPackages:
    async def test_only_active_by_default_pending_on_request_cancelled_never(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        paid = await _buy(client, auth_headers, pkg, test_org)
        await client.post(
            f"/checkout/stub/{_session_id(paid['checkout_url'])}/pay", follow_redirects=False
        )
        pending = await _buy(client, auth_headers, pkg, test_org)
        gone = await _buy(client, auth_headers, pkg, test_org)
        await client.post(
            f"/checkout/stub/{_session_id(gone['checkout_url'])}/cancel", follow_redirects=False
        )

        default = (await client.get(f"{API}/packages/me", headers=auth_headers)).json()
        assert [p["id"] for p in default["purchases"]] == [paid["purchase"]["id"]]
        assert Decimal(str(default["balance"]["hours_available"])) == Decimal(pkg.hours)

        with_pending = (
            await client.get(
                f"{API}/packages/me", params={"include": "pending"}, headers=auth_headers
            )
        ).json()
        ids = {p["id"]: p for p in with_pending["purchases"]}
        assert set(ids) == {paid["purchase"]["id"], pending["purchase"]["id"]}
        assert ids[pending["purchase"]["id"]]["checkout_url"] == pending["checkout_url"]
        assert ids[paid["purchase"]["id"]]["checkout_url"] is None
        # The bank is the same number: a pending row has no spendable hours.
        assert with_pending["balance"] == default["balance"]

    async def test_another_include_value_is_422(self, client, auth_headers, test_member):
        resp = await client.get(
            f"{API}/packages/me", params={"include": "cancelled"}, headers=auth_headers
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestCancelRoute:
    async def test_the_owner_cancels_a_pending_purchase_once(
        self, client, auth_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        purchase_id = body["purchase"]["id"]
        resp = await client.post(
            f"{API}/packages/purchases/{purchase_id}/cancel", headers=auth_headers
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["purchase"]["status"] == "cancelled"
        assert await _status(db_session, purchase_id) is PurchaseStatus.cancelled
        # The stub page is gone with the session; "Pagar" can no longer run.
        session_id = _session_id(body["checkout_url"])
        assert (await client.get(f"/checkout/stub/{session_id}")).status_code == 404
        again = await client.post(
            f"{API}/packages/purchases/{purchase_id}/cancel", headers=auth_headers
        )
        assert again.status_code == 409

    async def test_someone_elses_purchase_is_403_and_an_active_one_409(
        self, client, auth_headers, admin_headers, test_org, test_member, db_session, payments
    ):
        pkg = await _package(db_session, test_org)
        body = await _buy(client, auth_headers, pkg, test_org)
        purchase_id = body["purchase"]["id"]
        other = await client.post(
            f"{API}/packages/purchases/{purchase_id}/cancel", headers=admin_headers
        )
        assert other.status_code == 403
        await client.post(
            f"/checkout/stub/{_session_id(body['checkout_url'])}/pay", follow_redirects=False
        )
        active = await client.post(
            f"{API}/packages/purchases/{purchase_id}/cancel", headers=auth_headers
        )
        assert active.status_code == 409
        missing = await client.post(
            f"{API}/packages/purchases/{uuid.uuid4()}/cancel", headers=auth_headers
        )
        assert missing.status_code == 404
