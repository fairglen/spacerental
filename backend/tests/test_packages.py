import uuid
from decimal import Decimal

import pytest_asyncio

from app.models.package import Package


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


class TestListPackages:
    async def test_list_packages_for_org(self, client, test_org, test_package):
        resp = await client.get(
            "/api/v1/packages", params={"org_id": str(test_org.id)}
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["packages"]) == 1
        assert body["packages"][0]["name"] == "Starter Pack"
        assert body["packages"][0]["hours"] == 10


class TestPurchasePackage:
    async def test_purchase_package_creates_user_purchase(
        self,
        client,
        auth_headers,
        test_org,
        test_package,
        test_member,
    ):
        resp = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        purchase = resp.json()["purchase"]
        assert purchase["package_id"] == str(test_package.id)
        assert Decimal(purchase["hours_total"]) == Decimal("10")
        assert Decimal(purchase["hours_remaining"]) == Decimal("10")
        assert Decimal(purchase["hours_used"]) == Decimal("0")

    async def test_purchase_requires_auth(self, client, test_org, test_package):
        resp = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
        )
        assert resp.status_code == 401

    async def test_purchase_starts_checkout_and_stays_pending(
        self,
        client,
        auth_headers,
        test_org,
        test_package,
        test_member,
        payments,
    ):
        """Story 2.3 — same Checkout Session pattern as bookings."""
        resp = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        purchase = body["purchase"]

        assert purchase["status"] == "pending"
        session_id = f"cs_stub_{uuid.UUID(purchase['id']).hex}"
        assert body["checkout_url"].endswith(session_id)

        session = payments.sessions[session_id]
        assert session["amount_cents"] == 9900  # 99.00 EUR
        assert session["kind"] == "package_purchase"
        assert session["org_id"] == str(test_org.id)

        # Hours are not spendable until the webhook lands.
        mine = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert mine.json()["purchases"][0]["status"] == "pending"


class TestMyPackages:
    async def test_list_my_packages(
        self,
        client,
        auth_headers,
        test_org,
        test_package,
        test_member,
    ):
        # Start with empty list
        empty = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert empty.status_code == 200
        assert empty.json() == {"purchases": []}

        # Purchase one
        buy = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert buy.status_code == 201, buy.text

        # Now it should appear
        resp = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert resp.status_code == 200
        purchases = resp.json()["purchases"]
        assert len(purchases) == 1
        assert purchases[0]["package_id"] == str(test_package.id)
