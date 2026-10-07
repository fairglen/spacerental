"""Billing (I-series): paid_at on bookings and purchases.

Revision ID: 0018_billing_paid_at_invoices
Revises: 0017_bookings_org_start_index
Create Date: 2026-10-07

I01 — `bookings.paid_at` and `user_package_purchases.paid_at`: the moment
money was received, set once on every money-receiving transition and never
moved (there are no refunds; a cancellation credits hours, K01). Indexed
with `org_id`, the statement's read. Backfilled from what the rows already
say, as an approximation the statement documents: a bought pack that is no
longer pending was paid at `purchased_at`; an hourly or mixed booking that
is confirmed, completed or paid-but-unfulfilled, a cancelled one that left a
cancellation credit (so it had been paid), and a manual booking with an
amount, were paid at `created_at`.
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_billing_paid_at_invoices"
down_revision = "0017_bookings_org_start_index"
branch_labels = None
depends_on = None

# The approximation, in the order it applies; tests/test_paid_at.py runs the
# same statements on a fixture ledger.
BACKFILL_STATEMENTS = (
    """
    UPDATE user_package_purchases
       SET paid_at = purchased_at
     WHERE paid_at IS NULL AND source = 'purchase' AND status <> 'pending'
    """,
    """
    UPDATE user_package_purchases
       SET paid_at = purchased_at
     WHERE paid_at IS NULL AND source = 'complimentary'
    """,
    """
    UPDATE bookings
       SET paid_at = created_at
     WHERE paid_at IS NULL
       AND payment_method IN ('hourly', 'mixed')
       AND status IN ('confirmed', 'completed', 'paid_unfulfilled')
    """,
    """
    UPDATE bookings b
       SET paid_at = b.created_at
     WHERE b.paid_at IS NULL
       AND b.status = 'cancelled'
       AND EXISTS (
           SELECT 1 FROM user_package_purchases p
            WHERE p.source = 'cancellation_credit' AND p.source_booking_id = b.id
       )
    """,
    """
    UPDATE bookings
       SET paid_at = created_at
     WHERE paid_at IS NULL
       AND payment_method = 'manual'
       AND total_amount > 0
       AND status IN ('confirmed', 'completed')
    """,
)


def upgrade() -> None:
    # I01
    op.add_column("bookings", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "user_package_purchases",
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_bookings_org_id_paid_at", "bookings", ["org_id", "paid_at"])
    op.create_index(
        "ix_user_package_purchases_org_id_paid_at",
        "user_package_purchases",
        ["org_id", "paid_at"],
    )
    for statement in BACKFILL_STATEMENTS:
        op.execute(sa.text(statement))


def downgrade() -> None:
    op.drop_index("ix_user_package_purchases_org_id_paid_at", table_name="user_package_purchases")
    op.drop_index("ix_bookings_org_id_paid_at", table_name="bookings")
    op.drop_column("user_package_purchases", "paid_at")
    op.drop_column("bookings", "paid_at")
