from sqlalchemy import select

from app.auth import hash_password, verify_password
from app.models.organization import Organization


class TestRegister:
    async def test_register_creates_user_and_org_and_returns_token(self, client):
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
        assert body["role"] == "owner"
        assert body["user"]["email"] == "new@user.com"
        assert body["user"]["name"] == "New User"
        assert "id" in body["user"]

    async def test_register_duplicate_email_returns_400(self, client):
        payload = {"email": "dup@user.com", "password": "password123", "name": "Dup"}
        first = await client.post("/api/v1/auth/register", json=payload)
        assert first.status_code == 201
        second = await client.post("/api/v1/auth/register", json=payload)
        assert second.status_code == 400
        assert "already" in second.json()["detail"].lower()

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
        # User created their own org during register → owner role
        assert body["role"] == "owner"

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
            "/api/v1/auth/register",
            json={"email": "a@user.com", "password": "password123", "name": "Maria Silva"},
        )
        assert a.status_code == 201, a.text
        b = await client.post(
            "/api/v1/auth/register",
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
