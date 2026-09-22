import decimal
import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PurchaseStatus(StrEnum):
    pending = "pending"
    active = "active"
    cancelled = "cancelled"


class Package(Base):
    __tablename__ = "packages"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hours: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[decimal.Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    validity_days: Mapped[int] = mapped_column(
        Integer, nullable=False, default=365, server_default="365"
    )
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

    organization: Mapped["Organization"] = relationship(  # noqa: F821
        "Organization", back_populates="packages", lazy="noload"
    )
    purchases: Mapped[list["UserPackagePurchase"]] = relationship(
        "UserPackagePurchase", back_populates="package", lazy="noload"
    )


class UserPackagePurchase(Base):
    __tablename__ = "user_package_purchases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    package_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("packages.id", ondelete="CASCADE"), nullable=False
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    hours_total: Mapped[decimal.Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    hours_used: Mapped[decimal.Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=decimal.Decimal(0), server_default="0"
    )
    hours_remaining: Mapped[decimal.Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    # What was paid for this purchase, at purchase time (A05). A paid purchase
    # copies the package's price; complimentary hours are a purchase at 0,00 €
    # with a note, so revenue and balances still add up from the same rows.
    amount_paid: Mapped[decimal.Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, default=decimal.Decimal(0), server_default="0"
    )
    # The operator's private reason for a granted purchase; never customer-facing.
    admin_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A purchase only becomes `active` — i.e. its hours become spendable —
    # once Stripe confirms payment. Defaults to active so the payments-off
    # POC path keeps working unchanged.
    status: Mapped[PurchaseStatus] = mapped_column(
        SAEnum(PurchaseStatus, name="purchase_status"),
        nullable=False,
        default=PurchaseStatus.active,
        server_default="active",
    )
    stripe_checkout_session_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="package_purchases", lazy="noload")  # noqa: F821
    package: Mapped["Package"] = relationship("Package", back_populates="purchases", lazy="noload")


class BookingPackageDebit(Base):
    """One booking's draw on one purchase (H02).

    The hour bank: a booking's pack share may come from several purchases,
    soonest-expiring first, and each purchase must get exactly its own hours
    back when the booking stops holding them. A row exists only while the
    booking holds its hours (`package_hours.holds_package_hours`): cancelling,
    a lapsed hold or an operator moving it out of a slot-holding status credits
    every row and deletes it; reinstating re-debits through the same walk and
    writes fresh rows. `Booking.package_hours_used` stays as the booking's
    split for good and equals the sum of these rows while they exist.
    """

    __tablename__ = "booking_package_debits"
    __table_args__ = (
        UniqueConstraint(
            "booking_id", "purchase_id", name="uq_booking_package_debits_booking_purchase"
        ),
        Index("ix_booking_package_debits_purchase_id", "purchase_id"),
        Index("ix_booking_package_debits_org_id", "org_id"),
        CheckConstraint("hours > 0", name="ck_booking_package_debits_hours_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False
    )
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_package_purchases.id", ondelete="CASCADE"),
        nullable=False,
    )
    hours: Mapped[decimal.Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    purchase: Mapped["UserPackagePurchase"] = relationship("UserPackagePurchase", lazy="noload")
