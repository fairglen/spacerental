import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app.auth import ALGORITHM
from app.config import settings
from app.models.package import Package, UserPackagePurchase
from jose import jwt
from sqlalchemy import func, select


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
        resp = await client.get("/api/v1/packages", params={"org_id": str(test_org.id)})
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
        assert Decimal(purchase["hours_total"]) == Decimal(10)
        assert Decimal(purchase["hours_remaining"]) == Decimal(10)
        assert Decimal(purchase["hours_used"]) == Decimal(0)
        # B12: the dashboard shows the package name next to the balance — it
        # has nothing to render without this nested object.
        assert purchase["package"]["name"] == "Starter Pack"

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


class TestReturnTo:
    """K02: a purchase started from the booking page comes back to it."""

    async def _buy(self, client, auth_headers, test_org, test_package, return_to):
        return await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id), "return_to": return_to},
            headers=auth_headers,
        )

    async def test_the_stub_checkout_lands_on_return_to_with_the_outcome(
        self, client, auth_headers, test_org, test_package, test_member, payments
    ):
        path = "/spaces/abc?room=r1&start=2030-01-01T09:00:00Z&end=2030-01-01T11:00:00Z"
        resp = await self._buy(client, auth_headers, test_org, test_package, path)
        assert resp.status_code == 201, resp.text
        session_id = f"cs_stub_{uuid.UUID(resp.json()['purchase']['id']).hex}"
        session = payments.sessions[session_id]
        front = settings.FRONTEND_URL
        assert session["success_url"] == f"{front}{path}&pagamento=sucesso"
        assert session["cancel_url"] == f"{front}{path}&pagamento=cancelado"

        stub = f"/checkout/stub/{session_id}"
        backed_out = await client.post(f"{stub}/cancel", follow_redirects=False)
        assert backed_out.status_code == 303, backed_out.text
        assert backed_out.headers["location"] == f"{front}{path}&pagamento=cancelado"
        paid = await client.post(f"{stub}/pay", follow_redirects=False)
        assert paid.status_code == 303, paid.text
        assert paid.headers["location"] == f"{front}{path}&pagamento=sucesso"
        mine = await client.get("/api/v1/packages/me", headers=auth_headers)
        assert mine.json()["purchases"][0]["status"] == "active"

    async def test_a_path_without_a_query_gets_a_question_mark(
        self, client, auth_headers, test_org, test_package, test_member, payments
    ):
        resp = await self._buy(client, auth_headers, test_org, test_package, "/spaces")
        assert resp.status_code == 201, resp.text
        session_id = f"cs_stub_{uuid.UUID(resp.json()['purchase']['id']).hex}"
        assert (
            payments.sessions[session_id]["success_url"]
            == f"{settings.FRONTEND_URL}/spaces?pagamento=sucesso"
        )

    async def test_without_return_to_the_configured_pages_stay(
        self, client, auth_headers, test_org, test_package, test_member, payments
    ):
        resp = await client.post(
            f"/api/v1/packages/{test_package.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        session_id = f"cs_stub_{uuid.UUID(resp.json()['purchase']['id']).hex}"
        paid = await client.post(f"/checkout/stub/{session_id}/pay", follow_redirects=False)
        assert paid.headers["location"] == "http://test/success"

    @pytest.mark.parametrize(
        "bad",
        [
            "spaces/abc",
            "//evil.example/x",
            "/\\evil.example/x",
            "/x?next=http://evil.example",
            "/spaces#frag",
            "/spa ces",
            "/x\n",
            "/" + "a" * 512,
        ],
    )
    async def test_anything_but_a_relative_path_is_refused_and_creates_no_purchase(
        self, client, auth_headers, test_org, test_package, test_member, db_session, bad
    ):
        resp = await self._buy(client, auth_headers, test_org, test_package, bad)
        assert resp.status_code == 422, resp.text
        assert (await db_session.scalar(select(func.count()).select_from(UserPackagePurchase))) == 0


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
        # H02: the bank rides alongside the list; empty means zero, nothing lapsing.
        assert empty.json() == {
            "purchases": [],
            "balance": {"hours_available": "0", "hours_expiring_next": None},
        }

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
        # B12: /packages/me eager-loads `package` (lazy="noload" by default)
        # so the dashboard can show its name instead of a generic "Pacote".
        assert purchases[0]["package"]["name"] == "Starter Pack"
        assert purchases[0]["package"]["hours"] == 10


@pytest.mark.parametrize("credentials", ["expired", "invalid", "missing", "deleted_user"])
async def test_invalid_credentials_cannot_create_a_pending_purchase(
    client,
    db_session,
    test_org,
    test_package,
    test_user,
    test_member,
    payments,
    credentials,
):
    if credentials == "deleted_user":
        await db_session.delete(test_user)
        await db_session.commit()
    token = jwt.encode(
        {
            "sub": str(test_user.id),
            "exp": datetime.now(UTC) + timedelta(minutes=-1 if credentials == "expired" else 5),
        },
        "wrong-key" if credentials == "invalid" else settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    response = await client.post(
        f"/api/v1/packages/{test_package.id}/purchase",
        json={"org_id": str(test_org.id)},
        headers={} if credentials == "missing" else {"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == (
        "Not authenticated" if credentials == "missing" else "Could not validate credentials"
    )
    assert await db_session.scalar(select(func.count(UserPackagePurchase.id))) == 0
    assert payments.sessions == {}


@pytest.mark.parametrize(
    "case,expected",
    [("membership", 403), ("wrong_org", 404), ("missing_package", 404), ("provider", 502)],
)
async def test_purchase_failures_remain_distinct_and_create_no_purchase(
    client,
    auth_headers,
    db_session,
    test_org,
    test_package,
    test_member,
    payments,
    monkeypatch,
    case,
    expected,
):
    from app.payments import PaymentProviderError

    if case == "membership":
        await db_session.delete(test_member)
        await db_session.commit()
    if case == "provider":

        async def fail(**kwargs):
            raise PaymentProviderError("temporarily unavailable")

        monkeypatch.setattr(payments, "create_checkout_session", fail)
    package_id = uuid.uuid4() if case == "missing_package" else test_package.id
    response = await client.post(
        f"/api/v1/packages/{package_id}/purchase",
        json={"org_id": str(uuid.uuid4() if case == "wrong_org" else test_org.id)},
        headers=auth_headers,
    )
    assert response.status_code == expected, response.text
    assert await db_session.scalar(select(func.count(UserPackagePurchase.id))) == 0
    assert payments.sessions == {}
