"""Purchases record what was paid and an operator note (A05).

Revision ID: 0010_purchase_amount_paid
Revises: 0009_room_blocks
Create Date: 2026-09-22

Generated with `alembic revision --autogenerate`, then reviewed. Added by
hand: the backfill. Every purchase that exists before this migration was
bought through checkout at the package's price (complimentary hours did not
exist yet), so `amount_paid` is copied from the package rather than left at
the column default of 0 — otherwise every historical pack would look like a
gift in the reports. The downgrade drops the columns; the price is still on
the package, so nothing is lost for those rows.
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_purchase_amount_paid"
down_revision = "0009_room_blocks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_package_purchases",
        sa.Column("amount_paid", sa.Numeric(10, 2), server_default="0", nullable=False),
    )
    op.add_column("user_package_purchases", sa.Column("admin_note", sa.Text(), nullable=True))
    op.execute(
        "UPDATE user_package_purchases AS p SET amount_paid = k.price "
        "FROM packages AS k WHERE k.id = p.package_id"
    )


def downgrade() -> None:
    op.drop_column("user_package_purchases", "admin_note")
    op.drop_column("user_package_purchases", "amount_paid")
