"""One mailbox, one account (B67, closing B37): users.email_normalized.

Revision ID: 0019_users_email_normalized
Revises: 0018_billing_paid_at_invoices
Create Date: 2026-10-14

`users.email` stays the address as typed (what we send to); the new column
is the identity every lookup compares: lowercased, the `+tag` dropped from
the local part, and for gmail.com/googlemail.com the dots in the local part
removed — the same rule as app/emails.py, in SQL. Backfilled here, then a
unique index.

A collision — two existing rows that normalise to one — fails this
migration loudly, naming the addresses: accounts are never merged by a
migration (B37's acceptance). The operator resolves it by hand first.
"""

import sqlalchemy as sa
from alembic import op

revision = "0019_users_email_normalized"
down_revision = "0018_billing_paid_at_invoices"
branch_labels = None
depends_on = None

# The SQL twin of app.emails.normalize_email: lower, the local part up to a
# `+`, Gmail dots removed, the domain lowered.
NORMALIZED_SQL = """
    CASE
        WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com')
        THEN replace(split_part(lower(split_part(email, '@', 1)), '+', 1), '.', '')
        ELSE split_part(lower(split_part(email, '@', 1)), '+', 1)
    END || '@' || lower(split_part(email, '@', 2))
"""

BACKFILL = sa.text(f"UPDATE users SET email_normalized = {NORMALIZED_SQL}")

COLLISIONS = sa.text(
    """
    SELECT email_normalized, string_agg(email, ', ' ORDER BY email) AS emails
    FROM users
    GROUP BY email_normalized
    HAVING count(*) > 1
    ORDER BY email_normalized
    """
)


def backfill_and_check(connection) -> None:
    """Fill the column from `email` and refuse to go on if two rows share
    an identity. tests/test_emails.py runs this on a fixture with a
    collision and expects the error."""
    connection.execute(BACKFILL)
    collisions = connection.execute(COLLISIONS).all()
    if collisions:
        listing = "; ".join(f"{row.email_normalized}: {row.emails}" for row in collisions)
        raise RuntimeError(
            "0019: these accounts share one mailbox once normalised and must be "
            f"resolved by hand before the unique index can exist — {listing}"
        )


def upgrade() -> None:
    op.add_column("users", sa.Column("email_normalized", sa.String(length=255), nullable=True))
    backfill_and_check(op.get_bind())
    op.alter_column("users", "email_normalized", nullable=False)
    op.create_index("ix_users_email_normalized", "users", ["email_normalized"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_email_normalized", table_name="users")
    op.drop_column("users", "email_normalized")
