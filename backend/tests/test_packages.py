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
