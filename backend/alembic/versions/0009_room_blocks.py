"""Blocked time: the room_blocks table (A02).

Revision ID: 0009_room_blocks
Revises: 0008_admin_booking_tools
Create Date: 2026-09-22

Generated with `alembic revision --autogenerate`, then reviewed. Added by
hand: the `room_blocks_no_overlap` EXCLUDE constraint, the same pattern as
`bookings_no_overlap` — two blocks on one room may not overlap. Like that one
it lives in the migration only and is invisible to `alembic check`, which
does not compare EXCLUDE constraints (CLAUDE.md §6.5). `btree_gist` was
already required by the baseline for the bookings constraint.
"""

import sqlalchemy as sa
from alembic import op

revision = "0009_room_blocks"
down_revision = "0008_admin_booking_tools"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "room_blocks",
        sa.Column("id", sa.UUID(), server_default=sa.text("uuid_generate_v4()"), nullable=False),
        sa.Column("org_id", sa.UUID(), nullable=False),
        sa.Column("room_id", sa.UUID(), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["room_id"], ["rooms.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_room_blocks_room_id_start_time", "room_blocks", ["room_id", "start_time"], unique=False
    )
    op.execute(
        """
        ALTER TABLE room_blocks ADD CONSTRAINT room_blocks_no_overlap EXCLUDE USING gist (
            room_id WITH =,
            tstzrange(start_time, end_time, '[)') WITH &&
        )
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE room_blocks DROP CONSTRAINT room_blocks_no_overlap")
    op.drop_index("ix_room_blocks_room_id_start_time", table_name="room_blocks")
    op.drop_table("room_blocks")
