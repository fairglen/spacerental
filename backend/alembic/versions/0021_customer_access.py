"""Per-customer smart-lock access (L01): customer_access + customer_access_devices.

One PIN per customer (owner decision 2026-11-10, superseding O04's
per-booking scope) and its per-lock projection the reconciliation pass
drives towards Nuki. Expand-only (CLAUDE.md §6.5): the previous release
never reads these tables, so a failed deploy rolls back onto a schema that
simply has two unused tables.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0021_customer_access"
down_revision = "0020_rate_limit_hits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customer_access",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pin_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("org_id", "user_id", name="uq_customer_access_org_user"),
        sa.CheckConstraint(
            "status in ('active', 'dormant', 'revoked')", name="ck_customer_access_status"
        ),
    )
    op.create_index("ix_customer_access_org_status", "customer_access", ["org_id", "status"])

    op.create_table(
        "customer_access_devices",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "org_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_access_id",
            UUID(as_uuid=True),
            sa.ForeignKey("customer_access.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", sa.String(length=64), nullable=False),
        sa.Column("nuki_auth_id", sa.String(length=64), nullable=True),
        sa.Column("sync_status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "customer_access_id", "device_id", name="uq_customer_access_devices_access_device"
        ),
        sa.CheckConstraint(
            "sync_status in ('pending', 'synced', 'failed', 'revoke_pending')",
            name="ck_customer_access_devices_sync_status",
        ),
    )
    op.create_index(
        "ix_customer_access_devices_org_sync",
        "customer_access_devices",
        ["org_id", "sync_status"],
    )
    op.create_index(
        "ix_customer_access_devices_device_auth",
        "customer_access_devices",
        ["device_id", "nuki_auth_id"],
    )


def downgrade() -> None:
    op.drop_table("customer_access_devices")
    op.drop_table("customer_access")
