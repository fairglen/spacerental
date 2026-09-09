import asyncio
import uuid
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from itertools import pairwise

import pytest
import pytest_asyncio
from app.auth import create_access_token, hash_password
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.organization import MemberRole, OrganizationMember
from app.models.recurrence import RecurrenceFrequency, RecurrenceRule
from app.models.user import User
from app.routers import recurrences
from app.routers.recurrences import expand_occurrences
from sqlalchemy import func, select, text


@pytest.fixture(autouse=True)
def enable_experimental_recurrences(monkeypatch):
    monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", True)


def _next_monday(hour: int = 10) -> datetime:
    """The next Monday strictly in the future, at `hour` UTC.

    The series endpoints refuse a start in the past, so every fixture time has
    to be anchored forward rather than on today.
    """
    today = datetime.now(tz=UTC).date()
    days_ahead = (0 - today.weekday()) % 7 or 7
    start = datetime.combine(today + timedelta(days=days_ahead), time(hour, 0), tzinfo=UTC)
    # Series cancellation tests must stay outside the 24-hour window on Sundays too.
    if start <= datetime.now(tz=UTC) + timedelta(hours=24):
        start += timedelta(weeks=1)
    return start


def _series_body(room_id, *, start: datetime, weeks: int, duration_hours: int = 2, **extra):
    end = start + timedelta(hours=duration_hours)
    until = (start + timedelta(weeks=weeks - 1)).date()
    body = {
        "room_id": str(room_id),
        "start_time": start.isoformat(),
        "end_time": end.isoformat(),
        "frequency": "weekly",
        "until_date": until.isoformat(),
    }
    body.update(extra)
    return body


async def _insert_booking(
    db_session, *, org, room, user, start, end, status=BookingStatus.confirmed, rule=None
):
    booking = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=end,
        duration_hours=Decimal(str(round((end - start).total_seconds() / 3600, 2))),
        total_amount=Decimal("22.00"),
        status=status,
        payment_method=PaymentMethod.hourly,
        recurrence_rule_id=rule.id if rule is not None else None,
    )
    db_session.add(booking)
    await db_session.commit()
    await db_session.refresh(booking)
    return booking


async def _statuses_by_start(db_session, room_id):
    db_session.expire_all()
    result = await db_session.execute(
        select(Booking.start_time, Booking.status)
        .where(Booking.room_id == room_id)
        .order_by(Booking.start_time)
    )
    return list(result.all())


@pytest_asyncio.fixture
async def overlap_constraint(engine, db_session):
    """Install the production `bookings_no_overlap` EXCLUDE constraint.

    The test schema is built by `Base.metadata.create_all`, which cannot carry
    this constraint — migration 0001 owns it deliberately (CLAUDE.md §6.5). Any
    test that means to prove the *database* arbitrates a race has to add it
    back, otherwise it is only ever exercising the application-level pre-check.

    Depends on `db_session` so it runs after that fixture has recreated the
    schema; the next test's drop_all takes the constraint with it.
    """
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
        await conn.execute(
            text(
                """
                ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
                    room_id WITH =,
                    tstzrange(start_time, end_time, '[)') WITH &&
                ) WHERE (status IN ('pending', 'confirmed'))
                """
            )
        )
    yield


class TestExpandOccurrences:
    """Pure expansion logic — no I/O, so it belongs at the unit level (§10.2)."""

    def test_weekly_expansion_is_inclusive_of_until_date(self):
        start = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)
        occurrences = expand_occurrences(
            start, start + timedelta(hours=2), date(2026, 10, 26)
        )
        assert [o[0].day for o in occurrences] == [5, 12, 19, 26]
        assert all(end - begin == timedelta(hours=2) for begin, end in occurrences)

    def test_until_date_before_the_next_step_stops_the_series(self):
        start = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)
        occurrences = expand_occurrences(
            start, start + timedelta(hours=1), date(2026, 10, 11)
        )
        assert len(occurrences) == 1

    def test_occurrences_are_ascending(self):
        start = datetime(2026, 10, 5, 10, 0, tzinfo=UTC)
        occurrences = expand_occurrences(
            start, start + timedelta(hours=1), date(2026, 12, 31)
        )
        assert occurrences == sorted(occurrences)


class TestCreateRecurrence:
    async def test_requires_auth(self, client, test_room):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=4),
        )
        assert resp.status_code == 401

    async def test_creates_rule_and_one_booking_per_occurrence(
        self, client, auth_headers, test_room, test_member, test_user
    ):
        start = _next_monday()
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=4, notes="Terapia semanal"),
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()

        rule = body["recurrence"]
        assert rule["frequency"] == "weekly"
        assert rule["is_active"] is True
        assert rule["user_id"] == str(test_user.id)
        assert rule["org_id"] == str(test_room.org_id)

        bookings = body["bookings"]
        assert len(bookings) == 4
        assert [b["recurrence_rule_id"] for b in bookings] == [rule["id"]] * 4
        starts = [datetime.fromisoformat(b["start_time"]) for b in bookings]
        assert starts[0] == start
        assert all(b - a == timedelta(days=7) for a, b in pairwise(starts))
        # Payment-first, exactly like POST /bookings: pending holds the slot.
        assert {b["status"] for b in bookings} == {"pending"}
        assert all(Decimal(b["duration_hours"]) == Decimal("2.00") for b in bookings)
        # hourly_rate 11.00 * 2h
        assert all(Decimal(b["total_amount"]) == Decimal("22.00") for b in bookings)
        assert all(b["notes"] == "Terapia semanal" for b in bookings)

    async def test_occurrences_show_up_on_my_bookings(
        self, client, auth_headers, test_room, test_member
    ):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=3),
            headers=auth_headers,
        )
        rule_id = resp.json()["recurrence"]["id"]

        mine = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert mine.status_code == 200
        listed = mine.json()["bookings"]
        assert len(listed) == 3
        assert {b["recurrence_rule_id"] for b in listed} == {rule_id}

    async def test_one_conflicting_occurrence_rejects_the_whole_series(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        start = _next_monday()
        # Third occurrence is already taken by an unrelated booking.
        blocked_start = start + timedelta(weeks=2)
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=blocked_start + timedelta(minutes=30),
            end=blocked_start + timedelta(hours=1),
        )

        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=4),
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["conflicts"] == [blocked_start.isoformat().replace("+00:00", "Z")]

        # Nothing at all was written: no rule, and no occurrence rows.
        db_session.expire_all()
        rules = await db_session.execute(select(func.count()).select_from(RecurrenceRule))
        assert rules.scalar_one() == 0
        bookings = await db_session.execute(
            select(func.count()).select_from(Booking).where(Booking.recurrence_rule_id.isnot(None))
        )
        assert bookings.scalar_one() == 0

    async def test_cancelled_booking_does_not_conflict(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        start = _next_monday()
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=start,
            end=start + timedelta(hours=2),
            status=BookingStatus.cancelled,
        )
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=2),
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text

    async def test_unknown_room_returns_404(self, client, auth_headers, test_member):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(uuid.uuid4(), start=_next_monday(), weeks=2),
            headers=auth_headers,
        )
        assert resp.status_code == 404

    async def test_non_member_returns_403(self, client, db_session, test_room):
        outsider = User(
            email="outsider@test.com", name="Outsider", password_hash=hash_password("password123")
        )
        db_session.add(outsider)
        await db_session.commit()
        await db_session.refresh(outsider)
        token = create_access_token(
            {
                "sub": str(outsider.id),
                "email": outsider.email,
                "name": outsider.name,
                "role": "member",
            }
        )

        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=2),
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    @pytest.mark.parametrize(
        "mutate,expected_detail",
        [
            (lambda b, s: b.update(end_time=s.isoformat()), "end_time must be after start_time"),
            (
                lambda b, s: b.update(
                    start_time=(datetime.now(tz=UTC) - timedelta(days=1)).isoformat()
                ),
                "start_time must be in the future",
            ),
            (
                lambda b, s: b.update(until_date=(s - timedelta(days=1)).date().isoformat()),
                "until_date must not be before start_time",
            ),
            (
                lambda b, s: b.update(end_time=(s + timedelta(days=8)).isoformat()),
                "An occurrence cannot be longer than the recurrence interval",
            ),
        ],
    )
    async def test_invalid_windows_return_400(
        self, client, auth_headers, test_room, test_member, mutate, expected_detail
    ):
        start = _next_monday()
        body = _series_body(test_room.id, start=start, weeks=4)
        mutate(body, start)
        resp = await client.post("/api/v1/recurrences", json=body, headers=auth_headers)
        assert resp.status_code == 400, resp.text
        assert resp.json()["detail"] == expected_detail

    async def test_series_longer_than_the_cap_is_rejected(
        self, client, auth_headers, test_room, test_member
    ):
        start = _next_monday()
        body = _series_body(test_room.id, start=start, weeks=1)
        body["until_date"] = (start + timedelta(weeks=200)).date().isoformat()
        resp = await client.post("/api/v1/recurrences", json=body, headers=auth_headers)
        assert resp.status_code == 400
        assert "104" in resp.json()["detail"]


class TestCancelOneOccurrence:
    async def test_single_cancel_leaves_the_series_active(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=4),
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        rule_id = resp.json()["recurrence"]["id"]
        second = resp.json()["bookings"][1]

        # The existing single-booking endpoint, unchanged — a series occurrence
        # is an ordinary booking that happens to know its rule.
        cancelled = await client.delete(f"/api/v1/bookings/{second['id']}", headers=auth_headers)
        assert cancelled.status_code == 204, cancelled.text

        statuses = await _statuses_by_start(db_session, test_room.id)
        assert [s for _, s in statuses] == [
            BookingStatus.pending,
            BookingStatus.cancelled,
            BookingStatus.pending,
            BookingStatus.pending,
        ]

        rule = (
            await db_session.execute(select(RecurrenceRule).where(RecurrenceRule.id == rule_id))
        ).scalar_one()
        assert rule.is_active is True

    async def test_freed_occurrence_can_be_rebooked(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=3),
            headers=auth_headers,
        )
        second = resp.json()["bookings"][1]
        await client.delete(f"/api/v1/bookings/{second['id']}", headers=auth_headers)

        booking = await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=datetime.fromisoformat(second["start_time"]),
            end=datetime.fromisoformat(second["end_time"]),
        )
        assert booking.id is not None


class TestCancelSeries:
    async def test_cancels_from_the_given_date_onwards(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        start = _next_monday()
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=4),
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        rule_id = resp.json()["recurrence"]["id"]
        from_date = (start + timedelta(weeks=2)).date().isoformat()

        cancelled = await client.delete(
            f"/api/v1/recurrences/{rule_id}?from_date={from_date}", headers=auth_headers
        )
        assert cancelled.status_code == 204, cancelled.text

        statuses = await _statuses_by_start(db_session, test_room.id)
        assert [s for _, s in statuses] == [
            BookingStatus.pending,
            BookingStatus.pending,
            BookingStatus.cancelled,
            BookingStatus.cancelled,
        ]

        rule = (
            await db_session.execute(select(RecurrenceRule).where(RecurrenceRule.id == rule_id))
        ).scalar_one()
        assert rule.is_active is False

    async def test_without_from_date_cancels_everything_remaining(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=3),
            headers=auth_headers,
        )
        rule_id = resp.json()["recurrence"]["id"]

        cancelled = await client.delete(f"/api/v1/recurrences/{rule_id}", headers=auth_headers)
        assert cancelled.status_code == 204

        statuses = await _statuses_by_start(db_session, test_room.id)
        assert {s for _, s in statuses} == {BookingStatus.cancelled}

    async def test_never_rewrites_a_completed_past_occurrence(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        rule, past, future = await _seed_series_with_history(
            db_session, test_org, test_room, test_user
        )
        resp = await client.delete(f"/api/v1/recurrences/{rule.id}", headers=auth_headers)
        assert resp.status_code == 204

        db_session.expire_all()
        await db_session.refresh(past)
        await db_session.refresh(future)
        assert past.status is BookingStatus.completed
        assert future.status is BookingStatus.cancelled

    async def test_other_users_series_is_forbidden(
        self, client, db_session, test_org, test_room, auth_headers, test_member
    ):
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=_next_monday(), weeks=2),
            headers=auth_headers,
        )
        rule_id = resp.json()["recurrence"]["id"]

        intruder = User(
            email="intruder@test.com", name="Intruder", password_hash=hash_password("password123")
        )
        db_session.add(intruder)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=intruder.id, role=MemberRole.member)
        )
        await db_session.commit()
        await db_session.refresh(intruder)
        token = create_access_token(
            {
                "sub": str(intruder.id),
                "email": intruder.email,
                "name": intruder.name,
                "role": "member",
            }
        )

        resp = await client.delete(
            f"/api/v1/recurrences/{rule_id}", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 403

    async def test_unknown_series_returns_404(self, client, auth_headers):
        resp = await client.delete(f"/api/v1/recurrences/{uuid.uuid4()}", headers=auth_headers)
        assert resp.status_code == 404


async def _seed_series_with_history(db_session, org, room, user):
    """A series with one completed past occurrence and one pending future one.

    Inserted directly: the API refuses to create a series in the past, which is
    exactly the history an edit must not disturb.
    """
    start = _next_monday(hour=14)
    rule = RecurrenceRule(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
        frequency=RecurrenceFrequency.weekly,
        start_time=start,
        end_time=start + timedelta(hours=2),
        until_date=(start + timedelta(weeks=1)).date(),
    )
    db_session.add(rule)
    await db_session.commit()
    await db_session.refresh(rule)

    past_start = datetime.now(tz=UTC) - timedelta(days=7)
    past = await _insert_booking(
        db_session,
        org=org,
        room=room,
        user=user,
        start=past_start,
        end=past_start + timedelta(hours=2),
        status=BookingStatus.completed,
        rule=rule,
    )
    future = await _insert_booking(
        db_session,
        org=org,
        room=room,
        user=user,
        start=start,
        end=start + timedelta(hours=2),
        status=BookingStatus.pending,
        rule=rule,
    )
    return rule, past, future


class TestEditSeries:
    async def test_moves_future_occurrences_to_the_new_time(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=3),
            headers=auth_headers,
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["recurrence"]["id"]
        old_ids = {b["id"] for b in created.json()["bookings"]}

        new_start = start + timedelta(hours=5)
        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=2)).isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["recurrence"]["start_time"] == new_start.isoformat().replace("+00:00", "Z")

        new_bookings = body["bookings"]
        assert len(new_bookings) == 3
        assert old_ids.isdisjoint({b["id"] for b in new_bookings})
        assert [datetime.fromisoformat(b["start_time"]) for b in new_bookings] == [
            new_start + timedelta(weeks=i) for i in range(3)
        ]

        db_session.expire_all()
        result = await db_session.execute(
            select(Booking.id, Booking.status).where(Booking.recurrence_rule_id == rule_id)
        )
        by_id = dict(result.all())
        assert all(by_id[uuid.UUID(i)] is BookingStatus.cancelled for i in old_ids)

    async def test_until_date_can_be_extended(self, client, auth_headers, test_room, test_member):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=2),
            headers=auth_headers,
        )
        rule_id = created.json()["recurrence"]["id"]

        new_start = start + timedelta(hours=5)
        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=1)).isoformat(),
                "until_date": (start + timedelta(weeks=4)).date().isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert len(resp.json()["bookings"]) == 5

    async def test_a_conflicting_new_time_changes_nothing(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=3),
            headers=auth_headers,
        )
        rule_id = created.json()["recurrence"]["id"]
        original_ids = [b["id"] for b in created.json()["bookings"]]

        # Someone else already holds the second occurrence at the new time.
        new_start = start + timedelta(hours=5)
        blocker_start = new_start + timedelta(weeks=1)
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=blocker_start,
            end=blocker_start + timedelta(hours=2),
        )

        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=2)).isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        assert resp.json()["conflicts"] == [blocker_start.isoformat().replace("+00:00", "Z")]

        db_session.expire_all()
        rule = (
            await db_session.execute(select(RecurrenceRule).where(RecurrenceRule.id == rule_id))
        ).scalar_one()
        assert rule.start_time == start
        result = await db_session.execute(
            select(Booking.id, Booking.start_time, Booking.status).where(
                Booking.recurrence_rule_id == rule_id
            )
        )
        rows = list(result.all())
        assert {str(r.id) for r in rows} == set(original_ids)
        assert all(r.status is BookingStatus.pending for r in rows)

    async def test_the_series_own_slots_are_not_treated_as_conflicts(
        self, client, auth_headers, test_room, test_member
    ):
        """Shifting by an hour makes the new occurrences overlap the old ones."""
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=3),
            headers=auth_headers,
        )
        rule_id = created.json()["recurrence"]["id"]

        new_start = start + timedelta(hours=1)
        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=2)).isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text

    async def test_past_and_completed_occurrences_are_never_touched(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member
    ):
        rule, past, future = await _seed_series_with_history(
            db_session, test_org, test_room, test_user
        )
        new_start = rule.start_time + timedelta(hours=5)

        resp = await client.put(
            f"/api/v1/recurrences/{rule.id}",
            json={
                "start_time": new_start.isoformat(),
                "end_time": (new_start + timedelta(hours=2)).isoformat(),
                "until_date": new_start.date().isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text

        db_session.expire_all()
        await db_session.refresh(past)
        await db_session.refresh(future)
        assert past.status is BookingStatus.completed
        assert past.start_time < datetime.now(tz=UTC)
        assert future.status is BookingStatus.cancelled

    async def test_other_users_series_is_forbidden(
        self, client, db_session, test_org, test_room, auth_headers, test_member
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=2),
            headers=auth_headers,
        )
        rule_id = created.json()["recurrence"]["id"]

        intruder = User(
            email="intruder2@test.com", name="Intruder", password_hash=hash_password("password123")
        )
        db_session.add(intruder)
        await db_session.flush()
        db_session.add(
            OrganizationMember(org_id=test_org.id, user_id=intruder.id, role=MemberRole.member)
        )
        await db_session.commit()
        await db_session.refresh(intruder)
        token = create_access_token(
            {
                "sub": str(intruder.id),
                "email": intruder.email,
                "name": intruder.name,
                "role": "member",
            }
        )

        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": (start + timedelta(hours=5)).isoformat(),
                "end_time": (start + timedelta(hours=6)).isoformat(),
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    async def test_cancelled_series_cannot_be_edited(
        self, client, auth_headers, test_room, test_member
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=2),
            headers=auth_headers,
        )
        rule_id = created.json()["recurrence"]["id"]
        await client.delete(f"/api/v1/recurrences/{rule_id}", headers=auth_headers)

        resp = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            json={
                "start_time": (start + timedelta(hours=5)).isoformat(),
                "end_time": (start + timedelta(hours=6)).isoformat(),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400


class TestConcurrentSeriesCreation:
    async def test_two_overlapping_series_cannot_both_partially_succeed(
        self, client, auth_headers, db_session, test_room, test_member, overlap_constraint
    ):
        """Two identical series fired at once: exactly one may hold the slots.

        Without the per-room advisory lock this failed roughly one run in ten
        with a PostgreSQL deadlock rather than a clean 409 — both transactions
        insert many rows, each waits on the other's uncommitted tuple during
        the EXCLUDE check, and the waits form a cycle. The lock serializes the
        two, and `bookings_no_overlap` stays underneath as the backstop.

        The invariant under test is all-or-nothing under concurrency: no
        half-written series, and no rule left behind without its occurrences.
        """
        start = _next_monday()
        body = _series_body(test_room.id, start=start, weeks=4)

        first, second = await asyncio.gather(
            client.post("/api/v1/recurrences", json=body, headers=auth_headers),
            client.post("/api/v1/recurrences", json=body, headers=auth_headers),
        )
        codes = sorted([first.status_code, second.status_code])
        assert codes == [201, 409], (
            f"{first.status_code}/{first.text} {second.status_code}/{second.text}"
        )

        loser = first if first.status_code == 409 else second
        assert loser.json()["conflicts"]

        db_session.expire_all()
        rules = await db_session.execute(select(func.count()).select_from(RecurrenceRule))
        assert rules.scalar_one() == 1

        result = await db_session.execute(
            select(Booking).where(
                Booking.status.in_([BookingStatus.pending, BookingStatus.confirmed])
            )
        )
        held = list(result.scalars().all())
        assert len(held) == 4
        assert len({b.recurrence_rule_id for b in held}) == 1

    async def test_a_series_cannot_steal_a_slot_a_single_booking_holds(
        self,
        client,
        auth_headers,
        db_session,
        test_org,
        test_room,
        test_user,
        test_member,
        overlap_constraint,
    ):
        start = _next_monday()
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=start + timedelta(weeks=1),
            end=start + timedelta(weeks=1, hours=2),
        )
        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=3),
            headers=auth_headers,
        )
        assert resp.status_code == 409

        db_session.expire_all()
        rules = await db_session.execute(select(func.count()).select_from(RecurrenceRule))
        assert rules.scalar_one() == 0

    async def test_a_stale_pre_check_still_cannot_write_a_partial_series(
        self,
        client,
        auth_headers,
        db_session,
        test_org,
        test_room,
        test_user,
        test_member,
        overlap_constraint,
        monkeypatch,
    ):
        """The EXCLUDE constraint, not the pre-check, is what makes this safe.

        The pre-check exists to report *which* dates clash — the database
        cannot tell us that. It can never be the thing that guarantees
        correctness, because another request can claim a slot in the window
        between the check and the insert.

        That window is real but too narrow to hit on demand, so it is
        simulated: `_find_conflicts` is stubbed to see nothing while a booking
        genuinely holds the second occurrence. Every application-level guard is
        therefore blind, and `bookings_no_overlap` is the only thing left. If
        the constraint ever stopped being applied, or the handler stopped
        rolling the transaction back on `IntegrityError`, this test writes a
        half-finished series and fails.
        """
        start = _next_monday()
        taken_start = start + timedelta(weeks=1)
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=taken_start,
            end=taken_start + timedelta(hours=2),
        )

        async def blind(*args, **kwargs):
            return []

        monkeypatch.setattr(recurrences, "_find_conflicts", blind)

        resp = await client.post(
            "/api/v1/recurrences",
            json=_series_body(test_room.id, start=start, weeks=3),
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text
        # The stub reports nothing, so the handler falls back to naming every
        # occurrence rather than inventing a precise answer it does not have.
        assert len(resp.json()["conflicts"]) == 3

        db_session.expire_all()
        rules = await db_session.execute(select(func.count()).select_from(RecurrenceRule))
        assert rules.scalar_one() == 0
        series_bookings = await db_session.execute(
            select(func.count()).select_from(Booking).where(Booking.recurrence_rule_id.isnot(None))
        )
        assert series_bookings.scalar_one() == 0
        # The booking that held the slot is untouched.
        held = await db_session.execute(
            select(func.count())
            .select_from(Booking)
            .where(Booking.status == BookingStatus.confirmed)
        )
        assert held.scalar_one() == 1

    async def test_a_series_racing_a_single_booking_leaves_exactly_one_winner(
        self, client, auth_headers, db_session, test_room, test_member, payments, overlap_constraint
    ):
        """The one race the advisory lock deliberately does not cover.

        `POST /bookings` takes no per-room lock — a single-row writer cannot be
        part of a deadlock cycle — so a series and a one-off booking landing on
        the same slot at the same moment are arbitrated by
        `bookings_no_overlap` alone. Either order is legitimate; what must never
        happen is both winning, or the series surviving in pieces.
        """
        start = _next_monday()
        series_body = _series_body(test_room.id, start=start, weeks=4)
        single_body = {
            "room_id": str(test_room.id),
            # Overlaps the second occurrence, so the pre-checks can disagree
            # about who was first no matter how the two interleave.
            "start_time": (start + timedelta(weeks=1, hours=1)).isoformat(),
            "end_time": (start + timedelta(weeks=1, hours=3)).isoformat(),
            "payment_method": "hourly",
        }

        series_resp, single_resp = await asyncio.gather(
            client.post("/api/v1/recurrences", json=series_body, headers=auth_headers),
            client.post("/api/v1/bookings", json=single_body, headers=auth_headers),
        )
        assert sorted([series_resp.status_code, single_resp.status_code]) == [201, 409], (
            f"series={series_resp.status_code}/{series_resp.text} "
            f"single={single_resp.status_code}/{single_resp.text}"
        )

        db_session.expire_all()
        result = await db_session.execute(
            select(Booking).where(
                Booking.status.in_([BookingStatus.pending, BookingStatus.confirmed])
            )
        )
        held = list(result.scalars().all())
        rules = await db_session.execute(select(func.count()).select_from(RecurrenceRule))

        if series_resp.status_code == 201:
            assert len(held) == 4
            assert {b.recurrence_rule_id for b in held} == {
                uuid.UUID(series_resp.json()["recurrence"]["id"])
            }
            assert rules.scalar_one() == 1
        else:
            # All-or-nothing: the losing series left neither rule nor occurrences.
            assert len(held) == 1
            assert held[0].recurrence_rule_id is None
            assert rules.scalar_one() == 0


class TestRecurrenceReviewRegressions:
    async def test_removed_member_cannot_edit_but_can_release_existing_slots(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            headers=auth_headers,
            json=_series_body(test_room.id, start=start, weeks=2),
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["recurrence"]["id"]
        await db_session.delete(test_member)
        await db_session.commit()
        response = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            headers=auth_headers,
            json=_series_body(test_room.id, start=start + timedelta(hours=3), weeks=2),
        )
        assert response.status_code == 403, response.text
        cancelled = await client.delete(f"/api/v1/recurrences/{rule_id}", headers=auth_headers)
        assert cancelled.status_code == 204, cancelled.text

    async def test_disabled_foundation_rejects_all_mutations(
        self, client, auth_headers, test_room, monkeypatch
    ):
        monkeypatch.setattr(recurrences.settings, "RECURRING_BOOKINGS_ENABLED", False)
        body = _series_body(test_room.id, start=_next_monday(), weeks=2)
        for method, path in (
            ("POST", ""),
            ("PUT", f"/{uuid.uuid4()}"),
            ("DELETE", f"/{uuid.uuid4()}"),
        ):
            response = await client.request(
                method, f"/api/v1/recurrences{path}", json=body, headers=auth_headers
            )
            assert response.status_code == 404

    @pytest.mark.parametrize("edit", [False, True])
    async def test_bulk_changes_cannot_bypass_24_hour_window(
        self, client, auth_headers, db_session, test_room, test_member, emails, edit
    ):
        start = datetime.now(tz=UTC) + timedelta(hours=12)
        created = await client.post(
            "/api/v1/recurrences",
            headers=auth_headers,
            json=_series_body(test_room.id, start=start, weeks=2),
        )
        assert created.status_code == 201, created.text
        rule_id = created.json()["recurrence"]["id"]
        if edit:
            response = await client.put(
                f"/api/v1/recurrences/{rule_id}",
                headers=auth_headers,
                json=_series_body(test_room.id, start=start + timedelta(days=2), weeks=2),
            )
        else:
            response = await client.delete(f"/api/v1/recurrences/{rule_id}", headers=auth_headers)
        assert response.status_code == 400, response.text
        assert "24 hours" in response.json()["detail"]
        assert {status for _, status in await _statuses_by_start(db_session, test_room.id)} == {
            BookingStatus.pending
        }
        assert emails.sent == []

    async def test_cancel_with_past_cutoff_preserves_historical_confirmed_booking(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member, emails
    ):
        rule, past, future = await _seed_series_with_history(
            db_session, test_org, test_room, test_user
        )
        past.status = BookingStatus.confirmed
        await db_session.commit()
        response = await client.delete(
            f"/api/v1/recurrences/{rule.id}",
            headers=auth_headers,
            params={"from_date": (past.start_time - timedelta(days=1)).date().isoformat()},
        )
        assert response.status_code == 204, response.text
        await db_session.refresh(past)
        await db_session.refresh(future)
        assert past.status is BookingStatus.confirmed
        assert future.status is BookingStatus.cancelled
        assert len(emails.sent) == 1
        repeated = await client.delete(f"/api/v1/recurrences/{rule.id}", headers=auth_headers)
        assert repeated.status_code == 204
        assert len(emails.sent) == 1

    async def test_edit_accepts_past_anchor_and_only_expands_future_occurrences(
        self, client, auth_headers, db_session, test_org, test_room, test_user, test_member, emails
    ):
        rule, past, future = await _seed_series_with_history(
            db_session, test_org, test_room, test_user
        )
        response = await client.put(
            f"/api/v1/recurrences/{rule.id}",
            headers=auth_headers,
            json={
                "start_time": (rule.start_time + timedelta(hours=3)).isoformat(),
                "end_time": (rule.end_time + timedelta(hours=3)).isoformat(),
            },
        )
        assert response.status_code == 200, response.text
        assert all(
            datetime.fromisoformat(b["start_time"]) > datetime.now(tz=UTC)
            for b in response.json()["bookings"]
        )
        await db_session.refresh(past)
        await db_session.refresh(future)
        assert past.status is BookingStatus.completed
        assert future.status is BookingStatus.cancelled
        assert len(emails.sent) == 1

    async def test_waiting_edit_observes_concurrent_cancellation(
        self, client, auth_headers, db_session, test_room, test_member
    ):
        created = await client.post(
            "/api/v1/recurrences",
            headers=auth_headers,
            json=_series_body(test_room.id, start=_next_monday(), weeks=2),
        )
        rule_id = created.json()["recurrence"]["id"]
        rule = (
            await db_session.execute(
                select(RecurrenceRule).where(RecurrenceRule.id == rule_id).with_for_update()
            )
        ).scalar_one()
        task = asyncio.create_task(
            client.put(
                f"/api/v1/recurrences/{rule_id}",
                headers=auth_headers,
                json=_series_body(test_room.id, start=_next_monday(14), weeks=2),
            )
        )
        try:
            await asyncio.sleep(0.1)
            assert not task.done(), "the edit must wait for the locked rule"
            rule.is_active = False
            await db_session.commit()
            response = await asyncio.wait_for(task, timeout=5)
            assert response.status_code == 400, response.text
            assert "cancelled" in response.json()["detail"]
        finally:
            await db_session.rollback()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    async def test_lost_edit_race_rolls_back_without_cancellation_emails(
        self,
        client,
        auth_headers,
        db_session,
        test_org,
        test_room,
        test_user,
        test_member,
        emails,
        overlap_constraint,
        monkeypatch,
    ):
        start = _next_monday()
        created = await client.post(
            "/api/v1/recurrences",
            headers=auth_headers,
            json=_series_body(test_room.id, start=start, weeks=2),
        )
        rule_id = created.json()["recurrence"]["id"]
        moved = start + timedelta(hours=3)
        await _insert_booking(
            db_session,
            org=test_org,
            room=test_room,
            user=test_user,
            start=moved,
            end=moved + timedelta(hours=2),
        )
        original = recurrences._find_conflicts
        calls = 0

        async def stale_check(*args, **kwargs):
            nonlocal calls
            calls += 1
            return [] if calls == 1 else await original(*args, **kwargs)

        monkeypatch.setattr(recurrences, "_find_conflicts", stale_check)
        response = await client.put(
            f"/api/v1/recurrences/{rule_id}",
            headers=auth_headers,
            json=_series_body(test_room.id, start=moved, weeks=2),
        )
        assert response.status_code == 409, response.text
        assert response.json()["conflicts"]
        assert emails.sent == []
        db_session.expire_all()
        bookings = (
            (await db_session.execute(select(Booking).where(Booking.recurrence_rule_id == rule_id)))
            .scalars()
            .all()
        )
        assert len(bookings) == 2
        assert {b.status for b in bookings} == {BookingStatus.pending}
