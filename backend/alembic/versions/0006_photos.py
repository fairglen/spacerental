"""Room and space photos: a `photos` JSONB list on rooms and spaces (C14).

Revision ID: 0006_photos
Revises: 0005_booking_mixed_payment
Create Date: 2026-09-22

The two columns came from `alembic revision --autogenerate`; the backfill was
added by hand. `images` (a list of external URLs an operator could set through
the API) is left exactly as it is, so no client of the API sees a change. Each
URL already there is also carried into `photos` as an entry without files of
ours — `{id, url, thumb_url, width: null, height: null}` — so nothing an
operator configured disappears from the customer-facing carousel, which reads
`photos` only. Uploaded photos are `{id, key, thumb_key, width, height}`.

Downgrade drops the columns. Files under MEDIA_ROOT are not touched by a schema
migration; they become unreferenced and can be removed by hand.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006_photos"
down_revision = "0005_booking_mixed_payment"
branch_labels = None
depends_on = None

_BACKFILL = """
    UPDATE {table} AS t
    SET photos = (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', uuid_generate_v4()::text,
                'url', u.url, 'thumb_url', u.url, 'width', NULL, 'height', NULL
            )
            ORDER BY u.position
        )
        FROM unnest(t.images) WITH ORDINALITY AS u(url, position)
    )
    WHERE cardinality(t.images) > 0
"""


def upgrade() -> None:
    for table in ("rooms", "spaces"):
        op.add_column(
            table,
            sa.Column(
                "photos",
                postgresql.JSONB(astext_type=sa.Text()),
                server_default="[]",
                nullable=False,
            ),
        )
        op.execute(_BACKFILL.format(table=table))


def downgrade() -> None:
    op.drop_column("spaces", "photos")
    op.drop_column("rooms", "photos")
