"""Spaces carry their clock: `timezone` (R01, opening-hours slice).

Revision ID: 0012_space_timezone
Revises: 0011_booking_package_debits
Create Date: 2026-09-23

Generated with `alembic revision --autogenerate`, then reviewed. Every
existing space gets `Europe/Lisbon` through the server default: the pilot
has one location, and its rules were always written as Lisbon numbers
(08:00-22:00 means the door), so from this migration on they are read that
way. No rule row and no booking instant is rewritten — a paid appointment
keeps the UTC instant it was booked at. The downgrade drops the column; the
rules then read as UTC again, as before.
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_space_timezone"
down_revision = "0011_booking_package_debits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "spaces",
        sa.Column("timezone", sa.String(length=64), server_default="Europe/Lisbon", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("spaces", "timezone")
