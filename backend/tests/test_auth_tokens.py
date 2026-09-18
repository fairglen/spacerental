"""S02: what `get_current_user` must refuse, and what login must not reveal.

Every customer and operator route trusts one dependency to turn a Bearer header
into a user. S01 proves what a known user may do; this file proves how a user
becomes known: the header cannot be forged, replayed after its time, or
smuggled in through another channel, and the login and registration responses
give nothing away.
"""

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from app.auth import ALGORITHM, hash_password
from app.config import settings
from app.models.user import User
from app.routers import auth as auth_router
from jose import jwt
from sqlalchemy import select

API = "/api/v1"
ME = f"{API}/auth/me"
LOGIN = f"{API}/auth/login"
REGISTER = f"{API}/auth/register"


def _claims(user: User, **overrides) -> dict:
    """The claims login issues. An override of `None` removes the claim."""
    claims = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": "member",
        "exp": int((datetime.now(tz=UTC) + timedelta(minutes=5)).timestamp()),
    }
    claims.update(overrides)
    return {key: value for key, value in claims.items() if value is not None}


def _sign(claims: dict, *, key: str | None = None, algorithm: str = ALGORITHM) -> str:
    return jwt.encode(claims, key or settings.SECRET_KEY, algorithm=algorithm)


def _segment(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).rstrip(b"=").decode()


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestTokenValidation:
    async def test_control_a_well_formed_token_is_accepted(self, client, test_user):
        # Every refusal below differs from this token in exactly one way.
        resp = await client.get(ME, headers=_bearer(_sign(_claims(test_user))))
        assert resp.status_code == 200, resp.text
        assert resp.json()["id"] == str(test_user.id)

    async def test_an_expired_token_is_refused(self, client, test_user):
        expired = int((datetime.now(tz=UTC) - timedelta(seconds=1)).timestamp())
        resp = await client.get(ME, headers=_bearer(_sign(_claims(test_user, exp=expired))))
        assert resp.status_code == 401

    async def test_a_token_signed_with_another_key_is_refused(self, client, test_user):
        token = _sign(_claims(test_user), key="x" * len(settings.SECRET_KEY))
        assert (await client.get(ME, headers=_bearer(token))).status_code == 401

    async def test_an_unsigned_token_is_refused(self, client, test_user):
        header = {"alg": "none", "typ": "JWT"}
        for token in (
            f"{_segment(header)}.{_segment(_claims(test_user))}.",
            f"{_segment(header)}.{_segment(_claims(test_user))}",
        ):
            assert (await client.get(ME, headers=_bearer(token))).status_code == 401

    async def test_the_algorithm_is_pinned(self, client, test_user):
        token = _sign(_claims(test_user), algorithm="HS512")
        assert (await client.get(ME, headers=_bearer(token))).status_code == 401

    async def test_a_payload_altered_after_signing_is_refused(self, client, test_user, admin_user):
        header, _, signature = _sign(_claims(test_user)).split(".")
        forged = f"{header}.{_segment(_claims(admin_user))}.{signature}"
        assert (await client.get(ME, headers=_bearer(forged))).status_code == 401

    async def test_a_token_without_a_subject_is_refused(self, client, test_user):
        token = _sign(_claims(test_user, sub=None))
        assert (await client.get(ME, headers=_bearer(token))).status_code == 401

    async def test_a_token_for_nobody_is_refused(self, client, test_user):
        token = _sign(_claims(test_user, sub=str(uuid.uuid4())))
        assert (await client.get(ME, headers=_bearer(token))).status_code == 401

    async def test_a_token_stops_working_when_its_user_is_deleted(self, client, db_session):
        # There is no revocation list (a held decision); the per-request user
        # lookup is what ends a deleted account's session.
        user = User(email="gone@test.com", name="Gone", password_hash=hash_password("password123"))
        db_session.add(user)
        await db_session.commit()
        headers = _bearer(_sign(_claims(user)))
        assert (await client.get(ME, headers=headers)).status_code == 200
        await db_session.delete(user)
        await db_session.commit()
        assert (await client.get(ME, headers=headers)).status_code == 401

    @pytest.mark.parametrize(
        "authorization",
        [
            "Bearer",
            "Bearer not-a-jwt",
            "Bearer a.b.c",
            "Basic dXNlcjpwYXNzd29yZA==",
            "Token {valid}",
        ],
    )
    async def test_a_malformed_authorization_header_is_refused(
        self, client, test_user, authorization
    ):
        value = authorization.format(valid=_sign(_claims(test_user)))
        resp = await client.get(ME, headers={"Authorization": value})
        assert resp.status_code == 401, f"{authorization!r} -> {resp.status_code}"

    async def test_a_token_is_read_only_from_the_authorization_header(self, client, test_user):
        # A token accepted from the query string ends up in access logs and
        # Referer headers; one accepted from a cookie opens the API to CSRF.
        token = _sign(_claims(test_user))
        in_query = await client.get(ME, params={"token": token, "access_token": token})
        in_cookie = await client.get(ME, headers={"Cookie": f"access_token={token}; token={token}"})
        assert (in_query.status_code, in_cookie.status_code) == (401, 401)


class TestLoginGivesNothingAway:
    async def test_unknown_email_and_wrong_password_answer_identically(self, client, test_user):
        wrong = await client.post(
            LOGIN, json={"email": test_user.email, "password": "not-this-one"}
        )
        unknown = await client.post(
            LOGIN, json={"email": "nobody@test.com", "password": "not-this-one"}
        )
        assert (wrong.status_code, unknown.status_code) == (401, 401)
        assert wrong.json() == unknown.json()
        assert wrong.headers.get("www-authenticate") == unknown.headers.get("www-authenticate")

    async def test_an_account_without_a_password_cannot_log_in(self, client, db_session):
        db_session.add(User(email="nopass@test.com", name="No Password", password_hash=None))
        await db_session.commit()
        for password in ("password123", "None", "null"):
            resp = await client.post(LOGIN, json={"email": "nopass@test.com", "password": password})
            assert resp.status_code == 401, resp.text

    async def test_issued_claims_are_bounded_and_carry_no_secret(
        self, client, test_user, test_member
    ):
        resp = await client.post(LOGIN, json={"email": test_user.email, "password": "password123"})
        assert resp.status_code == 200, resp.text
        claims = jwt.decode(
            resp.json()["access_token"], settings.SECRET_KEY, algorithms=[ALGORITHM]
        )
        assert set(claims) <= {"sub", "email", "name", "role", "memberships", "exp"}
        assert claims["sub"] == str(test_user.id)
        # Exact, so nothing can ride along inside a membership either.
        assert claims["memberships"] == [{"org_id": str(test_member.org_id), "role": "member"}]
        lifetime = datetime.fromtimestamp(claims["exp"], tz=UTC) - datetime.now(tz=UTC)
        assert timedelta(0) < lifetime <= timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    async def test_no_auth_response_contains_the_password_or_its_hash(
        self, client, db_session, test_org, monkeypatch
    ):
        monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
        password = "a-very-recognisable-password"
        body = {"email": "secret@test.com", "password": password, "name": "Secret"}
        registered = await client.post(REGISTER, json=body)
        assert registered.status_code == 201, registered.text
        logged_in = await client.post(LOGIN, json={"email": body["email"], "password": password})
        me = await client.get(ME, headers=_bearer(logged_in.json()["access_token"]))
        # The operator path is a separate branch of registration.
        operator = await client.post(
            f"{REGISTER}/operator",
            json={"email": "secret-operator@test.com", "password": password, "name": "Secret Op"},
        )
        assert operator.status_code == 201, operator.text
        stored = await db_session.scalar(
            select(User.password_hash).where(User.email == body["email"])
        )
        assert stored.startswith("$argon2id$")
        operator_stored = await db_session.scalar(
            select(User.password_hash).where(User.email == "secret-operator@test.com")
        )
        for resp in (registered, logged_in, me, operator):
            assert password not in resp.text
            assert stored not in resp.text
            assert operator_stored not in resp.text
            assert "password_hash" not in resp.text

    @pytest.mark.parametrize("length", [129, 100_000])
    async def test_an_over_long_password_is_refused_before_any_hashing(
        self, client, test_user, test_org, monkeypatch, length
    ):
        # Argon2 costs 64 MB and tens of milliseconds per call by design, so the
        # schema bound is what keeps a large body from becoming hashing work.
        def must_not_run(*args, **kwargs):
            raise AssertionError("password hashing ran on an over-long password")

        monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", test_org.slug)
        monkeypatch.setattr(auth_router, "hash_password", must_not_run)
        monkeypatch.setattr(auth_router, "verify_password", must_not_run)
        password = "p" * length
        login = await client.post(LOGIN, json={"email": test_user.email, "password": password})
        register = await client.post(
            REGISTER, json={"email": "long@test.com", "password": password, "name": "Long"}
        )
        assert (login.status_code, register.status_code) == (422, 422)
