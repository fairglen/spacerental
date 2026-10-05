"""Support triage (G04): the `in_progress` status and the operator's note.

Revision ID: 0015_support_triage
Revises: 0014_user_access
Create Date: 2026-09-30

`ALTER TYPE ... ADD VALUE` is allowed inside a transaction on PostgreSQL 12+
as long as the new value is not used in the same transaction, which this
migration does not. The downgrade rebuilds the type without the value after
moving any `in_progress` row back to `new`.
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_support_triage"
down_revision = "0014_user_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE support_status ADD VALUE IF NOT EXISTS 'in_progress'")
    op.add_column("support_requests", sa.Column("admin_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("support_requests", "admin_note")
    op.execute("UPDATE support_requests SET status = 'new' WHERE status = 'in_progress'")
    op.execute("ALTER TYPE support_status RENAME TO support_status_old")
    op.execute("CREATE TYPE support_status AS ENUM ('new', 'closed')")
    op.execute(
        "ALTER TABLE support_requests ALTER COLUMN status DROP DEFAULT, "
        "ALTER COLUMN status TYPE support_status USING status::text::support_status, "
        "ALTER COLUMN status SET DEFAULT 'new'"
    )
    op.execute("DROP TYPE support_status_old")
