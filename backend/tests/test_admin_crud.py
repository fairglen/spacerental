"""G04: the admin endpoints the CRUD matrix lacked.

Detail reads, the room duplicate and copy-to-all-days, the bookings list
filters and the price override, admin-created users and their edits,
purchases list/detail/adjust, the support detail and triage status, and the
organisation settings. Every route is tenant-scoped and audited (the audit
scenario table in test_audit.py covers the "exactly one row" rule).
"""

import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.auth import verify_password
from app.models.audit import AdminAction
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import BookingPackageDebit, PurchaseStatus, UserPackagePurchase
from app.models.space import AvailabilityRule
from app.models.support import SupportRequest
from app.models.user import User
from sqlalchemy import func, select

from tests.test_audit import API, _headers, _monday, w  # noqa: F401 — the fixture


async def _last_action(db_session, org_id) -> AdminAction:
    return (
        await db_session.execute(
            select(AdminAction)
            .where(AdminAction.org_id == org_id)
            .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
            .limit(1)
        )
    ).scalar_one()


class TestSpaceDetail:
    async def test_the_detail_carries_rooms_with_rules_photo_count_and_booking_counts(
        self, client, w
    ):
        resp = await client.get(
            f"{API}/admin/spaces/{w.space.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["space"]["id"] == str(w.space.id)
        rooms = body["space"]["rooms"]
        assert [r["name"] for r in rooms] == ["Sala A"]
        assert len(rooms[0]["availability_rules"]) == 6
        assert body["photo_count"] == 0
        assert body["bookings"] == {"total": 2, "upcoming": 2}

    async def test_another_orgs_space_is_a_404(self, client, w):
        resp = await client.get(
            f"{API}/admin/spaces/{w.other_space.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 404


class TestRoom:
    async def test_the_detail_carries_rules_the_next_30_days_of_blocks_and_counts(self, client, w):
        far = _monday(6, 9)
        for start in (_monday(1, 9), far):
            resp = await client.post(
                f"{API}/admin/rooms/{w.room.id}/blocks",
                params=w.params,
                json={
                    "start_time": start.isoformat(),
                    "end_time": (start + timedelta(hours=1)).isoformat(),
                    "reason": "Obras",
                },
                headers=w.headers,
            )
            assert resp.status_code == 201, resp.text
        resp = await client.get(
            f"{API}/admin/rooms/{w.room.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["room"]["name"] == "Sala A"
        assert body["space"]["id"] == str(w.space.id)
        assert len(body["rules"]) == 6 and "id" in body["rules"][0]
        assert [b["reason"] for b in body["blocks"]] == ["Obras"]
        assert body["photo_count"] == 0
        assert body["bookings"] == {"total": 2, "upcoming": 2}

    async def test_duplicate_copies_rules_and_fields_but_not_photos(self, client, db_session, w):
        w.room.description = "Sala luminosa"
        w.room.amenities = ["wifi", "sofá"]
        w.room.photos = [
            {"id": str(uuid.uuid4()), "key": "x", "thumb_key": "y", "width": 1, "height": 1}
        ]
        await db_session.commit()
        resp = await client.post(
            f"{API}/admin/rooms/{w.room.id}/duplicate", params=w.params, headers=w.headers
        )
        assert resp.status_code == 201, resp.text
        copy = resp.json()["room"]
        assert copy["id"] != str(w.room.id)
        assert copy["name"] == "Sala A (cópia)"
        assert copy["description"] == "Sala luminosa"
        assert copy["capacity"] == 4
        assert copy["hourly_rate"] == "11.00"
        assert copy["amenities"] == ["wifi", "sofá"]
        assert copy["photos"] == []
        assert copy["space_id"] == str(w.space.id)
        rules = (
            (
                await db_session.execute(
                    select(AvailabilityRule).where(
                        AvailabilityRule.room_id == uuid.UUID(copy["id"])
                    )
                )
            )
            .scalars()
            .all()
        )
        assert sorted(r.day_of_week for r in rules) == [0, 1, 2, 3, 4, 5]
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.entity_id, action.action) == (
            "room",
            uuid.UUID(copy["id"]),
            "duplicate",
        )
        assert action.after["name"] == "Sala A (cópia)"

    async def test_copy_to_all_days_replaces_every_other_weekday_with_that_days_window(
        self, client, db_session, w
    ):
        # Monday becomes 10-14; copying Monday makes every day 10-14.
        rules = (
            (
                await db_session.execute(
                    select(AvailabilityRule).where(AvailabilityRule.room_id == w.room.id)
                )
            )
            .scalars()
            .all()
        )
        monday = next(r for r in rules if r.day_of_week == 0)
        monday.open_time = datetime.strptime("10:00", "%H:%M").time()  # noqa: DTZ007
        monday.close_time = datetime.strptime("14:00", "%H:%M").time()  # noqa: DTZ007
        await db_session.commit()
        resp = await client.post(
            f"{API}/admin/rooms/{w.room.id}/availability/copy-to-all-days",
            params=w.params,
            json={"day_of_week": 0},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text
        out = resp.json()["rules"]
        assert sorted(r["day_of_week"] for r in out) == [0, 1, 2, 3, 4, 5, 6]
        assert {(r["open_time"], r["close_time"]) for r in out} == {("10:00:00", "14:00:00")}
        action = await _last_action(db_session, w.org.id)
        assert action.action == "availability.set"
        assert len(action.before["rules"]) == 6 and len(action.after["rules"]) == 7
        # A closed source day: 422, nothing to copy.
        await client.delete(
            f"{API}/admin/rooms/{w.room.id}/availability/{out[6]['id']}",
            params=w.params,
            headers=w.headers,
        )
        closed = await client.post(
            f"{API}/admin/rooms/{w.room.id}/availability/copy-to-all-days",
            params=w.params,
            json={"day_of_week": 6},
            headers=w.headers,
        )
        assert closed.status_code == 422


class TestBookings:
    async def test_the_detail_carries_everything_the_sheet_needs_and_its_history(
        self, client, db_session, w, locks
    ):
        db_session.add(
            BookingPackageDebit(
                org_id=w.org.id,
                booking_id=w.booking.id,
                purchase_id=w.purchase.id,
                hours=Decimal("1.00"),
            )
        )
        w.booking.stripe_checkout_session_id = "cs_test_123"
        w.booking.notes = "Preciso de projetor"
        await db_session.commit()
        noted = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"admin_note": "Confirmado por telefone"},
            headers=w.headers,
        )
        assert noted.status_code == 200
        resp = await client.get(
            f"{API}/admin/bookings/{w.booking.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        booking = body["booking"]
        assert booking["user"]["email"] == "member-a@test.com"
        assert booking["room"]["name"] == "Sala A"
        assert booking["payment_method"] == "hourly"
        assert booking["total_amount"] == "11.00"
        assert booking["package_debits"][0]["purchase_id"] == str(w.purchase.id)
        assert booking["notes"] == "Preciso de projetor"
        assert booking["admin_note"] == "Confirmado por telefone"
        assert booking["stripe_checkout_session_id"] == "cs_test_123"
        assert "access_code" in booking
        assert [a["action"] for a in body["history"]] == ["update"]

    async def test_a_customer_response_never_carries_the_stripe_id(self, client, db_session, w):
        w.booking.stripe_checkout_session_id = "cs_test_123"
        await db_session.commit()
        mine = await client.get(f"{API}/bookings/me", headers=_headers(w.member, "member"))
        assert mine.status_code == 200
        assert "stripe_checkout_session_id" not in mine.json()["bookings"][0]

    async def test_list_search_filters_sort_and_include_cancelled(self, client, db_session, w):
        other = User(email="zed@test.com", name="Zed Zorro", password_hash="x")
        db_session.add(other)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=w.org.id, user_id=other.id, role=MemberRole.member)
        )
        start = _monday(2, 12)
        cancelled = Booking(
            org_id=w.org.id,
            room_id=w.room.id,
            user_id=other.id,
            start_time=start,
            end_time=start + timedelta(hours=1),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            status=BookingStatus.cancelled,
            payment_method=PaymentMethod.package,
        )
        db_session.add(cancelled)
        await db_session.commit()

        async def ids(**params):
            resp = await client.get(
                f"{API}/admin/bookings", params={**w.params, **params}, headers=w.headers
            )
            assert resp.status_code == 200, resp.text
            return [b["id"] for b in resp.json()["bookings"]]

        assert len(await ids()) == 3
        assert await ids(q="zed") == [str(cancelled.id)]
        assert await ids(q="Zorro") == [str(cancelled.id)]
        assert await ids(q=w.booking.id.hex[:8]) == [str(w.booking.id)]
        assert await ids(payment_method="package") == [str(cancelled.id)]
        assert set(await ids(include_cancelled="false")) == {str(w.booking.id), str(w.pending.id)}
        # TIMESTAMPTZ filters take aware instants only (review on #65).
        naive = await client.get(
            f"{API}/admin/bookings",
            params={**w.params, "from": "2026-09-30T10:00:00"},
            headers=w.headers,
        )
        assert naive.status_code == 422, naive.text
        assert await ids(sort="start_time") == [
            str(w.booking.id),
            str(w.pending.id),
            str(cancelled.id),
        ]
        assert await ids(sort="-start_time") == [
            str(cancelled.id),
            str(w.pending.id),
            str(w.booking.id),
        ]
        by_created = await ids(sort="created_at")
        assert set(by_created) == {str(w.booking.id), str(w.pending.id), str(cancelled.id)}
        bad = await client.get(
            f"{API}/admin/bookings", params={**w.params, "sort": "price"}, headers=w.headers
        )
        assert bad.status_code == 422

    async def test_the_price_override_needs_a_reason_moves_no_money_and_is_audited(
        self, client, db_session, w, payments
    ):
        no_reason = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"total_amount": "9.00"},
            headers=w.headers,
        )
        assert no_reason.status_code == 422
        resp = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"total_amount": "9.00", "reason": "Desconto de fidelidade", "notes": "n"},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["booking"]["total_amount"] == "9.00"
        assert resp.json()["booking"]["notes"] == "n"
        assert payments.created_sessions == [] if hasattr(payments, "created_sessions") else True
        action = await _last_action(db_session, w.org.id)
        assert (action.action, action.reason) == ("price.override", "Desconto de fidelidade")
        assert action.before["total_amount"] == "11.00"
        assert action.after["total_amount"] == "9.00"
        # The customer sees the new amount.
        mine = await client.get(f"{API}/bookings/me", headers=_headers(w.member, "member"))
        amounts = {b["id"]: b["total_amount"] for b in mine.json()["bookings"]}
        assert amounts[str(w.booking.id)] == "9.00"
        negative = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"total_amount": "-1", "reason": "x"},
            headers=w.headers,
        )
        assert negative.status_code == 422

    async def test_status_can_go_to_completed_and_back(self, client, db_session, w, emails, locks):
        done = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"status": "completed"},
            headers=w.headers,
        )
        assert done.status_code == 200, done.text
        assert done.json()["booking"]["status"] == "completed"
        back = await client.put(
            f"{API}/admin/bookings/{w.booking.id}",
            params=w.params,
            json={"status": "confirmed"},
            headers=w.headers,
        )
        assert back.status_code == 200, back.text
        assert back.json()["booking"]["status"] == "confirmed"


class TestUsers:
    async def test_create_without_a_password_sends_the_set_password_link(
        self, client, db_session, w, emails
    ):
        resp = await client.post(
            f"{API}/admin/users",
            params=w.params,
            json={"name": "Nova Cliente", "email": "nova@test.com"},
            headers=w.headers,
        )
        assert resp.status_code == 201, resp.text
        user = resp.json()["user"]
        assert user["email"] == "nova@test.com"
        assert user["role"] == "member"
        assert "password" not in resp.text.lower()
        assert len(emails.sent) == 1
        assert emails.sent[0].to == "nova@test.com"
        assert "Defina a sua password" in emails.sent[0].subject
        link = re.search(r"https?://\S+/reset-password/(\S+)", emails.sent[0].text_body)
        assert link
        confirm = await client.post(
            f"{API}/auth/password-reset/confirm",
            json={"token": link.group(1), "password": "escolhida123"},
        )
        assert confirm.status_code == 200, confirm.text
        login = await client.post(
            f"{API}/auth/login", json={"email": "nova@test.com", "password": "escolhida123"}
        )
        assert login.status_code == 200
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("user", "create")
        duplicate = await client.post(
            f"{API}/admin/users",
            params=w.params,
            json={"name": "Outra", "email": "NOVA@test.com"},
            headers=w.headers,
        )
        assert duplicate.status_code == 409

    async def test_create_with_a_password_sends_nothing(self, client, db_session, w, emails):
        resp = await client.post(
            f"{API}/admin/users",
            params=w.params,
            json={"name": "Com Pass", "email": "compass@test.com", "password": "definida123"},
            headers=w.headers,
        )
        assert resp.status_code == 201, resp.text
        assert emails.sent == []
        user = await db_session.scalar(select(User).where(User.email == "compass@test.com"))
        assert verify_password("definida123", user.password_hash)
        blob = str(
            (
                await db_session.execute(
                    select(AdminAction.after).where(AdminAction.entity_id == user.id)
                )
            ).scalar_one()
        )
        assert "definida123" not in blob and "password" not in blob.lower()

    async def test_update_name_email_and_suspension(self, client, db_session, w):
        member_headers = _headers(w.member, "member")
        assert (await client.get(f"{API}/auth/me", headers=member_headers)).status_code == 200
        resp = await client.put(
            f"{API}/admin/users/{w.member.id}",
            params=w.params,
            json={"name": "Renamed", "email": "renamed@test.com"},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text
        assert (resp.json()["user"]["name"], resp.json()["user"]["email"]) == (
            "Renamed",
            "renamed@test.com",
        )
        taken = await client.put(
            f"{API}/admin/users/{w.member.id}",
            params=w.params,
            json={"email": "admin-a@test.com"},
            headers=w.headers,
        )
        assert taken.status_code == 409
        suspended = await client.put(
            f"{API}/admin/users/{w.member.id}",
            params=w.params,
            json={"disabled_at": datetime.now(tz=UTC).isoformat()},
            headers=w.headers,
        )
        assert suspended.status_code == 200, suspended.text
        assert suspended.json()["user"]["disabled_at"]
        assert (await client.get(f"{API}/auth/me", headers=member_headers)).status_code == 401
        login = await client.post(
            f"{API}/auth/login", json={"email": "renamed@test.com", "password": "password123"}
        )
        assert login.status_code == 401
        assert login.json()["detail"] == "A conta está desativada."
        action = await _last_action(db_session, w.org.id)
        assert action.action == "suspend"
        back = await client.put(
            f"{API}/admin/users/{w.member.id}",
            params=w.params,
            json={"disabled_at": None},
            headers=w.headers,
        )
        assert back.status_code == 200, back.text
        assert back.json()["user"]["disabled_at"] is None
        login = await client.post(
            f"{API}/auth/login", json={"email": "renamed@test.com", "password": "password123"}
        )
        assert login.status_code == 200
        me = await client.put(
            f"{API}/admin/users/{w.admin.id}",
            params=w.params,
            json={"disabled_at": datetime.now(tz=UTC).isoformat()},
            headers=w.headers,
        )
        assert me.status_code == 409

    async def test_global_edits_are_refused_for_a_member_of_another_organisation(
        self, client, db_session, w
    ):
        # The account is shared with org B: A's operator cannot rename it,
        # re-address it, suspend it or set its password.
        db_session.add(
            OrganizationMember(org_id=w.other_org.id, user_id=w.member.id, role=MemberRole.member)
        )
        await db_session.commit()
        for body in (
            {"name": "X"},
            {"email": "x@test.com"},
            {"disabled_at": datetime.now(tz=UTC).isoformat()},
        ):
            resp = await client.put(
                f"{API}/admin/users/{w.member.id}", params=w.params, json=body, headers=w.headers
            )
            assert resp.status_code == 409, resp.text
        pw = await client.post(
            f"{API}/admin/users/{w.member.id}/set-password",
            params=w.params,
            json={"password": "definida123"},
            headers=w.headers,
        )
        assert pw.status_code == 409
        user = await db_session.get(User, w.member.id)
        await db_session.refresh(user)
        assert (user.name, user.email, user.disabled_at, user.token_version) == (
            "Member A",
            "member-a@test.com",
            None,
            0,
        )

    async def test_list_filters_and_sort(self, client, db_session, w):
        w.member.disabled_at = datetime.now(tz=UTC)
        await db_session.commit()

        async def emails_of(**params):
            resp = await client.get(
                f"{API}/admin/users", params={**w.params, **params}, headers=w.headers
            )
            assert resp.status_code == 200, resp.text
            return [u["email"] for u in resp.json()["users"]]

        assert await emails_of(role="owner") == ["admin-a@test.com"]
        assert await emails_of(disabled="true") == ["member-a@test.com"]
        assert await emails_of(disabled="false") == ["admin-a@test.com"]
        assert await emails_of(sort="-name") == ["member-a@test.com", "admin-a@test.com"]
        assert await emails_of(sort="joined_at") == ["admin-a@test.com", "member-a@test.com"]
        listed = await client.get(f"{API}/admin/users", params=w.params, headers=w.headers)
        assert {u["disabled_at"] is not None for u in listed.json()["users"]} == {True, False}


class TestPackages:
    async def test_the_detail_counts_purchases_and_outstanding_hours(self, client, db_session, w):
        resp = await client.get(
            f"{API}/admin/packages/{w.package.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["package"]["name"] == "Pack 10"
        assert body["purchases"] == {"total": 1, "active": 1}
        assert body["hours_outstanding"] == "10.00"
        # A used-up purchase is not "active" in the spendable sense.
        w.purchase.hours_remaining = Decimal("0.00")
        w.purchase.hours_used = Decimal("10.00")
        await db_session.commit()
        resp = await client.get(
            f"{API}/admin/packages/{w.package.id}", params=w.params, headers=w.headers
        )
        assert resp.json()["purchases"] == {"total": 1, "active": 0}
        assert resp.json()["hours_outstanding"] == "0.00"


class TestPurchases:
    async def test_list_with_filters_and_the_detail_with_debits(self, client, db_session, w):
        db_session.add(
            BookingPackageDebit(
                org_id=w.org.id,
                booking_id=w.booking.id,
                purchase_id=w.purchase.id,
                hours=Decimal("1.00"),
            )
        )
        w.purchase.hours_remaining = Decimal("9.00")
        w.purchase.hours_used = Decimal("1.00")
        soon = UserPackagePurchase(
            user_id=w.member.id,
            package_id=w.package.id,
            org_id=w.org.id,
            hours_total=Decimal("2.00"),
            hours_used=Decimal("0.00"),
            hours_remaining=Decimal("2.00"),
            amount_paid=Decimal("0.00"),
            status=PurchaseStatus.cancelled,
            purchased_at=datetime.now(tz=UTC),
            expires_at=datetime.now(tz=UTC) + timedelta(days=3),
        )
        db_session.add(soon)
        await db_session.commit()

        async def ids(**params):
            resp = await client.get(
                f"{API}/admin/purchases", params={**w.params, **params}, headers=w.headers
            )
            assert resp.status_code == 200, resp.text
            return [p["id"] for p in resp.json()["purchases"]]

        assert set(await ids()) == {str(w.purchase.id), str(soon.id)}
        assert await ids(status="cancelled") == [str(soon.id)]
        assert await ids(user_id=str(w.member.id), status="active") == [str(w.purchase.id)]
        assert await ids(package_id=str(uuid.uuid4())) == []
        cutoff = (datetime.now(tz=UTC) + timedelta(days=30)).isoformat()
        assert await ids(expiring_before=cutoff) == [str(soon.id)]
        naive = await client.get(
            f"{API}/admin/purchases",
            params={**w.params, "expiring_before": "2026-09-30T10:00:00"},
            headers=w.headers,
        )
        assert naive.status_code == 422
        listed = await client.get(f"{API}/admin/purchases", params=w.params, headers=w.headers)
        assert listed.json()["total"] == 2
        assert listed.json()["purchases"][0]["user"]["email"] == "member-a@test.com"

        detail = await client.get(
            f"{API}/admin/purchases/{w.purchase.id}", params=w.params, headers=w.headers
        )
        assert detail.status_code == 200, detail.text
        body = detail.json()
        assert body["purchase"]["hours_remaining"] == "9.00"
        assert body["user"]["id"] == str(w.member.id)
        assert [d["booking_id"] for d in body["debits"]] == [str(w.booking.id)]
        assert body["debits"][0]["hours"] == "1.00"
        assert body["debits"][0]["room_name"] == "Sala A"
        foreign = await client.get(
            f"{API}/admin/purchases/{w.purchase.id}",
            params={"org_id": str(w.other_org.id)},
            headers=_headers(w.other_admin, "owner"),
        )
        assert foreign.status_code == 404

    async def test_adjust_moves_the_balance_both_ways_but_never_below_the_debited_hours(
        self, client, db_session, w
    ):
        db_session.add(
            BookingPackageDebit(
                org_id=w.org.id,
                booking_id=w.booking.id,
                purchase_id=w.purchase.id,
                hours=Decimal("4.00"),
            )
        )
        w.purchase.hours_remaining = Decimal("6.00")
        w.purchase.hours_used = Decimal("4.00")
        await db_session.commit()
        up = await client.post(
            f"{API}/admin/purchases/{w.purchase.id}/adjust",
            params=w.params,
            json={"hours": "2", "reason": "Compensação"},
            headers=w.headers,
        )
        assert up.status_code == 200, up.text
        assert (up.json()["purchase"]["hours_total"], up.json()["purchase"]["hours_remaining"]) == (
            "12.00",
            "8.00",
        )
        down = await client.post(
            f"{API}/admin/purchases/{w.purchase.id}/adjust",
            params=w.params,
            json={"hours": "-8", "reason": "Erro no registo"},
            headers=w.headers,
        )
        assert down.status_code == 200, down.text
        assert (
            down.json()["purchase"]["hours_total"],
            down.json()["purchase"]["hours_remaining"],
        ) == ("4.00", "0.00")
        too_far = await client.post(
            f"{API}/admin/purchases/{w.purchase.id}/adjust",
            params=w.params,
            json={"hours": "-1", "reason": "x"},
            headers=w.headers,
        )
        assert too_far.status_code == 409, too_far.text
        detail = too_far.json()["detail"]
        assert detail["blockers"][0]["booking_id"] == str(w.booking.id)
        assert detail["blockers"][0]["hours"] == "4.00"
        for body in ({"hours": "0", "reason": "x"}, {"hours": "1"}):
            resp = await client.post(
                f"{API}/admin/purchases/{w.purchase.id}/adjust",
                params=w.params,
                json=body,
                headers=w.headers,
            )
            assert resp.status_code == 422
        action = (
            (
                await db_session.execute(
                    select(AdminAction)
                    .where(AdminAction.action == "adjust")
                    .order_by(AdminAction.created_at)
                )
            )
            .scalars()
            .all()
        )
        assert [a.reason for a in action] == ["Compensação", "Erro no registo"]
        assert action[0].before["hours_total"] == "10.00"
        assert action[0].after["hours_total"] == "12.00"


class TestSupport:
    async def test_the_detail_the_triage_status_and_the_note(self, client, db_session, w):
        resp = await client.get(
            f"{API}/admin/support/requests/{w.request.id}", params=w.params, headers=w.headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()["request"]
        assert body["message"].startswith("A sala estava fechada")
        assert body["user"] == {
            "id": str(w.member.id),
            "name": "Member A",
            "email": "member-a@test.com",
        }
        assert body["admin_note"] is None
        assert body["status"] == "new"
        working = await client.put(
            f"{API}/admin/support/requests/{w.request.id}",
            params=w.params,
            json={"status": "in_progress", "admin_note": "Liguei ao cliente"},
            headers=w.headers,
        )
        assert working.status_code == 200, working.text
        assert (working.json()["request"]["status"], working.json()["request"]["admin_note"]) == (
            "in_progress",
            "Liguei ao cliente",
        )
        listed = await client.get(
            f"{API}/admin/support/requests",
            params={**w.params, "status": "in_progress"},
            headers=w.headers,
        )
        assert listed.json()["total"] == 1
        row = await db_session.get(SupportRequest, w.request.id)
        await db_session.refresh(row)
        assert row.admin_note == "Liguei ao cliente"


class TestOrganization:
    async def test_read_and_owner_only_update(self, client, db_session, w):
        resp = await client.get(f"{API}/admin/organization", params=w.params, headers=w.headers)
        assert resp.status_code == 200, resp.text
        org = resp.json()["organization"]
        assert org["slug"] == "org-a"
        assert org["contact_email"] is None
        assert org["timezone"] == "Europe/Lisbon"
        updated = await client.put(
            f"{API}/admin/organization",
            params=w.params,
            json={
                "name": "FlowSpace Lisboa",
                "contact_email": "ola@flowspace.pt",
                "contact_phone": "+351 210 000 000",
                "timezone": "Europe/Lisbon",
            },
            headers=w.headers,
        )
        assert updated.status_code == 200, updated.text
        org = updated.json()["organization"]
        assert (org["name"], org["contact_email"], org["contact_phone"]) == (
            "FlowSpace Lisboa",
            "ola@flowspace.pt",
            "+351 210 000 000",
        )
        assert org["slug"] == "org-a"
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("organization", "update")
        assert action.after["name"] == "FlowSpace Lisboa"
        # An admin (not owner) may read but not write.
        admin2 = User(email="admin2@test.com", name="Admin 2", password_hash="x")
        db_session.add(admin2)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=w.org.id, user_id=admin2.id, role=MemberRole.admin)
        )
        await db_session.commit()
        as_admin = _headers(admin2, "admin")
        assert (
            await client.get(f"{API}/admin/organization", params=w.params, headers=as_admin)
        ).status_code == 200
        forbidden = await client.put(
            f"{API}/admin/organization",
            params=w.params,
            json={"name": "Nope"},
            headers=as_admin,
        )
        assert forbidden.status_code == 403
        bad_tz = await client.put(
            f"{API}/admin/organization",
            params=w.params,
            json={"timezone": "Mars/Olympus"},
            headers=w.headers,
        )
        assert bad_tz.status_code == 422
        cleared = await client.put(
            f"{API}/admin/organization",
            params=w.params,
            json={"contact_phone": None},
            headers=w.headers,
        )
        assert cleared.status_code == 200
        assert cleared.json()["organization"]["contact_phone"] is None
        # The public space detail carries the contact for the customer-facing block.
        public = await client.get(f"{API}/spaces/{w.space.id}")
        assert public.status_code == 200
        assert public.json()["contact"] == {"email": "ola@flowspace.pt", "phone": None}
        assert "settings" not in public.text


async def _count(db_session, model, *where) -> int:
    return await db_session.scalar(select(func.count()).select_from(model).where(*where))
