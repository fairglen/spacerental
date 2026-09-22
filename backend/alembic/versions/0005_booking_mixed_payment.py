"""Mixed payment: payment_method 'mixed' and bookings.package_hours_used (C13).

Revision ID: 0005_booking_mixed_payment
Revises: 0004_space_location
Create Date: 2026-09-22

`package_hours_used` came from `alembic revision --autogenerate`; the enum
value, the backfill and the CHECK constraint were added by hand (autogenerate
compares neither enum values nor CHECK constraints). The constraint is declared
on the model too, so the test schema built from `Base.metadata` enforces it.

`ALTER TYPE ... ADD VALUE` runs inside Alembic's transaction, which PostgreSQL
12+ allows as long as the new value is not used in the same transaction — and
nothing here uses it.

Backfill: every booking that points at a purchase today is a `package` booking,
paid entirely with pack hours, so its share is its whole duration. That holds
for cancelled ones too: the column records the booking's split for good, and
whether the hours are currently debited follows the status.

Downgrade is lossy by nature. A `mixed` row becomes `hourly` (its
`total_amount` already is the money charged) and LOSES its link to the
purchase: the pre-C13 code credits a linked booking's whole duration on cancel,
which for a mixed booking is more than the pack ever gave. The pack hours it
used stay spent; no balance is rewritten by a schema downgrade.
"""

import sqlalchemy as sa
from alembic import op

# Keep revision ids <= 32 chars: alembic_version.version_num is varchar(32).
revision = "0005_booking_mixed_payment"
down_revision = "0004_space_location"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'mixed'")
    op.add_column(
        "bookings",
        sa.Column(
            "package_hours_used",
            sa.Numeric(precision=5, scale=2),
            server_default="0",
            nullable=False,
        ),
    )
    op.execute(
        """
        UPDATE bookings
        SET package_hours_used = duration_hours
        WHERE package_purchase_id IS NOT NULL
        """
    )
    op.create_check_constraint(
        "ck_bookings_package_hours_used_within_duration",
        "bookings",
        "package_hours_used >= 0 AND package_hours_used <= duration_hours",
    )


def downgrade() -> None:
    op.drop_constraint("ck_bookings_package_hours_used_within_duration", "bookings", type_="check")
    op.execute(
        "UPDATE bookings SET payment_method = 'hourly', package_purchase_id = NULL"
        " WHERE payment_method = 'mixed'"
    )
    op.drop_column("bookings", "package_hours_used")
    op.execute("ALTER TYPE payment_method RENAME TO payment_method_old")
    op.execute("CREATE TYPE payment_method AS ENUM ('hourly', 'package')")
    op.execute("ALTER TABLE bookings ALTER COLUMN payment_method DROP DEFAULT")
    op.execute(
        "ALTER TABLE bookings ALTER COLUMN payment_method TYPE payment_method"
        " USING payment_method::text::payment_method"
    )
    op.execute("ALTER TABLE bookings ALTER COLUMN payment_method SET DEFAULT 'hourly'")
    op.execute("DROP TYPE payment_method_old")
