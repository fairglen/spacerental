"""Per-customer smart-lock access (L01).

One PIN per customer, not per booking (owner decision, 2026-11-10,
superseding O04's per-booking scope). `CustomerAccess` holds the PIN itself,
encrypted at rest; `CustomerAccessDevice` is the per-lock projection the
reconciliation pass (app/holds.py) drives towards the Nuki lock. The PIN is
never stored or logged in clear, and a `nuki_auth_id` is never discarded
before the lock confirms the delete — otherwise a code would be orphaned on
the door.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Lifecycle of a customer's access as a whole.
ACCESS_ACTIVE = "active"
ACCESS_DORMANT = "dormant"
ACCESS_REVOKED = "revoked"
ACCESS_STATUSES = (ACCESS_ACTIVE, ACCESS_DORMANT, ACCESS_REVOKED)

# Where the per-device row is relative to the lock, driven by the pass.
SYNC_PENDING = "pending"
SYNC_SYNCED = "synced"
SYNC_FAILED = "failed"
SYNC_REVOKE_PENDING = "revoke_pending"
SYNC_STATUSES = (SYNC_PENDING, SYNC_SYNCED, SYNC_FAILED, SYNC_REVOKE_PENDING)


class CustomerAccess(Base):
    """One row per customer per organisation: their door PIN and its state."""

    __tablename__ = "customer_access"
    __table_args__ = (
        UniqueConstraint("org_id", "user_id", name="uq_customer_access_org_user"),
        Index("ix_customer_access_org_status", "org_id", "status"),
        CheckConstraint(
            "status in ('active', 'dormant', 'revoked')", name="ck_customer_access_status"
        ),
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
    # Fernet/AES-GCM token (app/locks.py). Never the clear PIN.
    pin_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=ACCESS_ACTIVE)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    devices: Mapped[list["CustomerAccessDevice"]] = relationship(
        "CustomerAccessDevice",
        back_populates="access",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CustomerAccessDevice(Base):
    """The customer's authorisation on one lock (one space's entrance). The
    pass pushes `pending` to the lock, deletes `revoke_pending`, and records
    the Nuki authorisation id once the lock confirms it."""

    __tablename__ = "customer_access_devices"
    __table_args__ = (
        UniqueConstraint(
            "customer_access_id", "device_id", name="uq_customer_access_devices_access_device"
        ),
        Index("ix_customer_access_devices_org_sync", "org_id", "sync_status"),
        # PR B attributes a keypad log entry to a customer through its authId.
        Index("ix_customer_access_devices_device_auth", "device_id", "nuki_auth_id"),
        CheckConstraint(
            "sync_status in ('pending', 'synced', 'failed', 'revoke_pending')",
            name="ck_customer_access_devices_sync_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    customer_access_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("customer_access.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The Nuki smartlock id for the space's lock (NUKI_DEVICE_ID_MAP).
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # The Nuki authorisation id; null until the lock confirms the PIN. Never
    # cleared before a successful delete, or the code is orphaned on the door.
    nuki_auth_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sync_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=SYNC_PENDING
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    access: Mapped["CustomerAccess"] = relationship(
        "CustomerAccess", back_populates="devices", lazy="noload"
    )
