"""The smart-lock audit trail (L02): ingestion, attribution, verdicts,
departure confidence, retention, and the operator report.

Ingestion and verdicts run in the same pass as the PIN sync; these tests
drive `app.lock_events.ingest_and_judge` directly against the stub gateway's
fake log, and hit the report endpoint through the client.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from app import lock_events
from app.config import settings
from app.locks import (
    LOG_ACTION_DOOR_CLOSED,
    LOG_ACTION_LOCK,
    LOG_ACTION_UNLOCK,
    LockEvent,
    StubLockGateway,
)
from app.models.booking import Booking, BookingStatus, PaymentMethod
from app.models.customer_access import SYNC_SYNCED, CustomerAccess, CustomerAccessDevice
from app.models.lock_event import (
    CONFIDENCE_HIGH,
    CONFIDENCE_LOW,
    CONFIDENCE_NONE,
    VERDICT_EARLY,
    VERDICT_LATE,
    VERDICT_NO_BOOKING,
    VERDICT_ON_TIME,
    VERDICT_OVERSTAY,
    AccessVerdict,
    LockEventRow,
)
from sqlalchemy import func, select

API = "/api/v1"
DEVICE = "lock-l02"
AUTH = "auth-l02"


@pytest.fixture
def lock_space(monkeypatch, test_space):
    monkeypatch.setattr(settings, "NUKI_DEVICE_ID_MAP", json.dumps({str(test_space.id): DEVICE}))
    return DEVICE


@pytest_asyncio.fixture
async def synced_access(db_session, test_org, test_user, lock_space) -> CustomerAccessDevice:
    """A customer already on the lock, so their keypad entries attribute."""
    access = CustomerAccess(
        org_id=test_org.id, user_id=test_user.id, pin_encrypted="x", status="active"
    )
    db_session.add(access)
    await db_session.flush()
    device = CustomerAccessDevice(
        org_id=test_org.id,
        customer_access_id=access.id,
        device_id=DEVICE,
        nuki_auth_id=AUTH,
        sync_status=SYNC_SYNCED,
    )
    db_session.add(device)
    await db_session.commit()
    return device


def _evt(
    action: int, at: datetime, *, auth_id: str | None = None, ext: str | None = None
) -> LockEvent:
    return LockEvent(
        external_id=ext or f"e-{uuid.uuid4().hex[:8]}",
        occurred_at=at,
        action=action,
        trigger=0,
        auth_id=auth_id,
    )


async def _booking(
    db_session, org, room, user, start, end, status=BookingStatus.confirmed
) -> Booking:
    booking = Booking(
        org_id=org.id,
        room_id=room.id,
        user_id=user.id,
        start_time=start,
        end_time=end,
        duration_hours=Decimal("1.00"),
        total_amount=Decimal("11.00"),
        status=status,
        payment_method=PaymentMethod.hourly,
    )
    db_session.add(booking)
    await db_session.commit()
    await db_session.refresh(booking)
    return booking


class TestIngestion:
    async def test_events_are_stored_attributed_and_deduped(
        self, db_session, test_org, synced_access
    ):
        gw = StubLockGateway()
        now = datetime.now(tz=UTC)
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, now - timedelta(minutes=5), auth_id=AUTH, ext="k1"),
            device_id=DEVICE,
        )
        gw.append_log(
            _evt(LOG_ACTION_DOOR_CLOSED, now - timedelta(minutes=1), ext="d1"), device_id=DEVICE
        )

        first = await lock_events.ingest_and_judge(db_session, gw, now)
        await db_session.commit()
        assert first.ingested == 2
        rows = (
            (await db_session.execute(select(LockEventRow).order_by(LockEventRow.occurred_at)))
            .scalars()
            .all()
        )
        assert [r.kind for r in rows] == ["keypad_unlock", "door_close"]
        # The keypad entry is attributed to the customer; the door event is not.
        keypad = next(r for r in rows if r.kind == "keypad_unlock")
        door = next(r for r in rows if r.kind == "door_close")
        assert keypad.user_id is not None and keypad.nuki_auth_id == AUTH
        assert door.user_id is None

        # A second pass ingests nothing new (dedupe on the provider id).
        second = await lock_events.ingest_and_judge(db_session, gw, now)
        await db_session.commit()
        assert second.ingested == 0
        assert await db_session.scalar(select(func.count()).select_from(LockEventRow)) == 2


class TestVerdicts:
    @pytest.mark.parametrize(
        ("minutes_from_start", "expected"),
        [
            (5, VERDICT_ON_TIME),  # just after start
            (-5, VERDICT_ON_TIME),  # within the early tolerance (15)
            (-40, VERDICT_EARLY),  # well before start
            (120, VERDICT_LATE),  # after the end
        ],
    )
    async def test_entry_time_decides_the_verdict(
        self,
        db_session,
        test_org,
        test_room,
        test_user,
        synced_access,
        minutes_from_start,
        expected,
    ):
        start = datetime.now(tz=UTC).replace(microsecond=0) + timedelta(days=1, hours=10)
        end = start + timedelta(hours=1)
        await _booking(db_session, test_org, test_room, test_user, start, end)
        gw = StubLockGateway()
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, start + timedelta(minutes=minutes_from_start), auth_id=AUTH),
            device_id=DEVICE,
        )
        await lock_events.ingest_and_judge(db_session, gw, datetime.now(tz=UTC) + timedelta(days=2))
        await db_session.commit()
        verdict = (await db_session.execute(select(AccessVerdict))).scalar_one()
        assert verdict.verdict == expected

    async def test_no_booking_that_day_is_no_booking(self, db_session, test_org, synced_access):
        gw = StubLockGateway()
        gw.append_log(_evt(LOG_ACTION_UNLOCK, datetime.now(tz=UTC), auth_id=AUTH), device_id=DEVICE)
        await lock_events.ingest_and_judge(
            db_session, gw, datetime.now(tz=UTC) + timedelta(minutes=1)
        )
        await db_session.commit()
        verdict = (await db_session.execute(select(AccessVerdict))).scalar_one()
        assert verdict.verdict == VERDICT_NO_BOOKING

    async def test_a_late_departure_is_an_overstay(
        self, db_session, test_org, test_room, test_user, synced_access
    ):
        start = datetime.now(tz=UTC).replace(microsecond=0) + timedelta(days=1, hours=10)
        end = start + timedelta(hours=1)
        await _booking(db_session, test_org, test_room, test_user, start, end)
        gw = StubLockGateway()
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, start + timedelta(minutes=5), auth_id=AUTH), device_id=DEVICE
        )
        # A close well after the end + overstay tolerance (15).
        gw.append_log(_evt(LOG_ACTION_LOCK, end + timedelta(minutes=40)), device_id=DEVICE)
        await lock_events.ingest_and_judge(db_session, gw, end + timedelta(hours=1))
        await db_session.commit()
        verdict = (await db_session.execute(select(AccessVerdict))).scalar_one()
        assert verdict.verdict == VERDICT_OVERSTAY
        assert verdict.departure_confidence == CONFIDENCE_HIGH


class TestDepartureConfidence:
    async def test_none_when_no_close_follows(
        self, db_session, test_org, test_room, test_user, synced_access
    ):
        start = datetime.now(tz=UTC).replace(microsecond=0) + timedelta(days=1, hours=10)
        end = start + timedelta(hours=1)
        await _booking(db_session, test_org, test_room, test_user, start, end)
        gw = StubLockGateway()
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, start + timedelta(minutes=5), auth_id=AUTH), device_id=DEVICE
        )
        await lock_events.ingest_and_judge(db_session, gw, end + timedelta(hours=1))
        await db_session.commit()
        verdict = (await db_session.execute(select(AccessVerdict))).scalar_one()
        assert verdict.departure_confidence == CONFIDENCE_NONE
        assert verdict.departure_estimate_at is None

    async def test_low_when_another_keypad_session_overlaps(
        self, db_session, test_org, test_room, test_user, synced_access
    ):
        start = datetime.now(tz=UTC).replace(microsecond=0) + timedelta(days=1, hours=10)
        end = start + timedelta(hours=1)
        await _booking(db_session, test_org, test_room, test_user, start, end)
        gw = StubLockGateway()
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, start + timedelta(minutes=5), auth_id=AUTH, ext="k1"),
            device_id=DEVICE,
        )
        # Another keypad entry between the end and the close → low confidence.
        gw.append_log(
            _evt(LOG_ACTION_UNLOCK, end + timedelta(minutes=2), auth_id=AUTH, ext="k2"),
            device_id=DEVICE,
        )
        gw.append_log(
            _evt(LOG_ACTION_DOOR_CLOSED, end + timedelta(minutes=10), ext="d1"), device_id=DEVICE
        )
        await lock_events.ingest_and_judge(db_session, gw, end + timedelta(hours=1))
        await db_session.commit()
        first = (
            await db_session.execute(
                select(AccessVerdict).join(LockEventRow).where(LockEventRow.nuki_event_id == "k1")
            )
        ).scalar_one()
        assert first.departure_confidence == CONFIDENCE_LOW


class TestRetention:
    async def test_old_events_are_pruned_but_verdicts_stay(
        self, db_session, test_org, synced_access, monkeypatch
    ):
        monkeypatch.setattr(settings, "ACCESS_EVENT_RETENTION_DAYS", 90)
        # An old raw event with a verdict already computed (as it would be after
        # months). The prune removes the event; the verdict must survive.
        old = datetime.now(tz=UTC) - timedelta(days=200)
        event = LockEventRow(
            org_id=test_org.id,
            device_id=DEVICE,
            nuki_event_id="old-1",
            occurred_at=old,
            kind="keypad_unlock",
            nuki_auth_id=AUTH,
        )
        db_session.add(event)
        await db_session.flush()
        db_session.add(
            AccessVerdict(
                org_id=test_org.id,
                lock_event_id=event.id,
                verdict=VERDICT_NO_BOOKING,
                departure_confidence=CONFIDENCE_NONE,
            )
        )
        await db_session.commit()

        pruned = await lock_events._prune(db_session, datetime.now(tz=UTC))
        await db_session.commit()
        assert pruned == 1
        assert await db_session.scalar(select(func.count()).select_from(LockEventRow)) == 0
        verdict = (await db_session.execute(select(AccessVerdict))).scalar_one()
        assert verdict.verdict == VERDICT_NO_BOOKING
        assert verdict.lock_event_id is None  # the raw event is gone, the verdict stays


class TestReport:
    async def test_report_lists_the_weeks_verdicts_with_counts(
        self, client, admin_headers, db_session, test_org, synced_access
    ):
        gw = StubLockGateway()
        gw.append_log(_evt(LOG_ACTION_UNLOCK, datetime.now(tz=UTC), auth_id=AUTH), device_id=DEVICE)
        await lock_events.ingest_and_judge(
            db_session, gw, datetime.now(tz=UTC) + timedelta(minutes=1)
        )
        await db_session.commit()

        resp = await client.get(
            f"{API}/admin/access/report", params={"org_id": str(test_org.id)}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        report = resp.json()["report"]
        assert report["counts"].get("no_booking") == 1
        assert len(report["verdicts"]) == 1
        assert report["verdicts"][0]["verdict"] == "no_booking"

    async def test_a_member_is_refused(self, client, auth_headers, test_member, test_org):
        resp = await client.get(
            f"{API}/admin/access/report", params={"org_id": str(test_org.id)}, headers=auth_headers
        )
        assert resp.status_code == 403
