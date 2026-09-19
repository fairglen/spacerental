"""Space location: postal_code, latitude, longitude (C10).

Revision ID: 0004_space_location
Revises: 0003_booking_holds
Create Date: 2026-09-19

The three columns came from `alembic revision --autogenerate`. The CHECK
constraints were added by hand: autogenerate does not compare CHECK
constraints, so `alembic check` neither emits nor misses them. They are
declared on the model too (`Space.__table_args__`), so the test schema built
from `Base.metadata` enforces the same rules as a migrated one.

Every column is nullable and every existing row has both coordinates NULL, so
the constraints hold on retained data the moment they are added. No timezone
column here: that belongs to R01.
"""

import sqlalchemy as sa
from alembic import op

# Keep revision ids <= 32 chars: alembic's alembic_version.version_num is
# varchar(32) and a longer id fails to stamp with StringDataRightTruncationError.
revision = "0004_space_location"
down_revision = "0003_booking_holds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("spaces", sa.Column("postal_code", sa.String(length=20), nullable=True))
    op.add_column("spaces", sa.Column("latitude", sa.Numeric(precision=9, scale=6), nullable=True))
    op.add_column("spaces", sa.Column("longitude", sa.Numeric(precision=9, scale=6), nullable=True))
    op.create_check_constraint(
        "ck_spaces_coordinates_together", "spaces", "(latitude IS NULL) = (longitude IS NULL)"
    )
    op.create_check_constraint("ck_spaces_latitude_range", "spaces", "latitude BETWEEN -90 AND 90")
    op.create_check_constraint(
        "ck_spaces_longitude_range", "spaces", "longitude BETWEEN -180 AND 180"
    )


def downgrade() -> None:
    op.drop_constraint("ck_spaces_longitude_range", "spaces", type_="check")
    op.drop_constraint("ck_spaces_latitude_range", "spaces", type_="check")
    op.drop_constraint("ck_spaces_coordinates_together", "spaces", type_="check")
    op.drop_column("spaces", "longitude")
    op.drop_column("spaces", "latitude")
    op.drop_column("spaces", "postal_code")
