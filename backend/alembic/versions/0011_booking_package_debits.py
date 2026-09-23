"""Hour bank: `booking_package_debits`, one row per purchase a booking drew on (H02).

Revision ID: 0011_booking_package_debits
Revises: 0010_purchase_amount_paid
Create Date: 2026-09-22

The table came from `alembic revision --autogenerate`, then reviewed; the
backfill and the downgrade's link recovery were added by hand.

Backfill: until now a booking's pack hours came from ONE purchase
(`bookings.package_purchase_id`). Every booking that still holds its hours
(`pending`, `confirmed`, `completed` — see `package_hours.holds_package_hours`)
gets one debit row for the whole of `package_hours_used` against that
purchase. A cancelled, expired or paid-unfulfilled booking gets none: its
hours already went back to the purchase when it left a slot-holding status,
and a row for it would be a phantom debit that a later reinstate would credit
a second time. `package_purchase_id` is deprecated from here on — no longer
written, kept nullable for one release.

Downgrade is lossy by nature. It drops the table; before that, a booking
whose `package_purchase_id` is NULL (created after this migration) gets it
set to the purchase it drew the MOST hours from, so the pre-H02 code has one
purchase to credit on cancel. Hours drawn from other purchases stay spent: a
schema downgrade rewrites no balances.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0011_booking_package_debits"
down_revision = "0010_purchase_amount_paid"
branch_labels = None
depends_on = None

# Also exercised by tests/test_hour_bank.py against a real PostgreSQL.
BACKFILL_SQL = """
INSERT INTO booking_package_debits (org_id, booking_id, purchase_id, hours, created_at)
SELECT b.org_id, b.id, b.package_purchase_id, b.package_hours_used, b.created_at
FROM bookings AS b
WHERE b.package_purchase_id IS NOT NULL
  AND b.package_hours_used > 0
  AND b.status IN ('pending', 'confirmed', 'completed')
"""

RECOVER_LINK_SQL = """
UPDATE bookings AS b
SET package_purchase_id = d.purchase_id
FROM (
    SELECT DISTINCT ON (booking_id) booking_id, purchase_id
    FROM booking_package_debits
    ORDER BY booking_id, hours DESC, created_at ASC
) AS d
WHERE d.booking_id = b.id AND b.package_purchase_id IS NULL
"""


def upgrade() -> None:
    op.create_table(
        "booking_package_debits",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purchase_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hours", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("hours > 0", name="ck_booking_package_debits_hours_positive"),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["purchase_id"], ["user_package_purchases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "booking_id", "purchase_id", name="uq_booking_package_debits_booking_purchase"
        ),
    )
    op.create_index(
        "ix_booking_package_debits_org_id", "booking_package_debits", ["org_id"], unique=False
    )
    op.create_index(
        "ix_booking_package_debits_purchase_id",
        "booking_package_debits",
        ["purchase_id"],
        unique=False,
    )
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.execute(RECOVER_LINK_SQL)
    op.drop_index("ix_booking_package_debits_purchase_id", table_name="booking_package_debits")
    op.drop_index("ix_booking_package_debits_org_id", table_name="booking_package_debits")
    op.drop_table("booking_package_debits")
