"""S01: authorization and tenant-isolation regression matrix.

Tenant isolation is enforced by hand in every handler (CLAUDE.md §4; RLS is
deferred as D01), so nothing else fails when a route forgets its check. This
file does. Every API route must be classified below, the classification must
match the route's authentication dependency, and six personas exercise every
operator and customer route against the wrong organization or the wrong
customer, reading the rows back to prove nothing moved.
"""

import re
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.config import settings
from app.main import app
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.recurrence import RecurrenceFrequency, RecurrenceRule
from app.models.space import AvailabilityRule, Room, Space
from app.models.user import User
from app.routers import recurrences
from fastapi.routing import APIRoute
from sqlalchemy import func, select

PUBLIC = "public"  # no authentication by design
CUSTOMER = "customer"  # get_current_user; ownership or membership decides inside
OPERATOR = "operator"  # require_admin: operator membership in the org_id given
WEBHOOK = "webhook"  # the provider signature is the credential
STUB = "stub"  # local stub checkout page; 404s outside stub mode

API = "/api/v1"
ROUTES: dict[tuple[str, str], str] = {
    ("POST", f"{API}/auth/register"): PUBLIC,
    ("POST", f"{API}/auth/register/operator"): PUBLIC,
    ("POST", f"{API}/auth/login"): PUBLIC,
    ("POST", f"{API}/auth/enroll"): CUSTOMER,
    ("GET", f"{API}/auth/me"): CUSTOMER,
    ("GET", f"{API}/auth/memberships"): CUSTOMER,
    ("GET", f"{API}/spaces"): PUBLIC,
    ("GET", f"{API}/spaces/{{space_id}}"): PUBLIC,
    ("GET", f"{API}/rooms/{{room_id}}/availability"): PUBLIC,
    ("GET", f"{API}/bookings/me"): CUSTOMER,
    ("POST", f"{API}/bookings"): CUSTOMER,
    ("DELETE", f"{API}/bookings/{{booking_id}}"): CUSTOMER,
    ("POST", f"{API}/bookings/{{booking_id}}/checkout"): CUSTOMER,
    ("POST", f"{API}/recurrences"): CUSTOMER,
    ("PUT", f"{API}/recurrences/{{recurrence_id}}"): CUSTOMER,
    ("DELETE", f"{API}/recurrences/{{recurrence_id}}"): CUSTOMER,
    ("GET", f"{API}/packages"): PUBLIC,
    ("POST", f"{API}/packages/{{package_id}}/purchase"): CUSTOMER,
    ("GET", f"{API}/packages/me"): CUSTOMER,
    ("GET", f"{API}/admin/dashboard"): OPERATOR,
    ("GET", f"{API}/admin/spaces"): OPERATOR,
    ("POST", f"{API}/admin/spaces"): OPERATOR,
    ("PUT", f"{API}/admin/spaces/{{space_id}}"): OPERATOR,
    ("DELETE", f"{API}/admin/spaces/{{space_id}}"): OPERATOR,
    ("POST", f"{API}/admin/spaces/{{space_id}}/rooms"): OPERATOR,
    ("PUT", f"{API}/admin/rooms/{{room_id}}"): OPERATOR,
    ("GET", f"{API}/admin/rooms/{{room_id}}/availability"): OPERATOR,
    ("POST", f"{API}/admin/rooms/{{room_id}}/availability"): OPERATOR,
    ("GET", f"{API}/admin/bookings"): OPERATOR,
    ("PUT", f"{API}/admin/bookings/{{booking_id}}"): OPERATOR,
    ("GET", f"{API}/admin/users"): OPERATOR,
    ("GET", f"{API}/admin/packages"): OPERATOR,
    ("POST", f"{API}/admin/packages"): OPERATOR,
    ("PUT", f"{API}/admin/packages/{{package_id}}"): OPERATOR,
    ("POST", f"{API}/webhooks/stripe"): WEBHOOK,
    ("GET", "/checkout/stub/{session_id}"): STUB,
    ("POST", "/checkout/stub/{session_id}/pay"): STUB,
    ("POST", "/checkout/stub/{session_id}/cancel"): STUB,
    ("GET", "/health"): PUBLIC,
}

# Minimal valid bodies, so a sweep's 401/403/404 is the authorization answer and
# a positive control is not a 422 in disguise.
BODIES: dict[tuple[str, str], dict] = {
    ("POST", f"{API}/admin/spaces"): {"name": "Sweep space"},
    ("PUT", f"{API}/admin/spaces/{{space_id}}"): {"name": "Renamed"},
    ("POST", f"{API}/admin/spaces/{{space_id}}/rooms"): {"name": "Sala", "hourly_rate": "10.00"},
    ("PUT", f"{API}/admin/rooms/{{room_id}}"): {"hourly_rate": "0.01"},
    ("POST", f"{API}/admin/rooms/{{room_id}}/availability"): {"rules": []},
    ("PUT", f"{API}/admin/bookings/{{booking_id}}"): {"status": "cancelled"},
    ("POST", f"{API}/admin/packages"): {"name": "Sweep pack", "hours": 1, "price": "1.00"},
    ("PUT", f"{API}/admin/packages/{{package_id}}"): {"price": "0.01"},
}

_PASSWORD_HASH: str | None = None


def _password_hash() -> str:
    """Argon2id is deliberately slow; every persona can share one hash."""
    global _PASSWORD_HASH  # noqa: PLW0603
    if _PASSWORD_HASH is None:
        _PASSWORD_HASH = hash_password("password123")
    return _PASSWORD_HASH


def _routes(kind: str) -> list[tuple[str, str]]:
    return sorted(key for key, value in ROUTES.items() if value == kind)


def _as(user: User, role_claim: str = "member") -> dict[str, str]:
    token = create_access_token(
        {"sub": str(user.id), "email": user.email, "name": user.name, "role": role_claim}
    )
    return {"Authorization": f"Bearer {token}"}


def _slot(hour: int = 10) -> tuple[datetime, datetime]:
    """An hour on a Monday one to two weeks out: inside opening hours, far from 24h rules."""
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(today + timedelta(days=days_ahead + 7), time(hour, 0), tzinfo=UTC)
    return start, start + timedelta(hours=1)


def _url(path: str, ids: dict[str, uuid.UUID] | None = None) -> str:
    """Fill every `{param}` with the given id, or a random UUID when none is given."""
    ids = ids or {}
    return re.sub(r"\{(\w+)\}", lambda m: str(ids.get(m.group(1), uuid.uuid4())), path)


async def _send(client, method: str, path: str, *, headers=None, org_id=None, ids=None):
    kwargs: dict = {"headers": headers or {}}
    if org_id is not None:
        kwargs["params"] = {"org_id": str(org_id)}
    if method in ("POST", "PUT"):
        kwargs["json"] = BODIES.get((method, path), {})
    return await client.request(method, _url(path, ids), **kwargs)


async def _fresh(db_session, model, row_id):
    result = await db_session.execute(
        select(model).where(model.id == row_id).execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def _count(db_session, model, *where) -> int:
    result = await db_session.execute(select(func.count()).select_from(model).where(*where))
    return result.scalar_one()


@pytest_asyncio.fixture
async def world(db_session) -> SimpleNamespace:
    """Two organizations with the same shape, and six personas across them."""
    w = SimpleNamespace()

    async def make_user(email: str) -> User:
        user = User(
            email=email, name=email.split("@", maxsplit=1)[0], password_hash=_password_hash()
        )
        db_session.add(user)
        await db_session.flush()
        return user

    async def join(user: User, org: Organization, role: MemberRole) -> None:
        db_session.add(OrganizationMember(org_id=org.id, user_id=user.id, role=role))

    w.cust_a = await make_user("cust-a@test.com")
    w.cust_a2 = await make_user("cust-a2@test.com")
    w.cust_b = await make_user("cust-b@test.com")
    w.op_a = await make_user("op-a@test.com")
    w.op_b = await make_user("op-b@test.com")
    w.dual = await make_user("dual@test.com")  # operates A, is only a customer of B

    start, end = _slot(10)
    for key, customer in (("a", w.cust_a), ("b", w.cust_b)):
        org = Organization(name=f"Org {key}", slug=f"org-{key}", plan=OrgPlan.starter, settings={})
        db_session.add(org)
        await db_session.flush()
        space = Space(
            org_id=org.id,
            name=f"Space {key}",
            description="d",
            address="addr",
            city="Lisboa",
            images=[],
            amenities=[],
        )
        db_session.add(space)
        await db_session.flush()
        room = Room(
            space_id=space.id,
            org_id=org.id,
            name=f"Sala {key}",
            description="d",
            capacity=4,
            hourly_rate=Decimal("11.00"),
            color="#A8D5BA",
            images=[],
            amenities=[],
        )
        db_session.add(room)
        await db_session.flush()
        for day in range(6):
            db_session.add(
                AvailabilityRule(
                    room_id=room.id, day_of_week=day, open_time=time(8, 0), close_time=time(20, 0)
                )
            )
        package = Package(
            org_id=org.id, name=f"Pack {key}", hours=10, price=Decimal("100.00"), validity_days=365
        )
        db_session.add(package)
        await db_session.flush()
        booking = Booking(
            org_id=org.id,
            room_id=room.id,
            user_id=customer.id,
            start_time=start,
            end_time=end,
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.hourly,
        )
        purchase = UserPackagePurchase(
            user_id=customer.id,
            package_id=package.id,
            org_id=org.id,
            hours_total=Decimal("10.00"),
            hours_used=Decimal("0.00"),
            hours_remaining=Decimal("10.00"),
            status=PurchaseStatus.active,
            purchased_at=datetime.now(tz=UTC),
            expires_at=datetime.now(tz=UTC) + timedelta(days=365),
        )
        db_session.add_all([booking, purchase])
        await db_session.flush()
        setattr(w, f"org_{key}", org)
        setattr(w, f"space_{key}", space)
        setattr(w, f"room_{key}", room)
        setattr(w, f"package_{key}", package)
        setattr(w, f"booking_{key}", booking)
        setattr(w, f"purchase_{key}", purchase)

    await join(w.cust_a, w.org_a, MemberRole.member)
    await join(w.cust_a2, w.org_a, MemberRole.member)
    await join(w.cust_b, w.org_b, MemberRole.member)
    await join(w.op_a, w.org_a, MemberRole.owner)
    await join(w.op_b, w.org_b, MemberRole.admin)
    await join(w.dual, w.org_a, MemberRole.admin)
    await join(w.dual, w.org_b, MemberRole.member)
    await db_session.commit()
    return w


class TestClassification:
    def _api_routes(self) -> dict[tuple[str, str], APIRoute]:
        found: dict[tuple[str, str], APIRoute] = {}
        for route in app.routes:
            if isinstance(route, APIRoute):
                for method in route.methods - {"HEAD", "OPTIONS"}:
                    found[(method, route.path)] = route
        return found

    def test_every_route_is_classified(self):
        actual = set(self._api_routes())
        unclassified = sorted(actual - set(ROUTES))
        stale = sorted(set(ROUTES) - actual)
        assert not unclassified, (
            f"New routes must be classified in ROUTES and covered below: {unclassified}"
        )
        assert not stale, f"ROUTES lists routes that no longer exist: {stale}"

    def test_classification_matches_the_authentication_dependency(self):
        def dependency_names(dependant, acc=None) -> set[str]:
            acc = set() if acc is None else acc
            for dep in dependant.dependencies:
                if dep.call is not None:
                    acc.add(getattr(dep.call, "__name__", str(dep.call)))
                dependency_names(dep, acc)
            return acc

        wrong = []
        for key, route in self._api_routes().items():
            names = dependency_names(route.dependant)
            kind = ROUTES.get(key)
            if kind == OPERATOR and "require_admin" not in names:
                wrong.append(f"{key}: operator route without require_admin")
            if kind == CUSTOMER and ("get_current_user" not in names or "require_admin" in names):
                wrong.append(f"{key}: customer route must depend on get_current_user only")
            if kind in (PUBLIC, WEBHOOK, STUB) and names & {"get_current_user", "require_admin"}:
                wrong.append(f"{key}: classified {kind} but requires authentication")
        assert not wrong, wrong


class TestAnonymous:
    @pytest.mark.parametrize(("method", "path"), _routes(CUSTOMER) + _routes(OPERATOR))
    async def test_every_customer_and_operator_route_requires_a_token(
        self, client, monkeypatch, method, path
    ):
        monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", True)
        resp = await _send(client, method, path, org_id=uuid.uuid4())
        assert resp.status_code == 401, f"{method} {path} -> {resp.status_code} {resp.text}"

    async def test_series_routes_do_not_exist_while_the_flag_is_off(
        self, client, world, monkeypatch
    ):
        monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", False)
        for method, path in _routes(CUSTOMER):
            if "/recurrences" not in path:
                continue
            for headers in ({}, _as(world.cust_a)):
                resp = await _send(client, method, path, headers=headers)
                assert resp.status_code == 404, f"{method} {path} -> {resp.status_code}"


class TestOperatorRoutesNeedAnOperatorOfThatOrg:
    async def _sweep(self, client, headers, org_id) -> list[str]:
        refused_wrongly = []
        for method, path in _routes(OPERATOR):
            resp = await _send(client, method, path, headers=headers, org_id=org_id)
            if resp.status_code != 403:
                refused_wrongly.append(f"{method} {path} -> {resp.status_code}")
        return refused_wrongly

    async def test_a_customer_of_the_org_is_refused(self, client, world):
        assert await self._sweep(client, _as(world.cust_a), world.org_a.id) == []

    async def test_a_customer_of_another_org_is_refused(self, client, world):
        assert await self._sweep(client, _as(world.cust_b), world.org_a.id) == []

    async def test_an_operator_of_another_org_is_refused(self, client, world):
        assert await self._sweep(client, _as(world.op_b, "admin"), world.org_a.id) == []

    async def test_operating_one_org_grants_nothing_in_another(self, client, world):
        # `dual` is an admin of A and only a customer of B.
        assert await self._sweep(client, _as(world.dual, "admin"), world.org_b.id) == []

    async def test_a_stale_owner_claim_in_the_token_grants_nothing(self, client, world):
        # The role claim is UI sugar; only the membership row decides (I3).
        assert await self._sweep(client, _as(world.cust_a, "owner"), world.org_a.id) == []

    async def test_control_the_orgs_own_operator_passes_the_gate(self, client, world):
        blocked = []
        for method, path in _routes(OPERATOR):
            resp = await _send(
                client, method, path, headers=_as(world.op_a, "owner"), org_id=world.org_a.id
            )
            if resp.status_code in (401, 403) or resp.status_code >= 500:
                blocked.append(f"{method} {path} -> {resp.status_code}")
        assert blocked == []


class TestOperatorCannotTouchAnotherOrgsResources:
    """Operator of A, passing their own org_id, aiming at B's rows: 404 and no change."""

    async def test_space(self, client, world, db_session):
        headers, org = _as(world.op_a, "owner"), world.org_a.id
        ids = {"space_id": world.space_b.id}
        rooms_before = await _count(db_session, Room, Room.space_id == world.space_b.id)
        for method, path in (
            ("PUT", f"{API}/admin/spaces/{{space_id}}"),
            ("DELETE", f"{API}/admin/spaces/{{space_id}}"),
            ("POST", f"{API}/admin/spaces/{{space_id}}/rooms"),
        ):
            resp = await _send(client, method, path, headers=headers, org_id=org, ids=ids)
            assert resp.status_code == 404, f"{method} {path} -> {resp.status_code} {resp.text}"
        space = await _fresh(db_session, Space, world.space_b.id)
        assert (space.name, space.is_active, space.org_id) == ("Space b", True, world.org_b.id)
        assert await _count(db_session, Room, Room.space_id == world.space_b.id) == rooms_before

    async def test_room_and_availability(self, client, world, db_session):
        headers, org = _as(world.op_a, "owner"), world.org_a.id
        ids = {"room_id": world.room_b.id}
        for method, path in (
            ("PUT", f"{API}/admin/rooms/{{room_id}}"),
            ("GET", f"{API}/admin/rooms/{{room_id}}/availability"),
            ("POST", f"{API}/admin/rooms/{{room_id}}/availability"),
        ):
            resp = await _send(client, method, path, headers=headers, org_id=org, ids=ids)
            assert resp.status_code == 404, f"{method} {path} -> {resp.status_code} {resp.text}"
        room = await _fresh(db_session, Room, world.room_b.id)
        assert room.hourly_rate == Decimal("11.00")
        rules = await _count(db_session, AvailabilityRule, AvailabilityRule.room_id == room.id)
        assert rules == 6

    async def test_booking(self, client, world, db_session):
        resp = await _send(
            client,
            "PUT",
            f"{API}/admin/bookings/{{booking_id}}",
            headers=_as(world.op_a, "owner"),
            org_id=world.org_a.id,
            ids={"booking_id": world.booking_b.id},
        )
        assert resp.status_code == 404, resp.text
        booking = await _fresh(db_session, Booking, world.booking_b.id)
        assert booking.status is BookingStatus.confirmed

    async def test_package(self, client, world, db_session):
        resp = await _send(
            client,
            "PUT",
            f"{API}/admin/packages/{{package_id}}",
            headers=_as(world.op_a, "owner"),
            org_id=world.org_a.id,
            ids={"package_id": world.package_b.id},
        )
        assert resp.status_code == 404, resp.text
        package = await _fresh(db_session, Package, world.package_b.id)
        assert (package.price, package.is_active) == (Decimal("100.00"), True)

    async def test_filtering_bookings_by_another_orgs_room_leaks_nothing(self, client, world):
        resp = await client.get(
            f"{API}/admin/bookings",
            params={"org_id": str(world.org_a.id), "room_id": str(world.room_b.id)},
            headers=_as(world.op_a, "owner"),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["bookings"] == []
        assert resp.json()["total"] == 0


class TestOperatorListsAreScoped:
    async def test_every_list_returns_only_the_orgs_rows(self, client, world):
        headers, params = _as(world.op_a, "owner"), {"org_id": str(world.org_a.id)}

        async def get(path: str) -> dict:
            resp = await client.get(f"{API}/admin/{path}", params=params, headers=headers)
            assert resp.status_code == 200, resp.text
            return resp.json()

        assert [s["id"] for s in (await get("spaces"))["spaces"]] == [str(world.space_a.id)]
        bookings = (await get("bookings"))["bookings"]
        assert [b["id"] for b in bookings] == [str(world.booking_a.id)]
        assert [p["id"] for p in (await get("packages"))["packages"]] == [str(world.package_a.id)]
        assert [u["id"] for u in (await get("users"))["users"]] == [str(world.cust_a.id)]
        assert (await get("dashboard"))["total_bookings"] == 1


class TestCustomerIsolation:
    async def test_nobody_else_can_cancel_or_pay_a_customers_booking(
        self, client, world, db_session, payments
    ):
        for other in (world.cust_a2, world.cust_b, world.op_b):
            for method, path in (
                ("DELETE", f"{API}/bookings/{{booking_id}}"),
                ("POST", f"{API}/bookings/{{booking_id}}/checkout"),
            ):
                resp = await _send(
                    client, method, path, headers=_as(other), ids={"booking_id": world.booking_a.id}
                )
                assert resp.status_code == 403, f"{other.email} {method} -> {resp.status_code}"
        booking = await _fresh(db_session, Booking, world.booking_a.id)
        assert booking.status is BookingStatus.confirmed
        assert booking.stripe_checkout_session_id is None

    async def test_my_lists_contain_only_my_rows(self, client, world):
        for user, bookings, purchases in (
            (world.cust_a, [world.booking_a.id], [world.purchase_a.id]),
            (world.cust_a2, [], []),
            (world.cust_b, [world.booking_b.id], [world.purchase_b.id]),
        ):
            mine = await client.get(f"{API}/bookings/me", headers=_as(user))
            packs = await client.get(f"{API}/packages/me", headers=_as(user))
            assert [b["id"] for b in mine.json()["bookings"]] == [str(i) for i in bookings]
            assert [p["id"] for p in packs.json()["purchases"]] == [str(i) for i in purchases]

    async def test_a_customer_cannot_book_a_room_of_an_org_they_do_not_belong_to(
        self, client, world, db_session, payments
    ):
        start, end = _slot(12)
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(world.room_b.id),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
            },
            headers=_as(world.cust_a),
        )
        assert resp.status_code == 403, resp.text
        assert await _count(db_session, Booking, Booking.user_id == world.cust_a.id) == 1

    async def test_a_purchase_is_bound_to_the_packages_org_and_to_membership(
        self, client, world, db_session, payments
    ):
        url = f"{API}/packages/{world.package_b.id}/purchase"
        # B's package presented as if it were A's: not found in A.
        resp = await client.post(
            url, json={"org_id": str(world.org_a.id)}, headers=_as(world.cust_a)
        )
        assert resp.status_code == 404, resp.text
        # B's package in B, by someone who is not a member of B.
        resp = await client.post(
            url, json={"org_id": str(world.org_b.id)}, headers=_as(world.cust_a)
        )
        assert resp.status_code == 403, resp.text
        owned = await _count(
            db_session, UserPackagePurchase, UserPackagePurchase.user_id == world.cust_a.id
        )
        assert owned == 1

    async def test_another_customers_series_cannot_be_edited_or_cancelled(
        self, client, world, db_session, monkeypatch
    ):
        monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", True)
        start, end = _slot(15)
        rule = RecurrenceRule(
            org_id=world.org_a.id,
            room_id=world.room_a.id,
            user_id=world.cust_a.id,
            frequency=RecurrenceFrequency.weekly,
            start_time=start,
            end_time=end,
            until_date=date.fromordinal(start.date().toordinal() + 14),
            is_active=True,
        )
        db_session.add(rule)
        await db_session.commit()
        body = {"start_time": start.isoformat(), "end_time": end.isoformat()}
        for other in (world.cust_a2, world.cust_b):
            put = await client.put(f"{API}/recurrences/{rule.id}", json=body, headers=_as(other))
            delete = await client.delete(f"{API}/recurrences/{rule.id}", headers=_as(other))
            assert (put.status_code, delete.status_code) == (403, 403), (put.text, delete.text)
        assert (await _fresh(db_session, RecurrenceRule, rule.id)).is_active is True

    async def test_a_dual_role_user_operates_only_where_they_are_an_operator(self, client, world):
        headers = _as(world.dual, "admin")
        in_a = await client.get(
            f"{API}/admin/spaces", params={"org_id": str(world.org_a.id)}, headers=headers
        )
        in_b = await client.get(
            f"{API}/admin/spaces", params={"org_id": str(world.org_b.id)}, headers=headers
        )
        assert (in_a.status_code, in_b.status_code) == (200, 403)


class TestClientSuppliedFieldsAreIgnored:
    async def test_a_booking_takes_owner_org_status_and_price_from_the_server(
        self, client, world, db_session, payments
    ):
        start, end = _slot(12)
        resp = await client.post(
            f"{API}/bookings",
            json={
                "room_id": str(world.room_a.id),
                "start_time": start.isoformat(),
                "end_time": end.isoformat(),
                "user_id": str(world.cust_b.id),
                "org_id": str(world.org_b.id),
                "status": "confirmed",
                "total_amount": "0.00",
                "duration_hours": "0",
                "hold_expires_at": "2099-01-01T00:00:00Z",
                "package_purchase_id": str(world.purchase_b.id),
                "stripe_checkout_session_id": "cs_forged",
            },
            headers=_as(world.cust_a),
        )
        assert resp.status_code == 201, resp.text
        booking = await _fresh(db_session, Booking, uuid.UUID(resp.json()["booking"]["id"]))
        assert booking.user_id == world.cust_a.id
        assert booking.org_id == world.org_a.id
        assert booking.status is BookingStatus.pending
        assert booking.total_amount == Decimal("11.00")
        assert booking.duration_hours == Decimal("1.00")
        assert booking.package_purchase_id is None
        assert booking.stripe_checkout_session_id != "cs_forged"
        assert booking.hold_expires_at < datetime.now(tz=UTC) + timedelta(hours=1)

    async def test_an_operator_update_cannot_move_a_row_to_another_org(
        self, client, world, db_session
    ):
        headers, params = _as(world.op_a, "owner"), {"org_id": str(world.org_a.id)}
        hostile = {"org_id": str(world.org_b.id), "id": str(uuid.uuid4())}
        space = await client.put(
            f"{API}/admin/spaces/{world.space_a.id}",
            params=params,
            json={**hostile, "name": "Renamed"},
            headers=headers,
        )
        room = await client.put(
            f"{API}/admin/rooms/{world.room_a.id}",
            params=params,
            json={**hostile, "space_id": str(world.space_b.id), "capacity": 5},
            headers=headers,
        )
        package = await client.put(
            f"{API}/admin/packages/{world.package_a.id}",
            params=params,
            json={**hostile, "price": "90.00"},
            headers=headers,
        )
        assert (space.status_code, room.status_code, package.status_code) == (200, 200, 200)
        fresh_space = await _fresh(db_session, Space, world.space_a.id)
        fresh_room = await _fresh(db_session, Room, world.room_a.id)
        fresh_package = await _fresh(db_session, Package, world.package_a.id)
        assert (fresh_space.org_id, fresh_space.name) == (world.org_a.id, "Renamed")
        assert (fresh_room.org_id, fresh_room.space_id) == (world.org_a.id, world.space_a.id)
        assert fresh_room.capacity == 5
        assert (fresh_package.org_id, fresh_package.price) == (world.org_a.id, Decimal("90.00"))

    async def test_registration_cannot_choose_a_role_or_an_org(
        self, client, world, db_session, monkeypatch
    ):
        monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", world.org_a.slug)
        monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ENABLED", True)
        resp = await client.post(
            f"{API}/auth/register",
            json={
                "email": "newcomer@test.com",
                "password": "password123",
                "name": "Newcomer",
                "role": "owner",
                "is_admin": True,
                "org_id": str(world.org_b.id),
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["role"] == "member"
        user_id = uuid.UUID(resp.json()["user"]["id"])
        rows = await db_session.execute(
            select(OrganizationMember.org_id, OrganizationMember.role).where(
                OrganizationMember.user_id == user_id
            )
        )
        assert rows.all() == [(world.org_a.id, MemberRole.member)]
