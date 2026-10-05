"""bookings: index on (org_id, start_time) for the operator lists (P2.3)

The admin booking list and the calendar read one organisation's bookings in
start-time order; with 10 000 rows the planner chose Limit → Sort → Seq Scan.
The index matches the filter and the order, so the list becomes an index
scan (backward for newest-first) that stops at the page size. Declared in
`Booking.__table_args__` as well, so `alembic check` sees both.

Revision ID: 0017_bookings_org_start_index
Revises: 0016_cancellation_credit
Create Date: 2026-10-05
"""

from alembic import op

revision = "0017_bookings_org_start_index"
down_revision = "0016_cancellation_credit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_bookings_org_id_start_time", "bookings", ["org_id", "start_time"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_bookings_org_id_start_time", table_name="bookings")
