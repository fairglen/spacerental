"""The smart-lock audit trail (L02): lock_events + access_verdicts.

Raw lock-log entries (deduped on the provider id, keypad entries attributed to
a customer) and the verdicts reconciled from them. Expand-only (CLAUDE.md
§6.5): the previous release never reads these tables.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0022_lock_events"
down_revision = "0021_customer_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lock_events",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")
        ),
        sa.Column(
            "org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("nuki_event_id", sa.String(length=128), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("nuki_auth_id", sa.String(length=64), nullable=True),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("trigger", sa.Integer(), nullable=True),
        sa.Column("raw", JSONB(), nullable=False, server_default="{}"),
        sa.UniqueConstraint("nuki_event_id", name="uq_lock_events_nuki_event_id"),
    )
    op.create_index(
        "ix_lock_events_org_device_time", "lock_events", ["org_id", "device_id", "occurred_at"]
    )
    op.create_index("ix_lock_events_user_time", "lock_events", ["user_id", "occurred_at"])
    op.create_index("ix_lock_events_kind_time", "lock_events", ["kind", "occurred_at"])

    op.create_table(
        "access_verdicts",
        sa.Column(
            "id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")
        ),
        sa.Column(
            "org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "lock_event_id",
            UUID(as_uuid=True),
            sa.ForeignKey("lock_events.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "booking_id",
            UUID(as_uuid=True),
            sa.ForeignKey("bookings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("verdict", sa.String(length=16), nullable=False),
        sa.Column("delta_minutes", sa.Integer(), nullable=True),
        sa.Column("departure_estimate_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "departure_confidence", sa.String(length=8), nullable=False, server_default="none"
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("lock_event_id", name="uq_access_verdicts_lock_event"),
    )
    op.create_index("ix_access_verdicts_org_verdict", "access_verdicts", ["org_id", "verdict"])
    op.create_index("ix_access_verdicts_booking", "access_verdicts", ["booking_id"])


def downgrade() -> None:
    op.drop_table("access_verdicts")
    op.drop_table("lock_events")
