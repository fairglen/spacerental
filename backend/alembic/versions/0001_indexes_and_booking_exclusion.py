"""indexes and booking overlap exclusion constraint

Revision ID: 0001_indexes_exclusion
Revises:
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa


revision = "0001_indexes_exclusion"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # btree_gist is required so the EXCLUDE constraint can use `=` on a uuid
    # (room_id) alongside the `&&` range overlap operator in one GiST index.
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_index(
        "ix_bookings_room_id_start_time",
        "bookings",
        ["room_id", "start_time"],
    )
    op.create_index(
        "ix_bookings_user_id",
        "bookings",
        ["user_id"],
    )
    op.create_index(
        "ix_bookings_org_id_status",
        "bookings",
        ["org_id", "status"],
    )
    op.create_index(
        "ix_availability_rules_room_id_day",
        "availability_rules",
        ["room_id", "day_of_week"],
    )

    op.execute(
        """
        ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
            room_id WITH =,
            tstzrange(start_time, end_time, '[)') WITH &&
        ) WHERE (status IN ('pending', 'confirmed'))
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap")

    op.drop_index("ix_availability_rules_room_id_day", table_name="availability_rules")
    op.drop_index("ix_bookings_org_id_status", table_name="bookings")
    op.drop_index("ix_bookings_user_id", table_name="bookings")
    op.drop_index("ix_bookings_room_id_start_time", table_name="bookings")

    op.execute("DROP EXTENSION IF EXISTS btree_gist")
