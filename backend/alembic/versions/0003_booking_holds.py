"""Checkout holds: hold_expires_at plus the expired / paid_unfulfilled statuses (C03).

Revision ID: 0003_booking_holds
Revises: 0002_recurring_bookings
Create Date: 2026-09-18

`ALTER TYPE ... ADD VALUE` runs inside Alembic's transaction (PostgreSQL 12+
allows it as long as the new value is not used in the same transaction, and
this migration does not). The downgrade folds both new statuses into `cancelled`
(neither may hold a slot) before recreating the enum, and drops/recreates the
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
    # Pre-existing unpaid one-off holds would otherwise be deadline-less and
    # block their slots forever (NULL means "never expires", reserved for
    # series occurrences). Give them the deadline they would have had, so they
    # read as expired on the next access and can be retried or released.
    op.execute(
        """
        UPDATE bookings
        SET hold_expires_at = created_at + INTERVAL '15 minutes'
        WHERE status = 'pending'
          AND payment_method = 'hourly'
          AND recurrence_rule_id IS NULL
          AND hold_expires_at IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("bookings", "hold_expires_at")
    # Lossy by nature: an expired hold never held a paid slot, and a
    # paid-but-unfulfilled row did receive money but, by definition, overlaps
    # the booking that took its slot — so it cannot become `confirmed` under
    # `bookings_no_overlap` and folds into `cancelled` (the payment record
    # is the thing this downgrade loses; O02 owns the refund).
    op.execute("UPDATE bookings SET status = 'cancelled' WHERE status = 'expired'")
    op.execute("UPDATE bookings SET status = 'cancelled' WHERE status = 'paid_unfulfilled'")
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
