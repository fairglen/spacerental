"""Checkout holds: hold_expires_at plus the expired / paid_unfulfilled statuses (C03).

Revision ID: 0003_booking_holds
Revises: 0002_recurring_bookings
Create Date: 2026-09-18

`ALTER TYPE ... ADD VALUE` runs inside Alembic's transaction (PostgreSQL 12+
allows it as long as the new value is not used in the same transaction, and
this migration does not). The downgrade folds the new statuses back into the
old ones before recreating the enum, and drops/recreates the
`bookings_no_overlap` EXCLUDE constraint around the column retype because its
predicate references the enum. Applied revision IDs are never renamed; the
0002_ prefix collision is documented in TODO.md B33h.
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_booking_holds"
down_revision = "0002_recurring_bookings"
branch_labels = None
depends_on = None

NO_OVERLAP = """
    ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        room_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    ) WHERE (status IN ('pending', 'confirmed'))
"""


def upgrade() -> None:
    op.execute("ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'expired'")
    op.execute("ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'paid_unfulfilled'")
    op.add_column(
        "bookings", sa.Column("hold_expires_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("bookings", "hold_expires_at")
    # Lossy by nature: an expired hold never held a paid slot, and a
    # paid-but-unfulfilled row did receive money.
    op.execute("UPDATE bookings SET status = 'cancelled' WHERE status = 'expired'")
    op.execute("UPDATE bookings SET status = 'confirmed' WHERE status = 'paid_unfulfilled'")
    op.execute("ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap")
    op.execute("ALTER TYPE booking_status RENAME TO booking_status_old")
    op.execute(
        "CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed')"
    )
    op.execute("ALTER TABLE bookings ALTER COLUMN status DROP DEFAULT")
    op.execute(
        "ALTER TABLE bookings ALTER COLUMN status TYPE booking_status"
        " USING status::text::booking_status"
    )
    op.execute("ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'confirmed'")
    op.execute("DROP TYPE booking_status_old")
    op.execute(NO_OVERLAP)
