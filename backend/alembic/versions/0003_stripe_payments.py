"""stripe checkout session ids and purchase status

Revision ID: 0003_stripe_payments
Revises: 0002_drop_booking_package_redemption
Create Date: 2026-08-04

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_stripe_payments"
down_revision = "0002_drop_booking_package_redemption"
branch_labels = None
depends_on = None


purchase_status = postgresql.ENUM(
    "pending", "active", "cancelled", name="purchase_status", create_type=False
)


def upgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column("stripe_checkout_session_id", sa.String(255), nullable=True),
    )
    # Unique so a replayed webhook can never confirm a second booking.
    op.create_index(
        "uq_bookings_stripe_checkout_session_id",
        "bookings",
        ["stripe_checkout_session_id"],
        unique=True,
    )

    purchase_status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "user_package_purchases",
        sa.Column(
            "status",
            purchase_status,
            nullable=False,
            server_default="active",
        ),
    )
    op.add_column(
        "user_package_purchases",
        sa.Column("stripe_checkout_session_id", sa.String(255), nullable=True),
    )
    op.create_index(
        "uq_user_package_purchases_stripe_checkout_session_id",
        "user_package_purchases",
        ["stripe_checkout_session_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_user_package_purchases_stripe_checkout_session_id",
        table_name="user_package_purchases",
    )
    op.drop_column("user_package_purchases", "stripe_checkout_session_id")
    op.drop_column("user_package_purchases", "status")
    purchase_status.drop(op.get_bind(), checkfirst=True)

    op.drop_index("uq_bookings_stripe_checkout_session_id", table_name="bookings")
    op.drop_column("bookings", "stripe_checkout_session_id")
