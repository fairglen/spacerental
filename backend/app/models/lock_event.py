"""The smart-lock audit trail (L02).

`LockEventRow` is one normalised entry from the lock's log, stored once
(deduped on the provider id); keypad entries are attributed to a customer
through the authorisation id. `AccessVerdict` is the reconciliation of a
keypad entry against the customer's bookings — on time, early, late, an
overstay, or no booking — with a labelled departure estimate. Raw events are
pruned after `ACCESS_EVENT_RETENTION_DAYS`; verdicts are kept with the booking.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Event kinds (mirror app.locks.KIND_* and the check constraint).
EVENT_KINDS = (
    "keypad_unlock",
    "unlock",
    "lock",
    "unlatch",
    "door_open",
    "door_close",
    "auto_lock",
    "unknown",
)

# Verdicts for a keypad entry.
VERDICT_ON_TIME = "on_time"
VERDICT_EARLY = "early"
VERDICT_LATE = "late"
VERDICT_OVERSTAY = "overstay"
VERDICT_NO_BOOKING = "no_booking"
VERDICTS = (VERDICT_ON_TIME, VERDICT_EARLY, VERDICT_LATE, VERDICT_OVERSTAY, VERDICT_NO_BOOKING)

CONFIDENCE_HIGH = "high"
CONFIDENCE_LOW = "low"
CONFIDENCE_NONE = "none"


class LockEventRow(Base):
    __tablename__ = "lock_events"
    __table_args__ = (
        UniqueConstraint("nuki_event_id", name="uq_lock_events_nuki_event_id"),
        Index("ix_lock_events_org_device_time", "org_id", "device_id", "occurred_at"),
        Index("ix_lock_events_user_time", "user_id", "occurred_at"),
        Index("ix_lock_events_kind_time", "kind", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    nuki_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    nuki_auth_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    trigger: Mapped[int | None] = mapped_column(Integer, nullable=True)
    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")


class AccessVerdict(Base):
    __tablename__ = "access_verdicts"
    __table_args__ = (
        UniqueConstraint("lock_event_id", name="uq_access_verdicts_lock_event"),
        Index("ix_access_verdicts_org_verdict", "org_id", "verdict"),
        Index("ix_access_verdicts_booking", "booking_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    # SET NULL, nullable: a verdict outlives the raw event, which is pruned
    # after ACCESS_EVENT_RETENTION_DAYS. The unique still stops a second
    # verdict for a live event (Postgres treats NULLs as distinct).
    lock_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lock_events.id", ondelete="SET NULL"), nullable=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL"), nullable=True
    )
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    delta_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    departure_estimate_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    departure_confidence: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=CONFIDENCE_NONE
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
