"""Cancellation credit in hours (K01): purchases carry their source.

Revision ID: 0016_cancellation_credit
Revises: 0015_support_triage
Create Date: 2026-10-01

`user_package_purchases.source` says where a row came from — bought,
granted, or credited for a cancelled paid booking — and the credit rows
point at that booking (`source_booking_id`, unique: one credit per booking,
ever). A credit belongs to no package, so `package_id` becomes nullable.
Backfill: a row paid 0,00 with no Checkout Session was granted
(complimentary); every other row was bought. The downgrade deletes the
credit rows (they have no package to fall back to) before restoring the
constraint.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016_cancellation_credit"
down_revision = "0015_support_triage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    source = postgresql.ENUM(
        "purchase", "complimentary", "cancellation_credit", name="purchase_source"
    )
    source.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "user_package_purchases",
        sa.Column(
            "source",
            sa.Enum(
                "purchase",
                "complimentary",
                "cancellation_credit",
                name="purchase_source",
                create_type=False,
            ),
            server_default="purchase",
            nullable=False,
        ),
    )
    op.execute(
        "UPDATE user_package_purchases SET source = 'complimentary' "
        "WHERE amount_paid = 0 AND stripe_checkout_session_id IS NULL"
    )
    op.add_column(
        "user_package_purchases",
        sa.Column("source_booking_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_user_package_purchases_source_booking_id",
        "user_package_purchases",
        "bookings",
        ["source_booking_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_user_package_purchases_source_booking_id",
        "user_package_purchases",
        ["source_booking_id"],
    )
    op.alter_column("user_package_purchases", "package_id", nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM user_package_purchases WHERE package_id IS NULL")
    op.alter_column("user_package_purchases", "package_id", nullable=False)
    op.drop_constraint(
        "uq_user_package_purchases_source_booking_id", "user_package_purchases", type_="unique"
    )
    op.drop_constraint(
        "fk_user_package_purchases_source_booking_id", "user_package_purchases", type_="foreignkey"
    )
    op.drop_column("user_package_purchases", "source_booking_id")
    op.drop_column("user_package_purchases", "source")
    op.execute("DROP TYPE purchase_source")
