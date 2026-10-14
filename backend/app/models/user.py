import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.database import Base
from app.emails import normalize_email


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # B67: one mailbox, one account — the identity we compare on.
        Index("ix_users_email_normalized", "email_normalized", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.uuid_generate_v4(),
    )
    # As typed: what we send to. Unique as before; the identity is below.
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    # Lowercased, `+tag` dropped, Gmail dots removed (app/emails.py); kept in
    # step with `email` by the validator, so no code path can forget it.
    email_normalized: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    @validates("email")
    def _keep_normalized(self, _key: str, value: str) -> str:
        self.email_normalized = normalize_email(value)
        return value

    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # What an issued invoice names (I04): the NIF and, when they differ from
    # the account's, the name and address to bill.
    tax_id: Mapped[str | None] = mapped_column(String(9), nullable=True)
    billing_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Every JWT carries the version it was issued under (`tv`); bumping this
    # revokes them all at once — after a password reset, an admin-set
    # password or anonymisation (G02/G03). Never in a public schema.
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # "Suspender" (G02): set, the account cannot sign in, use a token or ask
    # for a reset; cleared by "Reativar". Anonymisation sets it for good.
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    memberships: Mapped[list["OrganizationMember"]] = relationship(  # noqa: F821
        "OrganizationMember", back_populates="user", lazy="noload"
    )
    bookings: Mapped[list["Booking"]] = relationship(  # noqa: F821
        "Booking", back_populates="user", lazy="noload"
    )
    package_purchases: Mapped[list["UserPackagePurchase"]] = relationship(  # noqa: F821
        "UserPackagePurchase", back_populates="user", lazy="noload"
    )
