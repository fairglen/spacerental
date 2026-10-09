"""Invoice records (I05).

Portuguese faturas are issued by AT-certified software, not here: an
`Invoice` is the operator's record of one issued elsewhere — its number,
date, amount, hours and (optionally) the PDF — linked through `InvoiceItem`
to the transactions it covers, each of which is invoiced at most once.
"""

import decimal
import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("org_id", "number", name="uq_invoices_org_id_number"),
        Index("ix_invoices_org_id_issued_at", "org_id", "issued_at"),
        Index("ix_invoices_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    number: Mapped[str] = mapped_column(String(64), nullable=False)
    issued_at: Mapped[date] = mapped_column(Date, nullable=False)
    period_from: Mapped[date] = mapped_column(Date, nullable=False)
    period_to: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[decimal.Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    hours: Mapped[decimal.Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="EUR")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # A private storage key (`app.media.invoice_pdf_key`), never a URL.
    pdf_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_admin_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id], lazy="noload")  # noqa: F821
    items: Mapped[list["InvoiceItem"]] = relationship(
        "InvoiceItem", back_populates="invoice", cascade="all, delete-orphan", lazy="noload"
    )

    @property
    def has_pdf(self) -> bool:
        return self.pdf_key is not None


class InvoiceItem(Base):
    """One transaction on an invoice: a booking or a pack purchase, never both,
    and each at most once across all invoices."""

    __tablename__ = "invoice_items"
    __table_args__ = (
        CheckConstraint(
            "(booking_id IS NOT NULL)::int + (purchase_id IS NOT NULL)::int = 1",
            name="ck_invoice_items_one_transaction",
        ),
        UniqueConstraint("booking_id", name="uq_invoice_items_booking_id"),
        UniqueConstraint("purchase_id", name="uq_invoice_items_purchase_id"),
        Index("ix_invoice_items_invoice_id", "invoice_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), nullable=True
    )
    purchase_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_package_purchases.id", ondelete="CASCADE"),
        nullable=True,
    )

    invoice: Mapped["Invoice"] = relationship("Invoice", back_populates="items", lazy="noload")
