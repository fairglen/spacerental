"""link bookings to the package purchase that paid for them

Cancelling a package-paid booking has to give the hours back to the *same*
purchase they were taken from — otherwise a user with two packages gets the
refund credited to whichever one a heuristic happens to pick. This column is
that link. NULL for every `hourly` booking, and for every booking that predates
package redemption.

`ON DELETE SET NULL` rather than CASCADE: losing the purchase must not delete
paid-for bookings. It only means a later cancellation finds nothing to credit,
which `package_hours.credit_hours` treats as a no-op.

Revision ID: 0002_booking_pkg_purchase
Revises: 0001_baseline_schema
Create Date: 2026-09-02

"""
import sqlalchemy as sa
from alembic import op

# Keep revision ids <= 32 chars: alembic's alembic_version.version_num is
# varchar(32) and a longer id fails to stamp with StringDataRightTruncationError.
revision = "0002_booking_pkg_purchase"
down_revision = "0001_baseline_schema"
branch_labels = None
depends_on = None

# Named rather than left to PostgreSQL so `downgrade()` has something to drop —
# autogenerate emits `op.drop_constraint(None, ...)`, which cannot run.
FK_NAME = "fk_bookings_package_purchase_id"


def upgrade() -> None:
    op.add_column(
        "bookings", sa.Column("package_purchase_id", sa.UUID(), nullable=True)
    )
    op.create_foreign_key(
        FK_NAME,
        "bookings",
        "user_package_purchases",
        ["package_purchase_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(FK_NAME, "bookings", type_="foreignkey")
    op.drop_column("bookings", "package_purchase_id")
