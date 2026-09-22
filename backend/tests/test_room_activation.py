"""A07 — deactivating a room that still has future bookings is refused.

A room goes inactive through `PUT /admin/rooms/{id}` with `is_active: false`
(the same field the edit form and the new button send). When bookings still
hold future slots there, the answer is 409 with those bookings listed, so
the operator can move or cancel them first; the room stays active.
"""

from datetime import UTC, datetime, timedelta

from app.models.booking import Booking, BookingStatus, PaymentMethod

API = "/api/v1"


def _org(test_org) -> dict:
    return {"org_id": str(test_org.id)}


async def _booking(db_session, *, org, room, user, days: int, status, hold=None) -> Booking:
    start = (datetime.now(tz=UTC) + timedelta(days=days)).replace(minute=0, second=0, microsecond=0)
    row = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=start + timedelta(hours=2),
        duration_hours=2,
        total_amount=22,
        status=status,
        payment_method=PaymentMethod.hourly,
        hold_expires_at=hold,
    )
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _set_active(client, headers, org, room, value: bool):
    return await client.put(
        f"{API}/admin/rooms/{room.id}",
        params=_org(org),
        json={"is_active": value},
        headers=headers,
    )


class TestDeactivate:
    async def test_a_room_with_no_future_bookings_goes_inactive_and_off_the_public_list(
        self, client, admin_headers, test_org, test_room, test_user, db_session
    ):
        # Past and cancelled bookings never block: they hold nothing.
        await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=-3,
            status=BookingStatus.confirmed,
        )
        await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=5,
            status=BookingStatus.cancelled,
        )
        resp = await _set_active(client, admin_headers, test_org, test_room, False)
        assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["is_active"] is False

        public = await client.get(f"{API}/spaces/{test_room.space_id}")
        assert [r["id"] for r in public.json()["rooms"]] == []

    async def test_refused_with_the_future_bookings_listed_and_the_room_untouched(
        self, client, admin_headers, test_org, test_room, test_user, test_member, db_session
    ):
        soon = await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=2,
            status=BookingStatus.confirmed,
        )
        later = await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=9,
            status=BookingStatus.confirmed,
        )
        # A live unpaid hold blocks too; a lapsed one does not.
        live = await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=4,
            status=BookingStatus.pending,
            hold=datetime.now(tz=UTC) + timedelta(minutes=10),
        )
        await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=6,
            status=BookingStatus.pending,
            hold=datetime.now(tz=UTC) - timedelta(minutes=10),
        )
        resp = await _set_active(client, admin_headers, test_org, test_room, False)
        assert resp.status_code == 409, resp.text
        detail = resp.json()["detail"]
        assert detail["total"] == 3
        listed = detail["bookings"]
        assert [b["id"] for b in listed] == [str(soon.id), str(live.id), str(later.id)]
        assert listed[0]["customer_email"] == test_user.email
        assert listed[0]["status"] == "confirmed" and listed[1]["status"] == "pending"
        assert "start_time" in listed[0] and "end_time" in listed[0]

        await db_session.refresh(test_room)
        assert test_room.is_active is True
        public = await client.get(f"{API}/spaces/{test_room.space_id}")
        assert [r["id"] for r in public.json()["rooms"]] == [str(test_room.id)]

    async def test_other_fields_still_save_when_is_active_is_not_being_turned_off(
        self, client, admin_headers, test_org, test_room, test_user, db_session
    ):
        await _booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            days=2,
            status=BookingStatus.confirmed,
        )
        for body in ({"name": "Sala Nova"}, {"is_active": True, "capacity": 3}):
            resp = await client.put(
                f"{API}/admin/rooms/{test_room.id}",
                params=_org(test_org),
                json=body,
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["name"] == "Sala Nova"

    async def test_reactivating_is_always_allowed_and_the_room_is_bookable_again(
        self, client, admin_headers, test_org, test_room, db_session
    ):
        assert (
            await _set_active(client, admin_headers, test_org, test_room, False)
        ).status_code == 200
        resp = await _set_active(client, admin_headers, test_org, test_room, True)
        assert resp.status_code == 200, resp.text
        assert resp.json()["room"]["is_active"] is True
        public = await client.get(f"{API}/spaces/{test_room.space_id}")
        assert [r["id"] for r in public.json()["rooms"]] == [str(test_room.id)]

    async def test_the_list_is_capped_but_the_total_is_not(
        self, client, admin_headers, test_org, test_room, test_user, db_session
    ):
        for day in range(1, 26):
            await _booking(
                db_session,
                org=test_org,
                room=test_room,
                user=test_user,
                days=day,
                status=BookingStatus.confirmed,
            )
        resp = await _set_active(client, admin_headers, test_org, test_room, False)
        assert resp.status_code == 409
        assert resp.json()["detail"]["total"] == 25
        assert len(resp.json()["detail"]["bookings"]) == 20
