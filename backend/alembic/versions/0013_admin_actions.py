"""Audit log: `admin_actions` (G01, the minimal mandatory slice of O05).

Revision ID: 0013_admin_actions
Revises: 0012_space_timezone
Create Date: 2026-09-30

One row per operator action on one tenant row, written in the same
transaction as the change (`app.audit.record`). The two indexes are
ascending on purpose: PostgreSQL reads a B-tree backwards for the
newest-first listings, and an ascending index is what `alembic check`
compares against the model. Nothing here is customer-facing.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0013_admin_actions"
down_revision = "0012_space_timezone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_actions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_admin_actions_org_created", "admin_actions", ["org_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_admin_actions_org_entity_created",
        "admin_actions",
        ["org_id", "entity_type", "entity_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_admin_actions_org_entity_created", table_name="admin_actions")
    op.drop_index("ix_admin_actions_org_created", table_name="admin_actions")
    op.drop_table("admin_actions")
