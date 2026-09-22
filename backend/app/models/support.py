import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SupportCategory(StrEnum):
    technical = "technical"
    booking = "booking"
    payment = "payment"
    package = "package"
    other = "other"


class SupportStatus(StrEnum):
    new = "new"
    closed = "closed"


class SupportRequest(Base):
    """A message from the help form (C17): the operator's inbox (D06 reads it).

    `org_id` is nullable on purpose. The form is public, and a visitor who is
    not signed in on a deployment without a configured enrollment organisation
    belongs to no tenant we can name. Such a row is emailed to support like any
    other but appears in NO organisation's listing: an unresolved request must
    never be shown to a tenant that may not be its own.
    """

    __tablename__ = "support_requests"
    __table_args__ = (
        Index("ix_support_requests_org_id_status_created", "org_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    # SET NULL, not CASCADE: deleting an account or a booking must not erase
    # what the person asked for; `contact_email` still says who to answer.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[SupportCategory] = mapped_column(
        SAEnum(SupportCategory, name="support_category"), nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    contact_email: Mapped[str] = mapped_column(String(320), nullable=False)
    # What the browser reported when the form was sent: page, viewport, user
    # agent, app version, client timestamp. Whitelisted by the request schema.
    context: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    status: Mapped[SupportStatus] = mapped_column(
        SAEnum(SupportStatus, name="support_status"),
        nullable=False,
        default=SupportStatus.new,
        server_default="new",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    booking: Mapped["Booking | None"] = relationship("Booking", lazy="noload")  # noqa: F821
    user: Mapped["User | None"] = relationship("User", lazy="noload")  # noqa: F821
