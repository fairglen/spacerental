import decimal
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BookingStatus(StrEnum):
    pending = "pending"
    confirmed = "confirmed"
    cancelled = "cancelled"
    completed = "completed"
    # C03: an unpaid hold whose deadline passed. Holds no slot; the owner can
    # retry payment if the slot is still free.
    expired = "expired"
    # C03: money arrived for an expired/cancelled hold after another booking
    # took the slot. Holds no slot; kept visible so the payment is never lost
    # (refund handling is O02).
    paid_unfulfilled = "paid_unfulfilled"


class PaymentMethod(StrEnum):
    hourly = "hourly"
    package = "package"
    # C13: part of the block comes out of a pack (`package_hours_used`), the
    # rest is paid at Checkout (`total_amount`). Always 0 < pack share < duration:
    # a pack that covers everything is a `package` booking, none is `hourly`.
    mixed = "mixed"
    # A01: paid or arranged outside the platform (cash, transfer, courtesy).
    # Set only by an operator — creating a booking for a customer, or marking
    # an unpaid hold as paid. The customer API never accepts it.
    manual = "manual"


# The methods that take money at Checkout: they start as an unpaid `pending`
# hold, can be resumed with "Pagar agora", and their `total_amount` is revenue.
PAID_AT_CHECKOUT = (PaymentMethod.hourly, PaymentMethod.mixed)


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
        CheckConstraint(
            "package_hours_used >= 0 AND package_hours_used <= duration_hours",
            name="ck_bookings_package_hours_used_within_duration",
        ),
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
    # Hours of this booking paid with `package_purchase_id`'s prepaid hours:
    # 0 for `hourly`, the whole duration for `package`, in between for `mixed`
    # (C13). It records the booking's split for good; whether those hours are
    # currently debited follows the status — see `package_hours`.
    package_hours_used: Mapped[decimal.Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=decimal.Decimal(0), server_default="0"
    )
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
    # A01: the operator's private note ("pago em dinheiro", "pediu a sala mais
    # silenciosa"). Never returned by a customer-facing endpoint.
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # NULL for a one-off booking; set for every occurrence expanded from a
    # series. SET NULL rather than CASCADE: a rule is retired by flipping
    # `is_active`, and should it ever be deleted outright the occurrences that
    # already happened must survive as ordinary bookings.
    recurrence_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recurrence_rules.id", ondelete="SET NULL"),
        nullable=True,
    )
    # The prepaid purchase this booking's hours were debited from, so cancelling
    # can credit them back to that exact purchase rather than guessing which of
    # the user's packages to credit. NULL for every `hourly` booking.
    package_purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "user_package_purchases.id",
            ondelete="SET NULL",
            name="fk_bookings_package_purchase_id",
        ),
        nullable=True,
    )
    # Stripe Checkout Session that pays for this booking. Unique so a webhook
    # replay can never confirm two rows; NULL when payments are disabled.
    stripe_checkout_session_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    # C03: while `pending`, the instant this unpaid hold stops blocking the
    # slot. NULL means "never" — package bookings (confirmed at once) and
    # series occurrences awaiting the operator (R02) do not expire.
    hold_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
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
    package_purchase: Mapped["UserPackagePurchase | None"] = relationship(  # noqa: F821
        "UserPackagePurchase", lazy="noload"
    )
