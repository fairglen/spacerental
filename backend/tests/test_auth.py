import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from app.auth import hash_password, verify_password
from app.config import settings
from app.models.organization import MemberRole, Organization, OrganizationMember
from app.models.package import Package
from app.models.user import User
from sqlalchemy import func, select


@pytest.fixture(autouse=True)
def enrollment_target(test_org, monkeypatch):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", True)


class TestRegister:
    async def test_register_joins_configured_org_as_member(self, client, test_org, db_session):
        resp = await client.post(
            "/api/v1/auth/register",
            json={
                "email": "new@user.com",
                "password": "password123",
                "name": "New User",
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert "access_token" in body and isinstance(body["access_token"], str)
        assert body["token_type"] == "bearer"
        assert body["role"] == "member"
        assert body["user"]["email"] == "new@user.com"
        assert body["user"]["name"] == "New User"
        assert "id" in body["user"]
        headers = {"Authorization": f"Bearer {body['access_token']}"}
        memberships = await client.get("/api/v1/auth/memberships", headers=headers)
        assert memberships.json()["memberships"] == [
            {
                "org_id": str(test_org.id),
                "org_name": test_org.name,
                "org_slug": test_org.slug,
                "role": "member",
            }
        ]
        assert await db_session.scalar(select(func.count()).select_from(Organization)) == 1
        denied = await client.get(
            "/api/v1/admin/dashboard", params={"org_id": str(test_org.id)}, headers=headers
        )
        assert denied.status_code == 403

    async def test_register_duplicate_email_returns_400(self, client):
        payload = {"email": "dup@user.com", "password": "password123", "name": "Dup"}
        first = await client.post("/api/v1/auth/register", json=payload)
        assert first.status_code == 201
        second = await client.post("/api/v1/auth/register", json=payload)
        assert second.status_code == 400
        assert "registado" in second.json()["detail"]

    async def test_register_short_password_returns_422(self, client):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": "a@b.com", "password": "short", "name": "A"},
        )
        assert resp.status_code == 422

    async def test_register_invalid_email_returns_422(self, client):
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": "not-an-email", "password": "password123", "name": "A"},
        )
        assert resp.status_code == 422

    async def test_register_long_password_works(self, client):
        # Argon2 has no length limit; our schema caps at 128. 100 chars is OK.
        long_pw = "a" * 100
        resp = await client.post(
            "/api/v1/auth/register",
            json={"email": "long@pw.com", "password": long_pw, "name": "Long"},
        )
        assert resp.status_code == 201, resp.text


class TestLogin:
    async def test_login_success_returns_token(self, client):
        await client.post(
            "/api/v1/auth/register",
            json={"email": "li@user.com", "password": "password123", "name": "Li"},
        )
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "li@user.com", "password": "password123"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["access_token"]
        assert body["user"]["email"] == "li@user.com"
        assert body["role"] == "member"

    async def test_login_wrong_password_returns_401(self, client):
        await client.post(
            "/api/v1/auth/register",
            json={"email": "wp@user.com", "password": "password123", "name": "Wp"},
        )
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "wp@user.com", "password": "wrongpassword"},
        )
        assert resp.status_code == 401

    async def test_login_nonexistent_email_returns_401(self, client):
        resp = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody@nowhere.com", "password": "password123"},
        )
        assert resp.status_code == 401


class TestMe:
    async def test_me_without_token_returns_401(self, client):
        resp = await client.get("/api/v1/auth/me")
        assert resp.status_code == 401

    async def test_me_with_valid_token_returns_user(self, client, auth_headers, test_user):
        resp = await client.get("/api/v1/auth/me", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["email"] == test_user.email
        assert body["id"] == str(test_user.id)


class TestDefaultOrgSlug:
    async def test_duplicate_user_name_dedupes_org_slug(self, client, db_session):
        a = await client.post(
            "/api/v1/auth/register/operator",
            json={"email": "a@user.com", "password": "password123", "name": "Maria Silva"},
        )
        assert a.status_code == 201, a.text
        b = await client.post(
            "/api/v1/auth/register/operator",
            json={"email": "b@user.com", "password": "password123", "name": "Maria Silva"},
        )
        assert b.status_code == 201, b.text

        result = await db_session.execute(
            select(Organization).where(Organization.slug.like("maria-silva%"))
        )
        slugs = sorted(o.slug for o in result.scalars().all())
        assert slugs == ["maria-silva", "maria-silva-1"]


class TestPasswordHashing:
    def test_password_hash_is_argon2(self):
        h = hash_password("password123")
        assert h.startswith("$argon2"), f"Expected Argon2 hash, got: {h[:20]}"
        assert verify_password("password123", h) is True
        assert verify_password("wrong", h) is False


@pytest.mark.parametrize(
    "slug,enabled,expected", [("missing-org", True, 503), ("", True, 503), ("test-org", False, 403)]
)
async def test_unavailable_enrollment_creates_nothing(
    client, db_session, monkeypatch, slug, enabled, expected
):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", slug)
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", enabled)
    response = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "closed@example.com",
            "password": "password123",
        },
    )
    assert response.status_code == expected
    assert await db_session.scalar(select(func.count()).select_from(User)) == 0
    assert await db_session.scalar(select(func.count()).select_from(OrganizationMember)) == 0


async def test_operator_registration_is_explicit_and_independent(client, test_org, monkeypatch):
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", False)
    response = await client.post(
        "/api/v1/auth/register/operator",
        json={
            "email": "operator@example.com",
            "password": "password123",
            "name": "Operator",
        },
    )
    assert response.status_code == 201
    assert response.json()["role"] == "owner"
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    memberships = (await client.get("/api/v1/auth/memberships", headers=headers)).json()[
        "memberships"
    ]
    assert len(memberships) == 1
    assert memberships[0]["org_id"] != str(test_org.id)
    duplicate = await client.post(
        "/api/v1/auth/register/operator",
        json={
            "email": "operator@example.com",
            "password": "password123",
        },
    )
    assert duplicate.status_code == 400


async def test_existing_account_enrollment_is_explicit_and_concurrent_idempotent(
    client, test_user, auth_headers, test_org, db_session
):
    before = await client.get("/api/v1/auth/memberships", headers=auth_headers)
    assert before.json() == {"memberships": []}
    responses = await asyncio.gather(
        *[client.post("/api/v1/auth/enroll", headers=auth_headers) for _ in range(2)]
    )
    for response in responses:
        assert response.status_code == 200
        assert response.json() == {"membership": {"org_id": str(test_org.id), "role": "member"}}
    assert await db_session.scalar(select(func.count()).select_from(OrganizationMember)) == 1


async def test_enrollment_preserves_legacy_org_and_existing_owner(client, test_org, db_session):
    registered = await client.post(
        "/api/v1/auth/register/operator",
        json={
            "email": "legacy@example.com",
            "password": "password123",
        },
    )
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    original = (await client.get("/api/v1/auth/memberships", headers=headers)).json()["memberships"]
    await client.post("/api/v1/auth/enroll", headers=headers)
    current = (await client.get("/api/v1/auth/memberships", headers=headers)).json()["memberships"]
    assert len(current) == 2
    assert original[0] in current
    member = await db_session.scalar(
        select(OrganizationMember).where(OrganizationMember.org_id == test_org.id)
    )
    member.role = MemberRole.admin
    await db_session.commit()
    again = await client.post("/api/v1/auth/enroll", headers=headers)
    assert again.json()["membership"]["role"] == "admin"
    login = await client.post(
        "/api/v1/auth/login", json={"email": "legacy@example.com", "password": "password123"}
    )
    assert login.json()["role"] == "owner"


async def test_enrollment_requires_auth_and_open_target(client, auth_headers, monkeypatch):
    assert (await client.post("/api/v1/auth/enroll")).status_code == 401
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", False)
    assert (await client.post("/api/v1/auth/enroll", headers=auth_headers)).status_code == 403
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", True)
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", "unknown")
    assert (await client.post("/api/v1/auth/enroll", headers=auth_headers)).status_code == 503


async def test_customer_can_book_and_purchase_only_at_enrolled_org(
    client, test_org, test_room, db_session, payments
):
    other = Organization(name="Other", slug="other")
    db_session.add(other)
    await db_session.flush()
    packages = [
        Package(org_id=org_id, name="Pack", hours=10, price=Decimal(90), validity_days=30)
        for org_id in (test_org.id, other.id)
    ]
    db_session.add_all(packages)
    await db_session.commit()
    registered = await client.post(
        "/api/v1/auth/register",
        json={
            "email": "customer@example.com",
            "password": "password123",
            "org_id": str(other.id),
            "role": "owner",
        },
    )
    assert registered.json()["role"] == "member"
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    # Hour-aligned and inside test_room's Mon-Sat 08:00-20:00 availability
    # (C05): an arbitrary `now() + N days` wall-clock instant would otherwise
    # fail the boundary checks depending on what time the suite happens to run.
    today = datetime.now(UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    target_date = today + timedelta(days=days_ahead)
    start = datetime.combine(target_date, datetime.min.time(), tzinfo=UTC) + timedelta(hours=10)
    booking = await client.post(
        "/api/v1/bookings",
        headers=headers,
        json={
            "room_id": str(test_room.id),
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=2)).isoformat(),
        },
    )
    assert booking.status_code == 201, booking.text
    assert booking.json()["booking"]["status"] == "pending"
    assert booking.json()["checkout_url"]
    for package, expected in zip(packages, [201, 403], strict=True):
        response = await client.post(
            f"/api/v1/packages/{package.id}/purchase",
            headers=headers,
            json={"org_id": str(package.org_id)},
        )
        assert response.status_code == expected, response.text
    assert (
        await client.get(
            "/api/v1/admin/dashboard", headers=headers, params={"org_id": str(other.id)}
        )
    ).status_code == 403
