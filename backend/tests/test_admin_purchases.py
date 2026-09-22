"""A06 — "Prolongar validade": an operator extends a purchase's expiry.

Extending only: the new date must be later than the current one and in the
future. A lapsed pack can be brought back (that is the point). The reason is
kept on the purchase's note; the customer sees the new date, never the note.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio
from app.auth import create_access_token
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.user import User

API = "/api/v1"


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


def _headers(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "email": user.email, "name": user.name})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def pack(db_session, test_org) -> Package:
    p = Package(org_id=test_org.id, name="Pack 10h", hours=10, price=Decimal(100), validity_days=90)
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


async def _purchase(
    db_session, *, user, org, pack, expires_in_days: int, status=PurchaseStatus.active, note=None
) -> UserPackagePurchase:
    now = datetime.now(tz=UTC)
    row = UserPackagePurchase(
        user_id=user.id,
        package_id=pack.id,
        org_id=org.id,
        hours_total=Decimal(10),
        hours_used=Decimal(3),
        hours_remaining=Decimal(7),
        amount_paid=pack.price,
        admin_note=note,
        purchased_at=now - timedelta(days=80),
        expires_at=now + timedelta(days=expires_in_days),
        status=status,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


class TestExtendValidity:
    async def test_extends_a_live_purchase_and_keeps_the_reason_on_the_note(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=10, note="oferta"
        )
        new = (datetime.now(tz=UTC) + timedelta(days=40)).replace(microsecond=0)
        resp = await client.put(
            f"{API}/admin/purchases/{row.id}/expiry",
            params=_org(test_org),
            json={"expires_at": new.isoformat(), "reason": "Esteve de baixa em outubro"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        purchase = resp.json()["purchase"]
        assert datetime.fromisoformat(purchase["expires_at"]) == new
        assert Decimal(purchase["hours_remaining"]) == Decimal(7)
        assert purchase["admin_note"].startswith("oferta\n")
        assert "Esteve de baixa em outubro" in purchase["admin_note"]
        assert "Validade" in purchase["admin_note"]

        # The customer sees the new date and nothing of the note.
        mine = await client.get(f"{API}/packages/me", headers=_headers(test_user))
        [theirs] = mine.json()["purchases"]
        assert datetime.fromisoformat(theirs["expires_at"]) == new
        assert "admin_note" not in theirs

    async def test_brings_back_a_lapsed_purchase(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=-5
        )
        # Lapsed: nothing to spend.
        mine = await client.get(f"{API}/packages/me", headers=_headers(test_user))
        assert mine.json()["purchases"][0]["expires_at"] < datetime.now(tz=UTC).isoformat()

        new = datetime.now(tz=UTC) + timedelta(days=30)
        resp = await client.put(
            f"{API}/admin/purchases/{row.id}/expiry",
            params=_org(test_org),
            json={"expires_at": new.isoformat(), "reason": "pediu por email"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert datetime.fromisoformat(resp.json()["purchase"]["expires_at"]) > datetime.now(tz=UTC)

    async def test_refuses_to_shorten_or_to_set_the_past(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=30
        )
        for days in (10, -1):
            resp = await client.put(
                f"{API}/admin/purchases/{row.id}/expiry",
                params=_org(test_org),
                json={
                    "expires_at": (datetime.now(tz=UTC) + timedelta(days=days)).isoformat(),
                    "reason": "x",
                },
                headers=admin_headers,
            )
            assert resp.status_code == 400, resp.text
        # Unchanged.
        await db_session.refresh(row)
        assert abs((row.expires_at - datetime.now(tz=UTC)).days - 30) <= 1

    async def test_refuses_cancelled_and_unpaid_purchases(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        for st in (PurchaseStatus.cancelled, PurchaseStatus.pending):
            row = await _purchase(
                db_session, user=test_user, org=test_org, pack=pack, expires_in_days=30, status=st
            )
            resp = await client.put(
                f"{API}/admin/purchases/{row.id}/expiry",
                params=_org(test_org),
                json={
                    "expires_at": (datetime.now(tz=UTC) + timedelta(days=60)).isoformat(),
                    "reason": "x",
                },
                headers=admin_headers,
            )
            assert resp.status_code == 409, resp.text

    async def test_requires_a_reason_and_a_timezone(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=30
        )
        later = datetime.now(tz=UTC) + timedelta(days=60)
        for body in (
            {"expires_at": later.isoformat(), "reason": "   "},
            {"expires_at": later.replace(tzinfo=None).isoformat(), "reason": "x"},
            {"reason": "x"},
        ):
            resp = await client.put(
                f"{API}/admin/purchases/{row.id}/expiry",
                params=_org(test_org),
                json=body,
                headers=admin_headers,
            )
            assert resp.status_code == 422, (body, resp.text)

    async def test_another_orgs_purchase_or_an_unknown_id_is_404(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=30
        )
        other = await client.put(
            f"{API}/admin/purchases/{uuid.uuid4()}/expiry",
            params=_org(test_org),
            json={
                "expires_at": (datetime.now(tz=UTC) + timedelta(days=60)).isoformat(),
                "reason": "x",
            },
            headers=admin_headers,
        )
        assert other.status_code == 404
        # The org in the query is not the purchase's org → 404 (never a hint).
        foreign_org = {"org_id": str(uuid.uuid4())}
        resp = await client.put(
            f"{API}/admin/purchases/{row.id}/expiry",
            params=foreign_org,
            json={
                "expires_at": (datetime.now(tz=UTC) + timedelta(days=60)).isoformat(),
                "reason": "x",
            },
            headers=admin_headers,
        )
        assert resp.status_code in (403, 404)

    async def test_a_customer_cannot_extend_their_own_pack(
        self, client, test_org, test_user, test_member, pack, db_session
    ):
        row = await _purchase(
            db_session, user=test_user, org=test_org, pack=pack, expires_in_days=30
        )
        resp = await client.put(
            f"{API}/admin/purchases/{row.id}/expiry",
            params=_org(test_org),
            json={
                "expires_at": (datetime.now(tz=UTC) + timedelta(days=60)).isoformat(),
                "reason": "x",
            },
            headers=_headers(test_user),
        )
        assert resp.status_code == 403
