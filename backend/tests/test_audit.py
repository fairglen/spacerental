"""G01: the operator audit trail.

Every admin mutation route must appear in SCENARIOS below with a happy-path
call, and that call must write exactly one `admin_actions` row. A new
mutation route that is not listed fails `test_every_admin_mutation_route_has_a_scenario`,
so nothing an operator can change ships without a trail. The rest of the
file pins what a row holds (public schema only, changed keys plus ids, the
request id), that a rollback writes nothing, and the two read endpoints.
"""

import io
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from app import audit
from app.auth import create_access_token, hash_password
from app.config import settings
from app.main import app
from app.models.audit import AdminAction
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.space import AvailabilityRule, Room, Space
from app.models.support import SupportCategory, SupportRequest, SupportStatus
from app.models.user import User
from app.routing_inventory import iter_api_routes
from PIL import Image
from sqlalchemy import func, select

from tests.test_authz_matrix import OPERATOR, ROUTES

API = "/api/v1"
MUTATING = frozenset({"POST", "PUT", "DELETE"})


def _headers(user: User, role: str) -> dict[str, str]:
    token = create_access_token(
        {"sub": str(user.id), "email": user.email, "name": user.name, "role": role}
    )
    return {"Authorization": f"Bearer {token}"}


def _image() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (400, 300), (61, 122, 94)).save(out, format="JPEG")
    return out.getvalue()


def _monday(weeks_ahead: int, hour: int) -> datetime:
    today = datetime.now(tz=UTC).date()
    days = (0 - today.weekday()) % 7 or 7
    return datetime.combine(today + timedelta(days=days + 7 * weeks_ahead), time(hour), tzinfo=UTC)


async def _count(db_session, org_id=None) -> int:
    where = [] if org_id is None else [AdminAction.org_id == org_id]
    return await db_session.scalar(select(func.count()).select_from(AdminAction).where(*where))


async def _rows(db_session, org_id) -> list[AdminAction]:
    result = await db_session.execute(
        select(AdminAction)
        .where(AdminAction.org_id == org_id)
        .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
    )
    return list(result.scalars().all())


@pytest_asyncio.fixture
async def w(db_session, monkeypatch) -> SimpleNamespace:
    """One organisation with a bit of everything, and a second one for scoping."""
    # A customer who registers through the public form lands in org A.
    monkeypatch.setattr(settings, "CUSTOMER_ENROLLMENT_ORG_SLUG", "org-a")
    w = SimpleNamespace()
    password = hash_password("password123")
    w.org = Organization(name="Org A", slug="org-a", plan=OrgPlan.starter, settings={})
    w.other_org = Organization(name="Org B", slug="org-b", plan=OrgPlan.starter, settings={})
    db_session.add_all([w.org, w.other_org])
    await db_session.flush()
    w.admin = User(email="admin-a@test.com", name="Admin A", password_hash=password)
    w.member = User(email="member-a@test.com", name="Member A", password_hash=password)
    w.other_admin = User(email="admin-b@test.com", name="Admin B", password_hash=password)
    db_session.add_all([w.admin, w.member, w.other_admin])
    await db_session.flush()
    db_session.add_all(
        [
            OrganizationMember(org_id=w.org.id, user_id=w.admin.id, role=MemberRole.owner),
            OrganizationMember(org_id=w.org.id, user_id=w.member.id, role=MemberRole.member),
            OrganizationMember(
                org_id=w.other_org.id, user_id=w.other_admin.id, role=MemberRole.owner
            ),
        ]
    )
    w.space = Space(
        org_id=w.org.id, name="Space A", timezone="UTC", images=[], amenities=[], photos=[]
    )
    w.empty_space = Space(
        org_id=w.org.id, name="Empty", timezone="UTC", images=[], amenities=[], photos=[]
    )
    w.other_space = Space(
        org_id=w.other_org.id, name="Space B", timezone="UTC", images=[], amenities=[], photos=[]
    )
    db_session.add_all([w.space, w.empty_space, w.other_space])
    await db_session.flush()
    w.room = Room(
        space_id=w.space.id,
        org_id=w.org.id,
        name="Sala A",
        capacity=4,
        hourly_rate=Decimal("11.00"),
        images=[],
        amenities=[],
        photos=[],
    )
    w.other_room = Room(
        space_id=w.other_space.id,
        org_id=w.other_org.id,
        name="Sala B",
        capacity=4,
        hourly_rate=Decimal("11.00"),
        images=[],
        amenities=[],
        photos=[],
    )
    db_session.add_all([w.room, w.other_room])
    await db_session.flush()
    for room in (w.room, w.other_room):
        for day in range(6):
            db_session.add(
                AvailabilityRule(
                    room_id=room.id, day_of_week=day, open_time=time(8), close_time=time(20)
                )
            )
    w.package = Package(
        org_id=w.org.id, name="Pack 10", hours=10, price=Decimal("100.00"), validity_days=365
    )
    db_session.add(w.package)
    await db_session.flush()
    now = datetime.now(tz=UTC)
    w.purchase = UserPackagePurchase(
        user_id=w.member.id,
        package_id=w.package.id,
        org_id=w.org.id,
        hours_total=Decimal("10.00"),
        hours_used=Decimal("0.00"),
        hours_remaining=Decimal("10.00"),
        amount_paid=Decimal("100.00"),
        status=PurchaseStatus.active,
        purchased_at=now,
        expires_at=now + timedelta(days=365),
    )
    start = _monday(1, 10)
    w.booking = Booking(
        org_id=w.org.id,
        room_id=w.room.id,
        user_id=w.member.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=BookingStatus.confirmed,
        payment_method=PaymentMethod.hourly,
    )
    hold = _monday(1, 14)
    w.pending = Booking(
        org_id=w.org.id,
        room_id=w.room.id,
        user_id=w.member.id,
        start_time=hold,
        end_time=hold + timedelta(hours=1),
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=BookingStatus.pending,
        payment_method=PaymentMethod.hourly,
        hold_expires_at=now + timedelta(minutes=15),
    )
    w.request = SupportRequest(
        org_id=w.org.id,
        user_id=w.member.id,
        category=SupportCategory.booking,
        message="A sala estava fechada quando cheguei, às dez.",
        contact_email=w.member.email,
        context={},
        status=SupportStatus.new,
    )
    db_session.add_all([w.purchase, w.booking, w.pending, w.request])
    await db_session.commit()
    w.headers = _headers(w.admin, "owner")
    w.params = {"org_id": str(w.org.id)}
    return w


# ─── The scenario table: one happy-path call per admin mutation route ───────

Act = Callable[..., Awaitable]


@dataclass(frozen=True)
class Scenario:
    act: Act
    setup: Act | None = None


async def _upload(client, w, kind: str, entity_id) -> str:
    resp = await client.post(
        f"{API}/admin/{kind}/{entity_id}/images",
        params=w.params,
        files={"file": ("foto.jpg", _image(), "image/jpeg")},
        headers=w.headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()[kind[:-1]]["photos"][-1]["id"]


async def _room_photo(client, w):
    w.photo_id = await _upload(client, w, "rooms", w.room.id)


async def _space_photo(client, w):
    w.photo_id = await _upload(client, w, "spaces", w.space.id)


async def _block(client, w):
    start = _monday(2, 9)
    resp = await client.post(
        f"{API}/admin/rooms/{w.room.id}/blocks",
        params=w.params,
        json={
            "start_time": start.isoformat(),
            "end_time": (start + timedelta(hours=1)).isoformat(),
            "reason": "Manutenção",
        },
        headers=w.headers,
    )
    assert resp.status_code == 201, resp.text
    w.block_id = resp.json()["block"]["id"]


async def _spare_room(client, w):
    resp = await client.post(
        f"{API}/admin/spaces/{w.space.id}/rooms",
        params=w.params,
        json={"name": "Sala livre", "hourly_rate": "9.00"},
        headers=w.headers,
    )
    assert resp.status_code == 201, resp.text
    w.spare_room = SimpleNamespace(id=resp.json()["room"]["id"])


async def _first_rule(client, w):
    resp = await client.get(
        f"{API}/admin/rooms/{w.room.id}/availability", params=w.params, headers=w.headers
    )
    w.rule_id = resp.json()["rules"][0]["id"]


async def _expire_pending(client, w):
    # Through the API so the row is what an expired hold really looks like.
    resp = await client.put(
        f"{API}/admin/bookings/{w.pending.id}",
        params=w.params,
        json={"status": "expired"},
        headers=w.headers,
    )
    assert resp.status_code == 200, resp.text


async def _fresh_user(client, w):
    resp = await client.post(
        f"{API}/auth/register", json={"email": "fresh@test.com", "password": "password123"}
    )
    assert resp.status_code == 201, resp.text
    w.fresh = SimpleNamespace(id=resp.json()["user"]["id"])


async def _unsold_package(client, w):
    resp = await client.post(
        f"{API}/admin/packages",
        params=w.params,
        json={"name": "Pack 5", "hours": 5, "price": "50"},
        headers=w.headers,
    )
    assert resp.status_code == 201, resp.text
    w.unsold = SimpleNamespace(id=resp.json()["package"]["id"])


async def _granted_purchase(client, w):
    resp = await client.post(
        f"{API}/admin/users/{w.member.id}/complimentary-hours",
        params=w.params,
        json={"hours": "2", "package_id": str(w.package.id), "reason": "Oferta"},
        headers=w.headers,
    )
    assert resp.status_code == 201, resp.text
    w.granted_id = resp.json()["purchase"]["id"].replace("-", "")
    w.granted_uuid = resp.json()["purchase"]["id"]


def _json(method: str, path: Callable, body: Callable | dict | None = None) -> Act:
    async def act(client, w):
        # httpx 0.28: `params=` replaces the URL's own query instead of
        # merging with it, so a `?confirm=` in the path is folded in here.
        url = httpx.URL(path(w))
        kwargs = {"params": {**dict(url.params), **w.params}, "headers": w.headers}
        if body is not None:
            kwargs["json"] = body(w) if callable(body) else body
        return await client.request(method, url.copy_with(query=None), **kwargs)

    return act


async def _upload_room(client, w):
    return await client.post(
        f"{API}/admin/rooms/{w.room.id}/images",
        params=w.params,
        files={"file": ("foto.jpg", _image(), "image/jpeg")},
        headers=w.headers,
    )


async def _upload_space(client, w):
    return await client.post(
        f"{API}/admin/spaces/{w.space.id}/images",
        params=w.params,
        files={"file": ("foto.jpg", _image(), "image/jpeg")},
        headers=w.headers,
    )


SCENARIOS: dict[tuple[str, str], Scenario] = {
    ("POST", f"{API}/admin/spaces"): Scenario(
        _json("POST", lambda w: f"{API}/admin/spaces", {"name": "Novo espaço"})
    ),
    ("PUT", f"{API}/admin/spaces/{{space_id}}"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/spaces/{w.space.id}", {"name": "Renamed"})
    ),
    ("DELETE", f"{API}/admin/spaces/{{space_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/spaces/{w.empty_space.id}?confirm=Empty")
    ),
    ("DELETE", f"{API}/admin/rooms/{{room_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/rooms/{w.spare_room.id}?confirm=Sala+livre"),
        setup=_spare_room,
    ),
    ("DELETE", f"{API}/admin/rooms/{{room_id}}/availability/{{rule_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/rooms/{w.room.id}/availability/{w.rule_id}"),
        setup=_first_rule,
    ),
    ("DELETE", f"{API}/admin/bookings/{{booking_id}}"): Scenario(
        _json(
            "DELETE",
            lambda w: f"{API}/admin/bookings/{w.pending.id}?confirm={w.pending.id.hex[:8]}",
        ),
        setup=_expire_pending,
    ),
    ("POST", f"{API}/admin/users/{{user_id}}/anonymise"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/users/{w.member.id}/anonymise",
            lambda w: {"confirm": w.member.id.hex[:8]},
        )
    ),
    ("DELETE", f"{API}/admin/users/{{user_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/users/{w.fresh.id}?confirm=fresh@test.com"),
        setup=_fresh_user,
    ),
    ("DELETE", f"{API}/admin/users/{{user_id}}/membership"): Scenario(
        _json(
            "DELETE",
            lambda w: f"{API}/admin/users/{w.member.id}/membership?confirm=member-a@test.com",
        )
    ),
    ("DELETE", f"{API}/admin/packages/{{package_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/packages/{w.unsold.id}?confirm=Pack+5"),
        setup=_unsold_package,
    ),
    ("PUT", f"{API}/admin/purchases/{{purchase_id}}"): Scenario(
        _json(
            "PUT",
            lambda w: f"{API}/admin/purchases/{w.purchase.id}",
            {"status": "cancelled", "reason": "Reembolsado fora"},
        )
    ),
    ("DELETE", f"{API}/admin/purchases/{{purchase_id}}"): Scenario(
        _json(
            "DELETE",
            lambda w: f"{API}/admin/purchases/{w.granted_uuid}?confirm={w.granted_id[:8]}",
        ),
        setup=_granted_purchase,
    ),
    ("DELETE", f"{API}/admin/support/requests/{{request_id}}"): Scenario(
        _json(
            "DELETE",
            lambda w: f"{API}/admin/support/requests/{w.request.id}?confirm={w.request.id.hex[:8]}",
        )
    ),
    ("POST", f"{API}/admin/spaces/{{space_id}}/rooms"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/spaces/{w.space.id}/rooms",
            {"name": "Sala nova", "hourly_rate": "12.00"},
        )
    ),
    ("PUT", f"{API}/admin/rooms/{{room_id}}"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/rooms/{w.room.id}", {"capacity": 6})
    ),
    ("POST", f"{API}/admin/rooms/{{room_id}}/duplicate"): Scenario(
        _json("POST", lambda w: f"{API}/admin/rooms/{w.room.id}/duplicate")
    ),
    ("POST", f"{API}/admin/rooms/{{room_id}}/availability/copy-to-all-days"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/rooms/{w.room.id}/availability/copy-to-all-days",
            {"day_of_week": 0},
        )
    ),
    ("POST", f"{API}/admin/users"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/users",
            {"email": "invited@test.com", "name": "Convidada"},
        )
    ),
    ("PUT", f"{API}/admin/users/{{user_id}}"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/users/{w.member.id}", {"name": "Renamed"})
    ),
    ("POST", f"{API}/admin/purchases/{{purchase_id}}/adjust"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/purchases/{w.purchase.id}/adjust",
            {"hours": "1", "reason": "Compensação"},
        )
    ),
    ("PUT", f"{API}/admin/organization"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/organization", {"name": "Org A renamed"})
    ),
    ("POST", f"{API}/admin/rooms/{{room_id}}/availability"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/rooms/{w.room.id}/availability",
            {"rules": [{"day_of_week": 0, "open_time": "09:00:00", "close_time": "18:00:00"}]},
        )
    ),
    ("POST", f"{API}/admin/rooms/{{room_id}}/images"): Scenario(_upload_room),
    ("PUT", f"{API}/admin/rooms/{{room_id}}/images/order"): Scenario(
        _json(
            "PUT",
            lambda w: f"{API}/admin/rooms/{w.room.id}/images/order",
            lambda w: {"order": [w.photo_id]},
        ),
        setup=_room_photo,
    ),
    ("DELETE", f"{API}/admin/rooms/{{room_id}}/images/{{image_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/rooms/{w.room.id}/images/{w.photo_id}"),
        setup=_room_photo,
    ),
    ("POST", f"{API}/admin/spaces/{{space_id}}/images"): Scenario(_upload_space),
    ("PUT", f"{API}/admin/spaces/{{space_id}}/images/order"): Scenario(
        _json(
            "PUT",
            lambda w: f"{API}/admin/spaces/{w.space.id}/images/order",
            lambda w: {"order": [w.photo_id]},
        ),
        setup=_space_photo,
    ),
    ("DELETE", f"{API}/admin/spaces/{{space_id}}/images/{{image_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/spaces/{w.space.id}/images/{w.photo_id}"),
        setup=_space_photo,
    ),
    ("POST", f"{API}/admin/rooms/{{room_id}}/blocks"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/rooms/{w.room.id}/blocks",
            lambda w: {
                "start_time": _monday(2, 9).isoformat(),
                "end_time": _monday(2, 10).isoformat(),
                "reason": "Manutenção",
            },
        )
    ),
    ("PUT", f"{API}/admin/rooms/{{room_id}}/blocks/{{block_id}}"): Scenario(
        _json(
            "PUT",
            lambda w: f"{API}/admin/rooms/{w.room.id}/blocks/{w.block_id}",
            {"reason": "Obras"},
        ),
        setup=_block,
    ),
    ("DELETE", f"{API}/admin/rooms/{{room_id}}/blocks/{{block_id}}"): Scenario(
        _json("DELETE", lambda w: f"{API}/admin/rooms/{w.room.id}/blocks/{w.block_id}"),
        setup=_block,
    ),
    ("PUT", f"{API}/admin/bookings/{{booking_id}}"): Scenario(
        _json(
            "PUT", lambda w: f"{API}/admin/bookings/{w.booking.id}", {"admin_note": "Pediu recibo"}
        )
    ),
    ("POST", f"{API}/admin/bookings"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/bookings",
            lambda w: {
                "user_id": str(w.member.id),
                "room_id": str(w.room.id),
                "start_time": _monday(2, 15).isoformat(),
                "end_time": _monday(2, 16).isoformat(),
            },
        )
    ),
    ("POST", f"{API}/admin/bookings/{{booking_id}}/mark-paid"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/bookings/{w.pending.id}/mark-paid",
            {"reason": "Pagou em dinheiro"},
        )
    ),
    ("PUT", f"{API}/admin/users/{{user_id}}/role"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/users/{w.member.id}/role", {"role": "admin"})
    ),
    ("POST", f"{API}/admin/users/{{user_id}}/password-reset"): Scenario(
        _json("POST", lambda w: f"{API}/admin/users/{w.member.id}/password-reset")
    ),
    ("POST", f"{API}/admin/users/{{user_id}}/set-password"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/users/{w.member.id}/set-password",
            {"password": "definida123"},
        )
    ),
    ("POST", f"{API}/admin/users/{{user_id}}/complimentary-hours"): Scenario(
        _json(
            "POST",
            lambda w: f"{API}/admin/users/{w.member.id}/complimentary-hours",
            lambda w: {"hours": "2", "package_id": str(w.package.id), "reason": "Oferta"},
        )
    ),
    ("PUT", f"{API}/admin/purchases/{{purchase_id}}/expiry"): Scenario(
        _json(
            "PUT",
            lambda w: f"{API}/admin/purchases/{w.purchase.id}/expiry",
            lambda w: {
                "expires_at": (datetime.now(tz=UTC) + timedelta(days=800)).isoformat(),
                "reason": "Prolongado",
            },
        )
    ),
    ("POST", f"{API}/admin/packages"): Scenario(
        _json(
            "POST", lambda w: f"{API}/admin/packages", {"name": "Pack 5", "hours": 5, "price": "50"}
        )
    ),
    ("PUT", f"{API}/admin/packages/{{package_id}}"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/packages/{w.package.id}", {"price": "90.00"})
    ),
    ("PUT", f"{API}/admin/support/requests/{{request_id}}"): Scenario(
        _json("PUT", lambda w: f"{API}/admin/support/requests/{w.request.id}", {"status": "closed"})
    ),
}


def _mutation_routes() -> set[tuple[str, str]]:
    found = set()
    for route in iter_api_routes(app.routes):
        for method in (route.methods or set()) & MUTATING:
            if ROUTES.get((method, route.path or "")) == OPERATOR:
                found.add((method, route.path or ""))
    return found


class TestEveryAdminMutationIsAudited:
    def test_every_admin_mutation_route_has_a_scenario(self):
        # The safety net: an operator route that can change something and has
        # no happy-path call here has no proof that it writes its row.
        missing = sorted(_mutation_routes() - set(SCENARIOS))
        stale = sorted(set(SCENARIOS) - _mutation_routes())
        assert not missing, f"Admin mutation routes without an audit scenario: {missing}"
        assert not stale, f"SCENARIOS lists routes that no longer exist: {stale}"

    @pytest.mark.parametrize(("method", "path"), sorted(SCENARIOS))
    async def test_the_call_succeeds_and_writes_exactly_one_row(
        self, client, db_session, w, emails, locks, payments, method, path
    ):
        scenario = SCENARIOS[(method, path)]
        if scenario.setup is not None:
            await scenario.setup(client, w)
        before = await _count(db_session)
        resp = await scenario.act(client, w)
        assert 200 <= resp.status_code < 300, f"{method} {path} -> {resp.status_code} {resp.text}"
        assert await _count(db_session) == before + 1, f"{method} {path}"
        row = (await _rows(db_session, w.org.id))[0]
        assert row.actor_user_id == w.admin.id
        assert row.entity_type in audit.ENTITY_TYPES
        assert row.action
        assert row.request_id == resp.headers["X-Request-ID"]


class TestWhatARowHolds:
    async def test_an_edit_keeps_only_the_changed_keys_and_the_id(self, client, db_session, w):
        resp = await client.put(
            f"{API}/admin/rooms/{w.room.id}",
            params=w.params,
            json={"capacity": 9},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text
        row = (await _rows(db_session, w.org.id))[0]
        assert (row.entity_type, row.entity_id, row.action) == ("room", w.room.id, "update")
        assert row.before == {"id": str(w.room.id), "capacity": 4}
        assert row.after == {"id": str(w.room.id), "capacity": 9}
        assert row.reason is None

    async def test_a_create_keeps_the_whole_snapshot_and_a_reason_when_given(
        self, client, db_session, w
    ):
        resp = await client.post(
            f"{API}/admin/users/{w.member.id}/complimentary-hours",
            params=w.params,
            json={"hours": "3", "package_id": str(w.package.id), "reason": "Cortesia"},
            headers=w.headers,
        )
        assert resp.status_code == 201, resp.text
        row = (await _rows(db_session, w.org.id))[0]
        assert row.entity_type == "purchase"
        assert row.before is None
        assert row.after["hours_total"] == "3.00"
        assert row.after["amount_paid"] == "0.00"
        assert row.reason == "Cortesia"

    async def test_the_request_id_header_is_honoured_when_well_formed(self, client, w):
        resp = await client.put(
            f"{API}/admin/rooms/{w.room.id}",
            params=w.params,
            json={"capacity": 5},
            headers={**w.headers, "X-Request-ID": "proxy-abc.123"},
        )
        assert resp.headers["X-Request-ID"] == "proxy-abc.123"
        resp = await client.put(
            f"{API}/admin/rooms/{w.room.id}",
            params=w.params,
            json={"capacity": 6},
            headers={**w.headers, "X-Request-ID": "not ok: spaces and <tags>"},
        )
        assert resp.headers["X-Request-ID"] != "not ok: spaces and <tags>"
        assert len(resp.headers["X-Request-ID"]) == 32

    def test_a_user_snapshot_never_carries_a_secret(self, w):
        # The negative test: the public schema is the only way into a row.
        user = w.admin
        user.password_hash = "$argon2id$v=19$m=65536,t=3,p=4$secret"
        snap = audit.snapshot(user)
        assert set(snap) == {"id", "email", "name", "avatar_url", "disabled_at", "created_at"}
        flat = " ".join(f"{k}={v}" for k, v in snap.items()).lower()
        for needle in ("password", "hash", "token", "argon2", "version"):
            assert needle not in flat

    def test_diff_is_symmetric_and_ignores_updated_at(self):
        before = {"id": "x", "name": "a", "capacity": 4, "updated_at": "t1"}
        after = {"id": "x", "name": "b", "capacity": 4, "updated_at": "t2"}
        assert audit.diff(before, after) == ({"id": "x", "name": "a"}, {"id": "x", "name": "b"})
        assert audit.diff(None, after) == (None, after)
        assert audit.diff(before, None) == (before, None)

    async def test_a_rolled_back_transaction_writes_nothing(self, session_factory, w):
        async with session_factory() as session:
            await audit.record(
                session,
                actor=w.admin,
                org_id=w.org.id,
                entity=w.room,
                action="update",
                before={"id": str(w.room.id), "capacity": 4},
                after={"id": str(w.room.id), "capacity": 5},
            )
            assert await _count(session) == 1
            await session.rollback()
        async with session_factory() as session:
            assert await _count(session) == 0


class TestReading:
    async def _seed(self, client, w):
        # Three actions on two entities, in a known order.
        for capacity in (5, 6):
            resp = await client.put(
                f"{API}/admin/rooms/{w.room.id}",
                params=w.params,
                json={"capacity": capacity},
                headers=w.headers,
            )
            assert resp.status_code == 200, resp.text
        resp = await client.put(
            f"{API}/admin/spaces/{w.space.id}",
            params=w.params,
            json={"name": "Space A2"},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text

    async def test_the_trail_lists_the_orgs_actions_newest_first_with_the_actor(self, client, w):
        await self._seed(client, w)
        resp = await client.get(f"{API}/admin/audit", params=w.params, headers=w.headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert (body["total"], body["page"], body["page_size"]) == (3, 1, 20)
        actions = body["actions"]
        assert [a["entity_type"] for a in actions] == ["space", "room", "room"]
        assert actions[0]["actor"] == {
            "id": str(w.admin.id),
            "name": "Admin A",
            "email": "admin-a@test.com",
        }
        assert actions[1]["after"] == {"id": str(w.room.id), "capacity": 6}
        assert actions[1]["before"] == {"id": str(w.room.id), "capacity": 5}
        assert actions[0]["request_id"]

    async def test_filters_and_paging(self, client, w):
        await self._seed(client, w)
        room = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "entity_type": "room"},
            headers=w.headers,
        )
        assert [a["entity_id"] for a in room.json()["actions"]] == [str(w.room.id)] * 2
        by_id = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "entity_type": "space", "entity_id": str(w.space.id)},
            headers=w.headers,
        )
        assert by_id.json()["total"] == 1
        nobody = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "actor": str(w.member.id)},
            headers=w.headers,
        )
        assert nobody.json()["total"] == 0
        future = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "from": (datetime.now(tz=UTC) + timedelta(days=1)).isoformat()},
            headers=w.headers,
        )
        assert future.json()["total"] == 0
        page2 = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "page": 2, "page_size": 2},
            headers=w.headers,
        )
        assert page2.json()["total"] == 3
        assert len(page2.json()["actions"]) == 1
        bad = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "entity_type": "not-a-thing"},
            headers=w.headers,
        )
        assert bad.status_code == 422
        naive = await client.get(
            f"{API}/admin/audit",
            params={**w.params, "from": "2026-09-30T10:00:00"},
            headers=w.headers,
        )
        assert naive.status_code == 422

    async def test_history_of_one_entity_and_nothing_across_tenants(self, client, w):
        await self._seed(client, w)
        history = await client.get(
            f"{API}/admin/rooms/{w.room.id}/history", params=w.params, headers=w.headers
        )
        assert history.status_code == 200, history.text
        assert history.json()["total"] == 2
        assert {a["entity_id"] for a in history.json()["actions"]} == {str(w.room.id)}
        # B's operator sees none of it: the trail is empty for B, and A's room
        # does not exist for them.
        other = _headers(w.other_admin, "owner")
        listed = await client.get(
            f"{API}/admin/audit", params={"org_id": str(w.other_org.id)}, headers=other
        )
        assert listed.json()["total"] == 0
        foreign = await client.get(
            f"{API}/admin/rooms/{w.room.id}/history",
            params={"org_id": str(w.other_org.id)},
            headers=other,
        )
        assert foreign.status_code == 404
        claimed = await client.get(f"{API}/admin/audit", params=w.params, headers=other)
        assert claimed.status_code == 403

    async def test_a_member_cannot_read_the_trail(self, client, w):
        resp = await client.get(
            f"{API}/admin/audit", params=w.params, headers=_headers(w.member, "member")
        )
        assert resp.status_code == 403
