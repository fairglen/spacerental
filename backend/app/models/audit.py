import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AdminAction(Base):
    """One operator action on one row of one tenant (G01, O05's minimal scope).

    Written by `app.audit.record` in the SAME transaction as the change, so a
    rolled-back mutation leaves no trace and a committed one always leaves
    exactly one. `before`/`after` hold the entity's PUBLIC schema, reduced
    to the keys that changed plus the identifiers: a password hash, a reset
    token or a token version can never land here because no public schema
    carries them. `actor_user_id` is NULL for a system action, or once the
    actor's account was deleted (SET NULL keeps the trail).

    Both indexes are ascending: PostgreSQL walks a B-tree backwards for an
    `ORDER BY created_at DESC` at no extra cost, and an ascending index is
    what `alembic check` can compare against the metadata.
    """

    __tablename__ = "admin_actions"
    __table_args__ = (
        Index(
            "ix_admin_actions_org_entity_created",
            "org_id",
            "entity_type",
            "entity_id",
            "created_at",
        ),
        Index("ix_admin_actions_org_created", "org_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.uuid_generate_v4()
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    actor: Mapped["User | None"] = relationship("User", lazy="noload")  # noqa: F821
