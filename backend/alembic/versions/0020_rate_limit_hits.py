"""Shared rate-limit counters (N02): rate_limit_hits.

Revision ID: 0020_rate_limit_hits
Revises: 0019_users_email_normalized
Create Date: 2026-10-28

One row per (tier, client identity, fixed window) for
RATE_LIMIT_STORE=postgres, incremented by every worker and replica with one
upsert (app/ratelimit.py). Expand-only (CLAUDE.md §6.5): the previous
release never touches the table, and the memory store ignores it.
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_rate_limit_hits"
down_revision = "0019_users_email_normalized"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_hits",
        sa.Column("scope", sa.String(length=32), nullable=False),
        sa.Column("identity", sa.String(length=255), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hits", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("scope", "identity", "window_start"),
    )


def downgrade() -> None:
    op.drop_table("rate_limit_hits")
