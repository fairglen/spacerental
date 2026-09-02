import uuid
import decimal
from datetime import datetime
from sqlalchemy import (
    String,
    Text,
    Numeric,
    DateTime,
    ForeignKey,
    Index,
    func,
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base
import enum


class BookingStatus(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled = "cancelled"
    completed = "completed"


class PaymentMethod(str, enum.Enum):
    hourly = "hourly"
    package = "package"


class Booking(Base):
    __tablename__ = "bookings"
    # Declared here rather than in the migration alone so `Base.metadata` is a
    # complete description of the schema: `alembic revision --autogenerate`
    # would otherwise emit a `drop_index` for each of these on the next run.
    __table_args__ = (
        Index("ix_bookings_room_id_start_time", "room_id", "start_time"),
        Index("ix_bookings_user_id", "user_id"),
        Index("ix_bookings_org_id_status", "org_id", "status"),
        Index("ix_bookings_recurrence_rule_id", "recurrence_rule_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_hours: Mapped[decimal.Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    total_amount: Mapped[decimal.Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    status: Mapped[BookingStatus] = mapped_column(
        SAEnum(BookingStatus, name="booking_status"),
        nullable=False,
        default=BookingStatus.confirmed,
        server_default="confirmed",
    )
    payment_method: Mapped[PaymentMethod] = mapped_column(
        SAEnum(PaymentMethod, name="payment_method"),
        nullable=False,
        default=PaymentMethod.hourly,
        server_default="hourly",
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL for a one-off booking; set for every occurrence expanded from a
    # series. SET NULL rather than CASCADE: a rule is retired by flipping
    # `is_active`, and should it ever be deleted outright the occurrences that
    # already happened must survive as ordinary bookings.
    recurrence_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recurrence_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Stripe Checkout Session that pays for this booking. Unique so a webhook
    # replay can never confirm two rows; NULL when payments are disabled.
    stripe_checkout_session_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
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

    room: Mapped["Room"] = relationship("Room", back_populates="bookings", lazy="noload")  # noqa: F821
    user: Mapped["User"] = relationship("User", back_populates="bookings", lazy="noload")  # noqa: F821
    recurrence_rule: Mapped["RecurrenceRule | None"] = relationship(  # noqa: F821
        "RecurrenceRule", back_populates="bookings", lazy="noload"
    )
