"""A05 — users: list, one customer's page, admin role, complimentary hours.

Every endpoint is tenant-scoped: a customer who is not a member of the
operator's org is simply not there. Roles change per org and an operator can
never demote themselves.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.user import User
from sqlalchemy import select

API = "/api/v1"


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


async def _member(db_session, org, email: str, name: str, role=MemberRole.member) -> User:
    u = User(email=email, name=name, password_hash=hash_password("x" * 12))
    db_session.add(u)
    await db_session.flush()
    db_session.add(OrganizationMember(org_id=org.id, user_id=u.id, role=role))
    await db_session.commit()
    await db_session.refresh(u)
    return u


def _headers(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "email": user.email, "name": user.name})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def pack(db_session, test_org) -> Package:
    p = Package(
        org_id=test_org.id, name="Pack 10h", hours=10, price=Decimal("100.00"), validity_days=90
    )
    db_session.add(p)
    await db_session.commit()
    await db_session.refresh(p)
    return p


@pytest_asyncio.fixture
async def other_org(db_session) -> tuple[Organization, User, dict]:
    org = Organization(name="Other", slug="other", plan=OrgPlan.starter, settings={})
    db_session.add(org)
    await db_session.flush()
    op = await _member(db_session, org, "other-op@test.com", "Op", MemberRole.owner)
    return org, op, _headers(op)


class TestList:
    async def test_lists_members_searchable_and_paged_with_counts(
        self,
        client,
        admin_headers,
        admin_user,
        test_org,
        test_room,
        test_user,
        test_member,
        db_session,
    ):
        ana = await _member(db_session, test_org, "ana@example.com", "Ana Silva")
        await _member(db_session, test_org, "rui@example.com", "Rui Costa")
        start = datetime.now(tz=UTC) + timedelta(days=5)
        db_session.add(
            Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=ana.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                duration_hours=1,
                total_amount=11,
                status=BookingStatus.confirmed,
                payment_method=PaymentMethod.hourly,
            )
        )
        await db_session.commit()

        resp = await client.get(f"{API}/admin/users", params=_org(test_org), headers=admin_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"users", "total", "page", "page_size"}
        emails = [u["email"] for u in body["users"]]
        # Members, not only those who booked; the operator included.
        assert set(emails) == {
            admin_user.email,
            test_user.email,
            "ana@example.com",
            "rui@example.com",
        }
        ana_row = next(u for u in body["users"] if u["email"] == "ana@example.com")
        assert set(ana_row) >= {
            "id",
            "email",
            "name",
            "role",
            "joined_at",
            "bookings_count",
            "created_at",
        }
        assert ana_row["role"] == "member"
        assert ana_row["bookings_count"] == 1

        search = await client.get(
            f"{API}/admin/users", params={**_org(test_org), "q": "silva"}, headers=admin_headers
        )
        assert [u["email"] for u in search.json()["users"]] == ["ana@example.com"]
        by_email = await client.get(
            f"{API}/admin/users", params={**_org(test_org), "q": "RUI@"}, headers=admin_headers
        )
        assert [u["email"] for u in by_email.json()["users"]] == ["rui@example.com"]
        page = await client.get(
            f"{API}/admin/users",
            params={**_org(test_org), "page": 2, "page_size": 3},
            headers=admin_headers,
        )
        assert page.json()["total"] == 4 and len(page.json()["users"]) == 1

    async def test_another_orgs_members_are_invisible(
        self, client, admin_headers, test_org, other_org, test_member
    ):
        _, op, _ = other_org
        resp = await client.get(f"{API}/admin/users", params=_org(test_org), headers=admin_headers)
        assert op.email not in resp.text

    async def test_a_member_cannot_list(self, client, auth_headers, test_member, test_org):
        assert (
            await client.get(f"{API}/admin/users", params=_org(test_org), headers=auth_headers)
        ).status_code == 403


class TestDetail:
    async def test_one_customers_bookings_purchases_and_requests(
        self, client, admin_headers, test_org, test_room, test_user, test_member, pack, db_session
    ):
        now = datetime.now(tz=UTC)
        db_session.add(
            Booking(
                org_id=test_org.id,
                room_id=test_room.id,
                user_id=test_user.id,
                start_time=now + timedelta(days=3),
                end_time=now + timedelta(days=3, hours=1),
                duration_hours=1,
                total_amount=11,
                status=BookingStatus.confirmed,
                payment_method=PaymentMethod.hourly,
            )
        )
        db_session.add(
            UserPackagePurchase(
                user_id=test_user.id,
                package_id=pack.id,
                org_id=test_org.id,
                hours_total=10,
                hours_used=3,
                hours_remaining=7,
                purchased_at=now,
                expires_at=now + timedelta(days=90),
                status=PurchaseStatus.active,
            )
        )
        await db_session.commit()
        sent = await client.post(
            f"{API}/support/requests",
            json={"category": "package", "message": "x" * 30, "context": {}},
            headers={"Authorization": admin_headers["Authorization"]},
        )
        assert sent.status_code == 201
        # Their own request, as the customer.
        mine = await client.post(
            f"{API}/support/requests",
            json={"category": "booking", "message": "y" * 30, "context": {}},
            headers=_headers(test_user),
        )
        assert mine.status_code == 201

        resp = await client.get(
            f"{API}/admin/users/{test_user.id}", params=_org(test_org), headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body) == {"user", "bookings", "purchases", "balance", "support_requests"}
        assert body["user"]["email"] == test_user.email and body["user"]["role"] == "member"
        assert len(body["bookings"]) == 1 and body["bookings"][0]["room"]["name"] == test_room.name
        assert len(body["purchases"]) == 1
        assert Decimal(body["purchases"][0]["hours_remaining"]) == Decimal(7)
        assert body["purchases"][0]["package"]["name"] == "Pack 10h"
        assert [r["category"] for r in body["support_requests"]] == ["booking"]

    async def test_a_user_outside_the_org_is_404(self, client, admin_headers, test_org, other_org):
        _, op, _ = other_org
        resp = await client.get(
            f"{API}/admin/users/{op.id}", params=_org(test_org), headers=admin_headers
        )
        assert resp.status_code == 404
        missing = await client.get(
            f"{API}/admin/users/{uuid.uuid4()}", params=_org(test_org), headers=admin_headers
        )
        assert missing.status_code == 404 and missing.json() == resp.json()


class TestRole:
    async def test_promote_and_demote_within_the_org(
        self, client, admin_headers, test_org, test_user, test_member, db_session
    ):
        url = f"{API}/admin/users/{test_user.id}/role"
        up = await client.put(
            url, params=_org(test_org), json={"role": "admin"}, headers=admin_headers
        )
        assert up.status_code == 200, up.text
        assert up.json()["user"]["role"] == "admin"
        # They can now use an operator endpoint in THIS org...
        listed = await client.get(
            f"{API}/admin/users", params=_org(test_org), headers=_headers(test_user)
        )
        assert listed.status_code == 200
        down = await client.put(
            url, params=_org(test_org), json={"role": "member"}, headers=admin_headers
        )
        assert down.status_code == 200 and down.json()["user"]["role"] == "member"
        # ...and not any more.
        assert (
            await client.get(
                f"{API}/admin/users", params=_org(test_org), headers=_headers(test_user)
            )
        ).status_code == 403

    async def test_cannot_change_your_own_role(self, client, admin_headers, admin_user, test_org):
        resp = await client.put(
            f"{API}/admin/users/{admin_user.id}/role",
            params=_org(test_org),
            json={"role": "member"},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text
        row = await client.get(
            f"{API}/admin/users/{admin_user.id}", params=_org(test_org), headers=admin_headers
        )
        assert row.json()["user"]["role"] == "owner"

    async def test_owner_is_not_grantable_here_and_an_owner_is_not_demotable(
        self, client, admin_headers, test_org, test_user, test_member, db_session
    ):
        url = f"{API}/admin/users/{test_user.id}/role"
        assert (
            await client.put(
                url, params=_org(test_org), json={"role": "owner"}, headers=admin_headers
            )
        ).status_code == 422
        # A second owner, then try to demote them: ownership changes are not
        # this endpoint's business.
        boss = await _member(db_session, test_org, "boss@example.com", "Boss", MemberRole.owner)
        resp = await client.put(
            f"{API}/admin/users/{boss.id}/role",
            params=_org(test_org),
            json={"role": "member"},
            headers=admin_headers,
        )
        assert resp.status_code == 409, resp.text

    async def test_role_is_per_org(
        self, client, admin_headers, test_org, test_user, test_member, other_org, db_session
    ):
        foreign_org, _, _ = other_org
        db_session.add(
            OrganizationMember(org_id=foreign_org.id, user_id=test_user.id, role=MemberRole.member)
        )
        await db_session.commit()
        await client.put(
            f"{API}/admin/users/{test_user.id}/role",
            params=_org(test_org),
            json={"role": "admin"},
            headers=admin_headers,
        )
        roles = (
            await db_session.execute(
                select(OrganizationMember.org_id, OrganizationMember.role).where(
                    OrganizationMember.user_id == test_user.id
                )
            )
        ).all()
        assert dict(roles) == {test_org.id: MemberRole.admin, foreign_org.id: MemberRole.member}

    async def test_another_orgs_admin_cannot_touch_our_roles(
        self, client, test_org, test_user, test_member, other_org
    ):
        foreign_org, _, headers = other_org
        for org, expected in ((test_org, 403), (foreign_org, 404)):
            resp = await client.put(
                f"{API}/admin/users/{test_user.id}/role",
                params={"org_id": str(org.id)},
                json={"role": "admin"},
                headers=headers,
            )
            assert resp.status_code == expected


class TestComplimentaryHours:
    async def test_grants_a_zero_amount_purchase_with_a_reason_and_the_packs_validity(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/complimentary-hours",
            params=_org(test_org),
            json={
                "hours": "3",
                "package_id": str(pack.id),
                "reason": "Compensação por avaria do ar condicionado",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        purchase = resp.json()["purchase"]
        assert Decimal(purchase["hours_total"]) == Decimal(3)
        assert Decimal(purchase["hours_remaining"]) == Decimal(3)
        assert Decimal(purchase["amount_paid"]) == Decimal(0)
        assert purchase["status"] == "active"
        assert purchase["admin_note"] == "Compensação por avaria do ar condicionado"
        assert purchase["package"]["name"] == "Pack 10h"
        expires = datetime.fromisoformat(purchase["expires_at"])
        assert abs((expires - datetime.now(tz=UTC)).days - 90) <= 1

        # Spendable at once by the customer, like any active purchase.
        mine = await client.get(
            f"{API}/packages/me",
            headers=_headers(test_user),
        )
        assert Decimal(mine.json()["purchases"][0]["hours_remaining"]) == Decimal(3)

    async def test_a_paid_purchase_records_what_was_paid(
        self, client, auth_headers, test_member, test_org, pack, payments
    ):
        resp = await client.post(
            f"{API}/packages/{pack.id}/purchase",
            json={"org_id": str(test_org.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert Decimal(resp.json()["purchase"]["amount_paid"]) == Decimal("100.00")

    async def test_an_explicit_expiry_wins_and_the_bounds_hold(
        self, client, admin_headers, test_org, test_user, test_member, pack
    ):
        url = f"{API}/admin/users/{test_user.id}/complimentary-hours"
        until = (datetime.now(tz=UTC) + timedelta(days=10)).replace(microsecond=0)
        ok = await client.post(
            url,
            params=_org(test_org),
            json={
                "hours": "1",
                "package_id": str(pack.id),
                "reason": "x",
                "expires_at": until.isoformat(),
            },
            headers=admin_headers,
        )
        assert ok.status_code == 201, ok.text
        assert datetime.fromisoformat(ok.json()["purchase"]["expires_at"]) == until
        for bad in (
            {"hours": "0", "package_id": str(pack.id), "reason": "x"},
            {"hours": "1000", "package_id": str(pack.id), "reason": "x"},
            {"hours": "1", "package_id": str(pack.id), "reason": ""},
            {
                "hours": "1",
                "package_id": str(pack.id),
                "reason": "x",
                "expires_at": (datetime.now(tz=UTC) - timedelta(days=1)).isoformat(),
            },
            {"hours": "1", "package_id": str(uuid.uuid4()), "reason": "x"},
        ):
            resp = await client.post(url, params=_org(test_org), json=bad, headers=admin_headers)
            assert resp.status_code in (400, 404, 422), (bad, resp.text)

    async def test_only_for_a_member_of_the_org_and_only_with_its_own_package(
        self, client, admin_headers, test_org, test_user, pack, other_org, db_session
    ):
        foreign_org, op, headers = other_org
        # test_user is not a member of test_org here.
        resp = await client.post(
            f"{API}/admin/users/{test_user.id}/complimentary-hours",
            params=_org(test_org),
            json={"hours": "1", "package_id": str(pack.id), "reason": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 404, resp.text
        # The other org's owner, using our package id in their org.
        resp = await client.post(
            f"{API}/admin/users/{op.id}/complimentary-hours",
            params={"org_id": str(foreign_org.id)},
            json={"hours": "1", "package_id": str(pack.id), "reason": "x"},
            headers=headers,
        )
        assert resp.status_code == 404, resp.text
        assert (await db_session.execute(select(UserPackagePurchase))).scalars().all() == []

    async def test_complimentary_hours_are_not_package_revenue(
        self, client, admin_headers, test_org, test_user, test_member, pack, db_session
    ):
        await client.post(
            f"{API}/admin/users/{test_user.id}/complimentary-hours",
            params=_org(test_org),
            json={"hours": "5", "package_id": str(pack.id), "reason": "x"},
            headers=admin_headers,
        )
        row = (await db_session.execute(select(UserPackagePurchase))).scalar_one()
        assert row.amount_paid == Decimal(0)
        assert row.hours_total == Decimal(5)
