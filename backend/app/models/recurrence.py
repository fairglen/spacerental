import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RecurrenceFrequency(str, enum.Enum):
    weekly = "weekly"


class RecurrenceRule(Base):
    """Source of truth for a recurring series.

    Occurrences are expanded flat: every occurrence is a real `Booking` row
    created up front and pointing back here via `recurrence_rule_id`. Nothing is
    computed on read, so availability, overlap checking and the
    `bookings_no_overlap` EXCLUDE constraint keep working unchanged for series
    bookings — a recurring occurrence is an ordinary booking that happens to
    know which series it came from.
    """

    __tablename__ = "recurrence_rules"
    # Declared here rather than in the migration alone so `Base.metadata` stays
    # a complete description of the schema (CLAUDE.md §6.5).
    __table_args__ = (
        Index("ix_recurrence_rules_org_id_is_active", "org_id", "is_active"),
        Index("ix_recurrence_rules_user_id", "user_id"),
        Index("ix_recurrence_rules_room_id", "room_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    frequency: Mapped[RecurrenceFrequency] = mapped_column(
        SAEnum(RecurrenceFrequency, name="recurrence_frequency"),
        nullable=False,
        default=RecurrenceFrequency.weekly,
        server_default="weekly",
    )
    # First occurrence of the series; the cadence is anchored on it.
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    until_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    bookings: Mapped[list["Booking"]] = relationship(  # noqa: F821
        "Booking", back_populates="recurrence_rule", lazy="noload"
    )
