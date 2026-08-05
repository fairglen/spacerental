"""drop bookings.package_redemption_id

Revision ID: 0002_drop_pkg_redemption
Revises: 0001_indexes_exclusion
Create Date: 2026-06-11

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# Keep this <= 32 chars: alembic's alembic_version.version_num is varchar(32)
# and a longer id fails to stamp with StringDataRightTruncationError.
revision = "0002_drop_pkg_redemption"
down_revision = "0001_indexes_exclusion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("bookings", "package_redemption_id")


def downgrade() -> None:
    op.add_column(
        "bookings",
        sa.Column(
            "package_redemption_id",
            UUID(as_uuid=True),
            sa.ForeignKey("user_package_purchases.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
