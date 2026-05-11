import uuid
import decimal
from datetime import datetime
from sqlalchemy import Integer, Boolean, Numeric, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String
from app.database import Base


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
        Numeric(5, 2), nullable=False, default=decimal.Decimal("0"), server_default="0"
    )
    hours_remaining: Mapped[decimal.Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="package_purchases", lazy="noload")  # noqa: F821
    package: Mapped["Package"] = relationship(
        "Package", back_populates="purchases", lazy="noload"
    )
