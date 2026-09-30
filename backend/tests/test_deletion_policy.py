"""G02: deleting money-bearing or history-bearing rows is never a plain DELETE.

Each hard delete is guarded (409 with the blockers), needs `?confirm=` (the
entity's name or short id; 422 otherwise) and leaves one audit row with the
full `before`. A user is anonymised rather than deleted while anything
references them; a purchase is cancelled with a reason; a booking is
cancelled unless it never held money or pack hours.
"""

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.models.audit import AdminAction
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import BookingPackageDebit, Package, PurchaseStatus, UserPackagePurchase
from app.models.password_reset import PasswordResetToken
from app.models.room_block import RoomBlock
from app.models.space import AvailabilityRule, Room, Space
from app.models.support import SupportRequest
from app.models.user import User
from app.payments import CheckoutKind, CheckoutSessionCompletedError
from sqlalchemy import func, select

from tests.test_audit import API, _headers, _monday, w  # noqa: F401 — the fixture


def _short(entity_id: uuid.UUID) -> str:
    return entity_id.hex[:8]


async def _count(db_session, model, *where) -> int:
    return await db_session.scalar(select(func.count()).select_from(model).where(*where))


async def _last_action(db_session, org_id) -> AdminAction:
    return (
        await db_session.execute(
            select(AdminAction)
            .where(AdminAction.org_id == org_id)
            .order_by(AdminAction.created_at.desc(), AdminAction.id.desc())
            .limit(1)
        )
    ).scalar_one()


class TestConfirm:
    async def test_a_hard_delete_without_the_matching_confirm_is_a_422_and_changes_nothing(
        self, client, db_session, w
    ):
        url = f"{API}/admin/spaces/{w.empty_space.id}"
        for params in ({}, {"confirm": "wrong"}, {"confirm": ""}):
            resp = await client.delete(url, params={**w.params, **params}, headers=w.headers)
            assert resp.status_code == 422, resp.text
        assert await _count(db_session, Space, Space.id == w.empty_space.id) == 1
        assert await _count(db_session, AdminAction) == 0

    async def test_the_name_and_the_short_id_both_confirm(self, client, db_session, w):
        by_name = await client.delete(
            f"{API}/admin/spaces/{w.empty_space.id}",
            params={**w.params, "confirm": "Empty"},
            headers=w.headers,
        )
        assert by_name.status_code == 204, by_name.text
        other = Space(org_id=w.org.id, name="Other", timezone="UTC", images=[], amenities=[])
        db_session.add(other)
        await db_session.commit()
        by_id = await client.delete(
            f"{API}/admin/spaces/{other.id}",
            params={**w.params, "confirm": _short(other.id)},
            headers=w.headers,
        )
        assert by_id.status_code == 204, by_id.text


class TestSpace:
    async def test_a_space_whose_rooms_ever_had_a_booking_cannot_be_hard_deleted(
        self, client, db_session, w
    ):
        resp = await client.delete(
            f"{API}/admin/spaces/{w.space.id}",
            params={**w.params, "confirm": "Space A"},
            headers=w.headers,
        )
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["blockers"] == [{"room_id": str(w.room.id), "name": "Sala A", "bookings": 2}]
        assert await _count(db_session, Space, Space.id == w.space.id) == 1
        assert await _count(db_session, AdminAction) == 0

    async def test_a_space_with_only_booking_free_rooms_goes_with_its_rooms_and_rules(
        self, client, db_session, w
    ):
        room = Room(
            space_id=w.empty_space.id,
            org_id=w.org.id,
            name="Sala vazia",
            hourly_rate=Decimal("9.00"),
            images=[],
            amenities=[],
        )
        db_session.add(room)
        await db_session.flush()
        db_session.add(AvailabilityRule(room_id=room.id, day_of_week=0))
        await db_session.commit()
        resp = await client.delete(
            f"{API}/admin/spaces/{w.empty_space.id}",
            params={**w.params, "confirm": "Empty"},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert await _count(db_session, Space, Space.id == w.empty_space.id) == 0
        assert await _count(db_session, Room, Room.id == room.id) == 0
        assert await _count(db_session, AvailabilityRule, AvailabilityRule.room_id == room.id) == 0
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.entity_id, action.action) == (
            "space",
            w.empty_space.id,
            "delete",
        )
        assert action.before["name"] == "Empty"
        assert action.after is None

    async def test_soft_delete_stays_on_put(self, client, db_session, w):
        resp = await client.put(
            f"{API}/admin/spaces/{w.space.id}",
            params=w.params,
            json={"is_active": False},
            headers=w.headers,
        )
        assert resp.status_code == 200
        assert resp.json()["space"]["is_active"] is False


class TestRoom:
    async def test_a_room_with_any_booking_or_block_ever_is_refused_with_the_counts(
        self, client, db_session, w
    ):
        resp = await client.delete(
            f"{API}/admin/rooms/{w.room.id}",
            params={**w.params, "confirm": "Sala A"},
            headers=w.headers,
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["blockers"] == {"bookings": 2, "blocks": 0}
        # A cancelled booking still counts: it is history.
        w.booking.status = BookingStatus.cancelled
        w.pending.status = BookingStatus.expired
        await db_session.commit()
        again = await client.delete(
            f"{API}/admin/rooms/{w.room.id}",
            params={**w.params, "confirm": "Sala A"},
            headers=w.headers,
        )
        assert again.status_code == 409
        assert await _count(db_session, Room, Room.id == w.room.id) == 1

    async def test_a_room_with_nothing_goes_with_its_rules_blocks_and_photo_files(
        self, client, db_session, w, tmp_path
    ):
        room = Room(
            space_id=w.space.id,
            org_id=w.org.id,
            name="Sala nova",
            hourly_rate=Decimal("9.00"),
            images=[],
            amenities=[],
        )
        db_session.add(room)
        await db_session.flush()
        db_session.add(AvailabilityRule(room_id=room.id, day_of_week=2))
        await db_session.commit()
        from tests.test_audit import _image

        uploaded = await client.post(
            f"{API}/admin/rooms/{room.id}/images",
            params=w.params,
            files={"file": ("foto.jpg", _image(), "image/jpeg")},
            headers=w.headers,
        )
        assert uploaded.status_code == 201
        photo = uploaded.json()["room"]["photos"][0]
        import os

        from app.config import settings

        stored = os.path.join(settings.MEDIA_ROOT, *photo["url"].split("/media/")[1].split("/"))
        assert os.path.exists(stored)
        blocked = await client.delete(
            f"{API}/admin/rooms/{room.id}",
            params={**w.params, "confirm": "Sala nova"},
            headers=w.headers,
        )
        assert blocked.status_code == 204, blocked.text
        assert await _count(db_session, Room, Room.id == room.id) == 0
        assert await _count(db_session, AvailabilityRule, AvailabilityRule.room_id == room.id) == 0
        assert not os.path.exists(stored)
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("room", "delete")
        assert action.before["name"] == "Sala nova"

    async def test_a_block_counts_as_history_too(self, client, db_session, w):
        room = Room(
            space_id=w.space.id,
            org_id=w.org.id,
            name="Sala B",
            hourly_rate=Decimal("9.00"),
            images=[],
            amenities=[],
        )
        db_session.add(room)
        await db_session.flush()
        start = _monday(2, 9)
        db_session.add(
            RoomBlock(
                org_id=w.org.id,
                room_id=room.id,
                start_time=start,
                end_time=start + timedelta(hours=1),
                reason="Obras",
            )
        )
        await db_session.commit()
        resp = await client.delete(
            f"{API}/admin/rooms/{room.id}",
            params={**w.params, "confirm": "Sala B"},
            headers=w.headers,
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["blockers"] == {"bookings": 0, "blocks": 1}

    async def test_a_single_availability_rule_can_be_deleted(self, client, db_session, w):
        rules = (
            (
                await db_session.execute(
                    select(AvailabilityRule).where(AvailabilityRule.room_id == w.room.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rules) == 6
        doomed = rules[0]
        resp = await client.delete(
            f"{API}/admin/rooms/{w.room.id}/availability/{doomed.id}",
            params=w.params,
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert (
            await _count(db_session, AvailabilityRule, AvailabilityRule.room_id == w.room.id) == 5
        )
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.entity_id, action.action) == (
            "availability_rule",
            doomed.id,
            "delete",
        )
        assert action.before["day_of_week"] == doomed.day_of_week
        # A rule of another room (another org's) is a 404, even with this room's id.
        other = (
            (
                await db_session.execute(
                    select(AvailabilityRule).where(AvailabilityRule.room_id == w.other_room.id)
                )
            )
            .scalars()
            .first()
        )
        foreign = await client.delete(
            f"{API}/admin/rooms/{w.room.id}/availability/{other.id}",
            params=w.params,
            headers=w.headers,
        )
        assert foreign.status_code == 404
        assert await _count(db_session, AvailabilityRule, AvailabilityRule.id == other.id) == 1


class TestBooking:
    async def test_a_paid_or_pack_booking_must_be_cancelled_instead(self, client, db_session, w):
        # Confirmed hourly (held money), a cancelled one with an amount, a
        # package one: all 409 "cancel instead".
        w.booking.status = BookingStatus.cancelled
        package_booking = Booking(
            org_id=w.org.id,
            room_id=w.room.id,
            user_id=w.member.id,
            start_time=_monday(3, 10),
            end_time=_monday(3, 11),
            duration_hours=Decimal("1.00"),
            total_amount=Decimal("11.00"),
            package_hours_used=Decimal("1.00"),
            status=BookingStatus.confirmed,
            payment_method=PaymentMethod.package,
        )
        db_session.add(package_booking)
        await db_session.commit()
        for booking in (w.booking, w.pending, package_booking):
            resp = await client.delete(
                f"{API}/admin/bookings/{booking.id}",
                params={**w.params, "confirm": _short(booking.id)},
                headers=w.headers,
            )
            assert resp.status_code == 409, resp.text
            assert "cancel" in resp.json()["detail"].lower()
        assert await _count(db_session, Booking, Booking.org_id == w.org.id) == 3
        assert await _count(db_session, AdminAction) == 0

    async def test_an_expired_hold_and_a_zero_cancelled_booking_can_go(self, client, db_session, w):
        w.pending.status = BookingStatus.expired
        w.booking.status = BookingStatus.cancelled
        w.booking.total_amount = Decimal("0.00")
        await db_session.commit()
        for booking in (w.pending, w.booking):
            resp = await client.delete(
                f"{API}/admin/bookings/{booking.id}",
                params={**w.params, "confirm": _short(booking.id)},
                headers=w.headers,
            )
            assert resp.status_code == 204, resp.text
        assert await _count(db_session, Booking, Booking.org_id == w.org.id) == 0
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("booking", "delete")
        assert action.before["status"] == "cancelled"
        assert action.before["total_amount"] == "0.00"

    async def test_a_cancelled_zero_booking_with_debit_rows_stays(self, client, db_session, w):
        w.booking.status = BookingStatus.cancelled
        w.booking.total_amount = Decimal("0.00")
        db_session.add(
            BookingPackageDebit(
                org_id=w.org.id,
                booking_id=w.booking.id,
                purchase_id=w.purchase.id,
                hours=Decimal("1.00"),
            )
        )
        await db_session.commit()
        resp = await client.delete(
            f"{API}/admin/bookings/{w.booking.id}",
            params={**w.params, "confirm": _short(w.booking.id)},
            headers=w.headers,
        )
        assert resp.status_code == 409

    async def test_a_manual_booking_goes_with_a_reason_and_frees_the_slot(
        self, client, db_session, w, locks
    ):
        created = await client.post(
            f"{API}/admin/bookings",
            params=w.params,
            json={
                "user_id": str(w.member.id),
                "room_id": str(w.room.id),
                "start_time": _monday(2, 15).isoformat(),
                "end_time": _monday(2, 16).isoformat(),
            },
            headers=w.headers,
        )
        assert created.status_code == 201, created.text
        booking_id = uuid.UUID(created.json()["booking"]["id"])
        no_reason = await client.delete(
            f"{API}/admin/bookings/{booking_id}",
            params={**w.params, "confirm": _short(booking_id)},
            headers=w.headers,
        )
        assert no_reason.status_code == 422
        resp = await client.delete(
            f"{API}/admin/bookings/{booking_id}",
            params={**w.params, "confirm": _short(booking_id), "reason": "Criada por engano"},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert await _count(db_session, Booking, Booking.id == booking_id) == 0
        assert booking_id in locks.revoked_booking_ids
        action = await _last_action(db_session, w.org.id)
        assert (action.action, action.reason) == ("delete", "Criada por engano")
        assert action.before["payment_method"] == "manual"
        # The slot is bookable again.
        rebooked = await client.post(
            f"{API}/admin/bookings",
            params=w.params,
            json={
                "user_id": str(w.member.id),
                "room_id": str(w.room.id),
                "start_time": _monday(2, 15).isoformat(),
                "end_time": _monday(2, 16).isoformat(),
            },
            headers=w.headers,
        )
        assert rebooked.status_code == 201, rebooked.text


class TestPayableSessions:
    async def test_deleting_an_expired_hold_expires_its_checkout_session_first(
        self, client, db_session, w, payments
    ):
        # A late payment on a deleted row would have no booking to confirm.
        session = await payments.create_checkout_session(
            amount=Decimal("11.00"),
            description="x",
            kind=CheckoutKind.booking,
            reference_id=w.pending.id,
            org_id=w.org.id,
        )
        w.pending.stripe_checkout_session_id = session.id
        w.pending.status = BookingStatus.expired
        await db_session.commit()
        assert session.id in payments.sessions
        resp = await client.delete(
            f"{API}/admin/bookings/{w.pending.id}",
            params={**w.params, "confirm": _short(w.pending.id)},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert session.id not in payments.sessions
        assert await _count(db_session, Booking, Booking.id == w.pending.id) == 0

    async def test_a_session_already_paid_keeps_the_booking(
        self, client, db_session, w, payments, monkeypatch
    ):
        w.pending.stripe_checkout_session_id = "cs_stub_paid"
        w.pending.status = BookingStatus.expired
        await db_session.commit()

        async def completed(session_id):
            raise CheckoutSessionCompletedError(session_id)

        monkeypatch.setattr(payments, "expire_checkout_session", completed)
        resp = await client.delete(
            f"{API}/admin/bookings/{w.pending.id}",
            params={**w.params, "confirm": _short(w.pending.id)},
            headers=w.headers,
        )
        assert resp.status_code == 409
        assert await _count(db_session, Booking, Booking.id == w.pending.id) == 1

    async def test_deleting_a_pending_purchase_expires_its_session_first(
        self, client, db_session, w, payments
    ):
        pending = UserPackagePurchase(
            user_id=w.member.id,
            package_id=w.package.id,
            org_id=w.org.id,
            hours_total=Decimal("10.00"),
            hours_used=Decimal("0.00"),
            hours_remaining=Decimal("10.00"),
            amount_paid=Decimal("0.00"),
            status=PurchaseStatus.pending,
            purchased_at=datetime.now(tz=UTC),
            expires_at=datetime.now(tz=UTC) + timedelta(days=365),
        )
        db_session.add(pending)
        await db_session.flush()
        session = await payments.create_checkout_session(
            amount=Decimal("100.00"),
            description="x",
            kind=CheckoutKind.package_purchase,
            reference_id=pending.id,
            org_id=w.org.id,
        )
        pending.stripe_checkout_session_id = session.id
        await db_session.commit()
        resp = await client.delete(
            f"{API}/admin/purchases/{pending.id}",
            params={**w.params, "confirm": _short(pending.id)},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert session.id not in payments.sessions


class TestUser:
    async def _anonymise(self, client, w, user_id, confirm=None, **extra):
        return await client.post(
            f"{API}/admin/users/{user_id}/anonymise",
            params=w.params,
            json={"confirm": confirm or _short(user_id), **extra},
            headers=w.headers,
        )

    async def test_anonymise_replaces_identity_keeps_history_and_revokes_everything(
        self, client, db_session, w, emails
    ):
        # A live session, an open reset link, a booking and a purchase.
        member_headers = _headers(w.member, "member")
        assert (await client.get(f"{API}/auth/me", headers=member_headers)).status_code == 200
        await client.post(f"{API}/auth/password-reset/request", json={"email": w.member.email})
        assert (
            await _count(db_session, PasswordResetToken, PasswordResetToken.user_id == w.member.id)
            == 1
        )
        old_email = w.member.email

        resp = await self._anonymise(client, w, w.member.id, reason="Pedido RGPD")
        assert resp.status_code == 200, resp.text
        body = resp.json()["user"]
        short = _short(w.member.id)
        assert body["email"] == f"utilizador-{short}@anon.invalid"
        assert body["name"] == "Utilizador removido"
        assert body["disabled_at"]

        user = (
            await db_session.execute(
                select(User).where(User.id == w.member.id).execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert user.email == f"utilizador-{short}@anon.invalid"
        assert user.name == "Utilizador removido"
        assert user.avatar_url is None
        assert user.password_hash is None
        assert user.disabled_at is not None
        assert user.token_version == 1
        assert (
            await _count(db_session, PasswordResetToken, PasswordResetToken.user_id == w.member.id)
            == 0
        )
        assert (
            await _count(db_session, OrganizationMember, OrganizationMember.user_id == w.member.id)
            == 0
        )
        # History stays, attached to the placeholder.
        assert await _count(db_session, Booking, Booking.user_id == w.member.id) == 2
        assert (
            await _count(
                db_session, UserPackagePurchase, UserPackagePurchase.user_id == w.member.id
            )
            == 1
        )
        assert await _count(db_session, SupportRequest, SupportRequest.user_id == w.member.id) == 1
        # Sessions are dead, the old email is nobody's, and no reset goes out.
        assert (await client.get(f"{API}/auth/me", headers=member_headers)).status_code == 401
        login = await client.post(
            f"{API}/auth/login", json={"email": old_email, "password": "password123"}
        )
        assert login.status_code == 401
        emails.sent.clear()
        await client.post(f"{API}/auth/password-reset/request", json={"email": user.email})
        assert emails.sent == []
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.entity_id, action.action) == (
            "user",
            w.member.id,
            "anonymise",
        )
        assert action.reason == "Pedido RGPD"
        assert action.after["email"] == user.email
        # The operator can still read the trail of a person who is gone.
        history = await client.get(
            f"{API}/admin/users/{w.member.id}/history", params=w.params, headers=w.headers
        )
        assert history.status_code == 200
        assert history.json()["total"] == 1
        # The bookings list shows the placeholder.
        listed = await client.get(f"{API}/admin/bookings", params=w.params, headers=w.headers)
        assert {b["user"]["email"] for b in listed.json()["bookings"]} == {user.email}

    async def test_anonymise_refuses_yourself_the_last_owner_and_a_member_of_another_org(
        self, client, db_session, w
    ):
        me = await self._anonymise(client, w, w.admin.id)
        assert me.status_code == 409, me.text
        # A second owner can be anonymised; the last one cannot.
        second = User(email="owner2@test.com", name="Owner 2", password_hash="x")
        db_session.add(second)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=w.org.id, user_id=second.id, role=MemberRole.owner)
        )
        # `member` also belongs to org B.
        db_session.add(
            OrganizationMember(org_id=w.other_org.id, user_id=w.member.id, role=MemberRole.member)
        )
        await db_session.commit()
        dual = await self._anonymise(client, w, w.member.id)
        assert dual.status_code == 409, dual.text
        assert "organisation" in dual.json()["detail"].lower()
        ok = await self._anonymise(client, w, second.id)
        assert ok.status_code == 200, ok.text
        last = await self._anonymise(client, w, w.admin.id)
        assert last.status_code == 409
        wrong = await self._anonymise(client, w, w.member.id, confirm="nope")
        assert wrong.status_code == 422

    async def test_anonymising_someone_from_another_org_is_a_404(self, client, db_session, w):
        resp = await self._anonymise(client, w, w.other_admin.id)
        assert resp.status_code == 404
        user = await db_session.get(User, w.other_admin.id)
        await db_session.refresh(user)
        assert user.email == "admin-b@test.com"

    async def test_hard_delete_only_when_nothing_references_the_user(self, client, db_session, w):
        referenced = await client.delete(
            f"{API}/admin/users/{w.member.id}",
            params={**w.params, "confirm": _short(w.member.id)},
            headers=w.headers,
        )
        assert referenced.status_code == 409, referenced.text
        assert referenced.json()["detail"]["blockers"] == {
            "bookings": 2,
            "purchases": 1,
            "support_requests": 1,
        }
        fresh = User(email="fresh@test.com", name="Fresh", password_hash="x")
        db_session.add(fresh)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=w.org.id, user_id=fresh.id, role=MemberRole.member)
        )
        await db_session.commit()
        gone = await client.delete(
            f"{API}/admin/users/{fresh.id}",
            params={**w.params, "confirm": "fresh@test.com"},
            headers=w.headers,
        )
        assert gone.status_code == 204, gone.text
        assert await _count(db_session, User, User.id == fresh.id) == 0
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.entity_id, action.action) == ("user", fresh.id, "delete")
        assert action.before["email"] == "fresh@test.com"
        self_delete = await client.delete(
            f"{API}/admin/users/{w.admin.id}",
            params={**w.params, "confirm": _short(w.admin.id)},
            headers=w.headers,
        )
        assert self_delete.status_code == 409


class TestMembership:
    async def test_remove_a_membership_but_never_yourself_or_the_last_owner(
        self, client, db_session, w
    ):
        me = await client.delete(
            f"{API}/admin/users/{w.admin.id}/membership",
            params={**w.params, "confirm": _short(w.admin.id)},
            headers=w.headers,
        )
        assert me.status_code == 409
        unconfirmed = await client.delete(
            f"{API}/admin/users/{w.member.id}/membership", params=w.params, headers=w.headers
        )
        assert unconfirmed.status_code == 422
        resp = await client.delete(
            f"{API}/admin/users/{w.member.id}/membership",
            params={**w.params, "confirm": "member-a@test.com"},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert (
            await _count(db_session, OrganizationMember, OrganizationMember.user_id == w.member.id)
            == 0
        )
        # The account itself is untouched: they can sign in, just not here.
        user = await db_session.get(User, w.member.id)
        await db_session.refresh(user)
        assert user.disabled_at is None and user.email == "member-a@test.com"
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("user", "membership.remove")
        assert action.before == {"id": str(w.member.id), "role": "member"}
        gone = await client.delete(
            f"{API}/admin/users/{w.member.id}/membership",
            params={**w.params, "confirm": _short(w.member.id)},
            headers=w.headers,
        )
        assert gone.status_code == 404


class TestPackage:
    async def test_a_package_with_purchases_is_refused_one_without_goes(
        self, client, db_session, w
    ):
        refused = await client.delete(
            f"{API}/admin/packages/{w.package.id}",
            params={**w.params, "confirm": "Pack 10"},
            headers=w.headers,
        )
        assert refused.status_code == 409
        assert refused.json()["detail"]["blockers"] == {"purchases": 1}
        unsold = Package(org_id=w.org.id, name="Pack 5", hours=5, price=Decimal("50.00"))
        db_session.add(unsold)
        await db_session.commit()
        gone = await client.delete(
            f"{API}/admin/packages/{unsold.id}",
            params={**w.params, "confirm": "Pack 5"},
            headers=w.headers,
        )
        assert gone.status_code == 204, gone.text
        assert await _count(db_session, Package, Package.id == unsold.id) == 0
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("package", "delete")
        assert action.before["name"] == "Pack 5"


class TestPurchase:
    async def test_cancelling_a_purchase_needs_a_reason_zeroes_the_balance_and_keeps_debits(
        self, client, db_session, w
    ):
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
        await db_session.commit()
        no_reason = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"status": "cancelled"},
            headers=w.headers,
        )
        assert no_reason.status_code == 422
        resp = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"status": "cancelled", "reason": "Reembolsado fora da plataforma"},
            headers=w.headers,
        )
        assert resp.status_code == 200, resp.text
        purchase = resp.json()["purchase"]
        assert purchase["status"] == "cancelled"
        assert purchase["hours_remaining"] == "0.00"
        assert purchase["amount_paid"] == "100.00"
        assert (
            await _count(
                db_session, BookingPackageDebit, BookingPackageDebit.purchase_id == w.purchase.id
            )
            == 1
        )
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action, action.reason) == (
            "purchase",
            "cancel",
            "Reembolsado fora da plataforma",
        )
        assert action.before["status"] == "active"
        # Not in the customer's bank any more.
        balance = await client.get(
            f"{API}/admin/users/{w.member.id}", params=w.params, headers=w.headers
        )
        assert Decimal(balance.json()["balance"]["hours_available"]) == 0

    async def test_a_note_alone_and_reactivation(self, client, db_session, w):
        noted = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"admin_note": "Cliente habitual"},
            headers=w.headers,
        )
        assert noted.status_code == 200, noted.text
        assert noted.json()["purchase"]["admin_note"] == "Cliente habitual"
        assert noted.json()["purchase"]["status"] == "active"
        cancelled = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"status": "cancelled", "reason": "Engano"},
            headers=w.headers,
        )
        assert cancelled.json()["purchase"]["hours_remaining"] == "0.00"
        back = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"status": "active", "reason": "Afinal não"},
            headers=w.headers,
        )
        assert back.status_code == 200, back.text
        assert back.json()["purchase"]["hours_remaining"] == "10.00"
        pending = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=w.params,
            json={"status": "pending", "reason": "x"},
            headers=w.headers,
        )
        assert pending.status_code == 422

    async def test_hard_delete_only_a_free_purchase_with_no_debits(self, client, db_session, w):
        paid = await client.delete(
            f"{API}/admin/purchases/{w.purchase.id}",
            params={**w.params, "confirm": _short(w.purchase.id)},
            headers=w.headers,
        )
        assert paid.status_code == 409, paid.text
        assert paid.json()["detail"]["blockers"] == {"amount_paid": "100.00", "debits": 0}
        granted = await client.post(
            f"{API}/admin/users/{w.member.id}/complimentary-hours",
            params=w.params,
            json={"hours": "2", "package_id": str(w.package.id), "reason": "Oferta"},
            headers=w.headers,
        )
        purchase_id = uuid.UUID(granted.json()["purchase"]["id"])
        gone = await client.delete(
            f"{API}/admin/purchases/{purchase_id}",
            params={**w.params, "confirm": _short(purchase_id)},
            headers=w.headers,
        )
        assert gone.status_code == 204, gone.text
        assert (
            await _count(db_session, UserPackagePurchase, UserPackagePurchase.id == purchase_id)
            == 0
        )
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("purchase", "delete")
        assert action.before["amount_paid"] == "0.00"


class TestSupportRequest:
    async def test_spam_can_be_deleted_and_the_row_is_kept_in_the_trail(
        self, client, db_session, w
    ):
        unconfirmed = await client.delete(
            f"{API}/admin/support/requests/{w.request.id}", params=w.params, headers=w.headers
        )
        assert unconfirmed.status_code == 422
        resp = await client.delete(
            f"{API}/admin/support/requests/{w.request.id}",
            params={**w.params, "confirm": _short(w.request.id)},
            headers=w.headers,
        )
        assert resp.status_code == 204, resp.text
        assert await _count(db_session, SupportRequest, SupportRequest.id == w.request.id) == 0
        action = await _last_action(db_session, w.org.id)
        assert (action.entity_type, action.action) == ("support_request", "delete")
        assert action.before["message"].startswith("A sala estava fechada")
        assert action.before["contact_email"] == "member-a@test.com"


class TestCrossTenant:
    async def test_every_delete_on_another_orgs_row_is_a_404_and_moves_nothing(
        self, client, db_session, w
    ):
        headers, params = _headers(w.other_admin, "owner"), {"org_id": str(w.other_org.id)}
        rule = (
            (
                await db_session.execute(
                    select(AvailabilityRule).where(AvailabilityRule.room_id == w.room.id)
                )
            )
            .scalars()
            .first()
        )
        targets = [
            ("DELETE", f"{API}/admin/spaces/{w.space.id}", {"confirm": "Space A"}),
            ("DELETE", f"{API}/admin/rooms/{w.room.id}", {"confirm": "Sala A"}),
            ("DELETE", f"{API}/admin/rooms/{w.room.id}/availability/{rule.id}", {}),
            ("DELETE", f"{API}/admin/bookings/{w.booking.id}", {"confirm": _short(w.booking.id)}),
            ("DELETE", f"{API}/admin/users/{w.member.id}", {"confirm": _short(w.member.id)}),
            (
                "DELETE",
                f"{API}/admin/users/{w.member.id}/membership",
                {"confirm": _short(w.member.id)},
            ),
            ("DELETE", f"{API}/admin/packages/{w.package.id}", {"confirm": "Pack 10"}),
            (
                "DELETE",
                f"{API}/admin/purchases/{w.purchase.id}",
                {"confirm": _short(w.purchase.id)},
            ),
            (
                "DELETE",
                f"{API}/admin/support/requests/{w.request.id}",
                {"confirm": _short(w.request.id)},
            ),
        ]
        for method, url, extra in targets:
            resp = await client.request(method, url, params={**params, **extra}, headers=headers)
            assert resp.status_code == 404, f"{method} {url} -> {resp.status_code} {resp.text}"
        anonymise = await client.post(
            f"{API}/admin/users/{w.member.id}/anonymise",
            params=params,
            json={"confirm": _short(w.member.id)},
            headers=headers,
        )
        assert anonymise.status_code == 404
        cancel = await client.put(
            f"{API}/admin/purchases/{w.purchase.id}",
            params=params,
            json={"status": "cancelled", "reason": "x"},
            headers=headers,
        )
        assert cancel.status_code == 404
        assert await _count(db_session, Space, Space.org_id == w.org.id) == 2
        assert await _count(db_session, Room, Room.org_id == w.org.id) == 1
        assert (
            await _count(db_session, AvailabilityRule, AvailabilityRule.room_id == w.room.id) == 6
        )
        assert await _count(db_session, Booking, Booking.org_id == w.org.id) == 2
        assert (
            await _count(db_session, OrganizationMember, OrganizationMember.org_id == w.org.id) == 2
        )
        assert await _count(db_session, Package, Package.org_id == w.org.id) == 1
        assert (
            await _count(db_session, UserPackagePurchase, UserPackagePurchase.org_id == w.org.id)
            == 1
        )
        assert await _count(db_session, SupportRequest, SupportRequest.org_id == w.org.id) == 1
        assert await _count(db_session, AdminAction) == 0
        member = await db_session.get(User, w.member.id)
        await db_session.refresh(member)
        assert member.email == "member-a@test.com"
