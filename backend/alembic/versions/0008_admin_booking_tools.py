"""Operator booking management: payment_method 'manual', bookings.admin_note (A01).

Revision ID: 0008_admin_booking_tools
Revises: 0007_support_requests
Create Date: 2026-09-22

`admin_note` came from `alembic revision --autogenerate`; the enum value by
hand (autogenerate does not compare enum values). `ALTER TYPE ... ADD VALUE`
runs inside Alembic's transaction, which PostgreSQL 12+ allows as long as the
new value is not used in the same transaction — nothing here uses it.

Downgrade is lossy by nature: a `manual` booking was paid outside the platform
and folds into `hourly` (its `total_amount` is the slot's value either way);
the operator's notes are dropped with the column.
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_admin_booking_tools"
down_revision = "0007_support_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'manual'")
    op.add_column("bookings", sa.Column("admin_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "admin_note")
    op.execute("UPDATE bookings SET payment_method = 'hourly' WHERE payment_method = 'manual'")
    op.execute("ALTER TYPE payment_method RENAME TO payment_method_old")
    op.execute("CREATE TYPE payment_method AS ENUM ('hourly', 'package', 'mixed')")
    op.execute("ALTER TABLE bookings ALTER COLUMN payment_method DROP DEFAULT")
    op.execute(
        "ALTER TABLE bookings ALTER COLUMN payment_method TYPE payment_method"
        " USING payment_method::text::payment_method"
    )
    op.execute("ALTER TABLE bookings ALTER COLUMN payment_method SET DEFAULT 'hourly'")
    op.execute("DROP TYPE payment_method_old")
