"""P2.2: lapsed unpaid holds are reconciled by the sweeper, and a read that
finds nothing lapsed writes nothing."""

import asyncio
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from app import clock, holds
from app.models.booking import Booking, BookingStatus, PaymentMethod
from sqlalchemy import event, select


def _booking(
    room, user, start: datetime, *, hold_expires_at: datetime | None, status=BookingStatus.pending
):
    return Booking(
        org_id=room.org_id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=start + timedelta(hours=1),
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=status,
        payment_method=PaymentMethod.hourly,
        hold_expires_at=hold_expires_at,
    )


@pytest.fixture
def sql_log(engine):
    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    yield statements
    event.remove(engine.sync_engine, "before_cursor_execute", record)


class TestSweeper:
    async def test_one_sweep_expires_every_lapsed_hold_and_leaves_the_rest(
        self, db_session, session_factory, test_room, test_user, monkeypatch
    ):
        now = datetime.now(UTC).replace(microsecond=0)
        monkeypatch.setattr(clock, "utcnow", lambda: now)
        start = now + timedelta(days=2)
        lapsed = _booking(test_room, test_user, start, hold_expires_at=now - timedelta(minutes=1))
        alive = _booking(
            test_room,
            test_user,
            start + timedelta(hours=2),
            hold_expires_at=now + timedelta(minutes=9),
        )
        forever = _booking(test_room, test_user, start + timedelta(hours=4), hold_expires_at=None)
        confirmed = _booking(
            test_room,
            test_user,
            start + timedelta(hours=6),
            hold_expires_at=now - timedelta(hours=1),
            status=BookingStatus.confirmed,
        )
        db_session.add_all([lapsed, alive, forever, confirmed])
        await db_session.commit()

        assert await holds.sweep_lapsed_holds_once(session_factory) == 1
        rows = (
            await db_session.execute(
                select(Booking.id, Booking.status).execution_options(populate_existing=True)
            )
        ).all()
        status = {row.id: row.status for row in rows}
        assert status[lapsed.id] is BookingStatus.expired
        assert status[alive.id] is BookingStatus.pending
        assert status[forever.id] is BookingStatus.pending
        assert status[confirmed.id] is BookingStatus.confirmed
        # Nothing left to do: the second sweep is a read and flips nothing.
        assert await holds.sweep_lapsed_holds_once(session_factory) == 0

    async def test_the_loop_sweeps_on_its_interval_and_stops_when_cancelled(
        self, session_factory, monkeypatch
    ):
        calls = []

        async def fake_sweep(factory):
            calls.append(factory)
            return 0

        monkeypatch.setattr(holds, "sweep_lapsed_holds_once", fake_sweep)
        task = asyncio.create_task(holds.run_hold_sweeper(session_factory, 0.01))
        await asyncio.sleep(0.08)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(calls) >= 3
        assert all(c is session_factory for c in calls)

    async def test_a_failed_sweep_does_not_stop_the_loop(
        self, session_factory, monkeypatch, caplog
    ):
        calls = []

        async def flaky(factory):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("database away")
            return 0

        monkeypatch.setattr(holds, "sweep_lapsed_holds_once", flaky)
        task = asyncio.create_task(holds.run_hold_sweeper(session_factory, 0.01))
        await asyncio.sleep(0.06)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(calls) >= 2
        assert "hold sweep failed" in caplog.text


class TestReadsDoNotWrite:
    async def test_bookings_me_issues_no_write_when_nothing_lapsed(
        self, client, auth_headers, test_member, test_room, test_user, db_session, sql_log
    ):
        now = datetime.now(UTC)
        db_session.add(
            _booking(
                test_room,
                test_user,
                now + timedelta(days=1),
                hold_expires_at=now + timedelta(minutes=9),
            )
        )
        await db_session.commit()
        sql_log.clear()
        resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert resp.status_code == 200
        assert [b["status"] for b in resp.json()["bookings"]] == ["pending"]
        writes = [
            s for s in sql_log if s.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE"))
        ]
        assert writes == []

    async def test_bookings_me_still_reconciles_a_hold_that_lapsed_before_the_sweeper_ran(
        self, client, auth_headers, test_member, test_room, test_user, db_session
    ):
        now = datetime.now(UTC)
        db_session.add(
            _booking(
                test_room,
                test_user,
                now + timedelta(days=1),
                hold_expires_at=now - timedelta(minutes=1),
            )
        )
        await db_session.commit()
        resp = await client.get("/api/v1/bookings/me", headers=auth_headers)
        assert resp.status_code == 200
        assert [b["status"] for b in resp.json()["bookings"]] == ["expired"]
