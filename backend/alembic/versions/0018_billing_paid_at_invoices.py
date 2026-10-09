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

I04 — `users.tax_id` (a 9-digit Portuguese NIF), `billing_name`,
`billing_address`: what an issued invoice names.

I05 — `invoices` and `invoice_items`: records of invoices the operator
issued elsewhere (AT-certified software), linked to the transactions they
cover; one of `booking_id`/`purchase_id` per item, each unique — a
transaction is invoiced once.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018_billing_paid_at_invoices"
down_revision = "0017_bookings_org_start_index"
branch_labels = None
depends_on = None

# The approximation, in the order it applies; tests/test_paid_at.py runs the
# same statements on a fixture ledger.
#
# Every enum column is compared as text (B62). `'mixed'`, `'manual'` and
# `'paid_unfulfilled'` were added by `ALTER TYPE … ADD VALUE` in 0003, 0005
# and 0008; on an empty database the whole chain runs in one transaction and
# PostgreSQL refuses to use those values before it commits ("unsafe use of
# new value \"mixed\" of enum type payment_method"), which broke CI's
# `migrations` job and any fresh clone. A developer's database had them
# committed long ago, so `docker compose up` never saw it. Casting the column
# to text compares labels and never touches the enum's new values.
BACKFILL_STATEMENTS = (
    """
    UPDATE user_package_purchases
       SET paid_at = purchased_at
     WHERE paid_at IS NULL AND source::text = 'purchase' AND status::text <> 'pending'
    """,
    """
    UPDATE user_package_purchases
       SET paid_at = purchased_at
     WHERE paid_at IS NULL AND source::text = 'complimentary'
    """,
    """
    UPDATE bookings
       SET paid_at = created_at
     WHERE paid_at IS NULL
       AND payment_method::text IN ('hourly', 'mixed')
       AND status::text IN ('confirmed', 'completed', 'paid_unfulfilled')
    """,
    """
    UPDATE bookings b
       SET paid_at = b.created_at
     WHERE b.paid_at IS NULL
       AND b.status::text = 'cancelled'
       AND EXISTS (
           SELECT 1 FROM user_package_purchases p
            WHERE p.source::text = 'cancellation_credit' AND p.source_booking_id = b.id
       )
    """,
    """
    UPDATE bookings
       SET paid_at = created_at
     WHERE paid_at IS NULL
       AND payment_method::text = 'manual'
       AND total_amount > 0
       AND status::text IN ('confirmed', 'completed')
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

    # I04
    op.add_column("users", sa.Column("tax_id", sa.String(length=9), nullable=True))
    op.add_column("users", sa.Column("billing_name", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("billing_address", sa.Text(), nullable=True))

    # I05
    op.create_table(
        "invoices",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("number", sa.String(length=64), nullable=False),
        sa.Column("issued_at", sa.Date(), nullable=False),
        sa.Column("period_from", sa.Date(), nullable=False),
        sa.Column("period_to", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("hours", sa.Numeric(6, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="EUR", nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("pdf_key", sa.Text(), nullable=True),
        sa.Column("created_by_admin_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_admin_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "number", name="uq_invoices_org_id_number"),
    )
    op.create_index("ix_invoices_org_id_issued_at", "invoices", ["org_id", "issued_at"])
    op.create_index("ix_invoices_user_id", "invoices", ["user_id"])
    op.create_table(
        "invoice_items",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("uuid_generate_v4()"),
            nullable=False,
        ),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("booking_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("purchase_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["purchase_id"], ["user_package_purchases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "(booking_id IS NOT NULL)::int + (purchase_id IS NOT NULL)::int = 1",
            name="ck_invoice_items_one_transaction",
        ),
        sa.UniqueConstraint("booking_id", name="uq_invoice_items_booking_id"),
        sa.UniqueConstraint("purchase_id", name="uq_invoice_items_purchase_id"),
    )
    op.create_index("ix_invoice_items_invoice_id", "invoice_items", ["invoice_id"])


def downgrade() -> None:
    op.drop_index("ix_invoice_items_invoice_id", table_name="invoice_items")
    op.drop_table("invoice_items")
    op.drop_index("ix_invoices_user_id", table_name="invoices")
    op.drop_index("ix_invoices_org_id_issued_at", table_name="invoices")
    op.drop_table("invoices")
    op.drop_column("users", "billing_address")
    op.drop_column("users", "billing_name")
    op.drop_column("users", "tax_id")
    op.drop_index("ix_user_package_purchases_org_id_paid_at", table_name="user_package_purchases")
    op.drop_index("ix_bookings_org_id_paid_at", table_name="bookings")
    op.drop_column("user_package_purchases", "paid_at")
    op.drop_column("bookings", "paid_at")
