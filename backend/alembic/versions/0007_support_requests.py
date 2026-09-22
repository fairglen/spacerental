"""Help form inbox: the support_requests table (C17).

Revision ID: 0007_support_requests
Revises: 0006_photos
Create Date: 2026-09-22

Generated with `alembic revision --autogenerate`, then reviewed. One addition
by hand: `drop_table` leaves the two enum types behind, so the downgrade drops
them too — otherwise a later upgrade fails on "type already exists".

`org_id` is nullable on purpose (see the model): a request whose tenant cannot
be resolved is emailed to support but listed for no organisation.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007_support_requests"
down_revision = "0006_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "support_requests",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=True),
        sa.Column("user_id", sa.UUID(), nullable=True),
        sa.Column("booking_id", sa.UUID(), nullable=True),
        sa.Column(
            "category",
            sa.Enum("technical", "booking", "payment", "package", "other", name="support_category"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("contact_email", sa.String(length=320), nullable=False),
        sa.Column(
            "context",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("new", "closed", name="support_status"),
            server_default="new",
            nullable=False,
        ),
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
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_support_requests_org_id_status_created",
        "support_requests",
        ["org_id", "status", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_support_requests_org_id_status_created", table_name="support_requests")
    op.drop_table("support_requests")
    op.execute("DROP TYPE support_status")
    op.execute("DROP TYPE support_category")
