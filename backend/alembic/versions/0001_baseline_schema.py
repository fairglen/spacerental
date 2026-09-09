"""baseline schema

Revision ID: 0001_baseline_schema
Revises:
Create Date: 2026-09-01

This is the single source of truth for the schema. It was generated with
`alembic revision --autogenerate` against an empty database, so it reproduces
`Base.metadata` exactly; `alembic check` in CI keeps the two in step.

It replaces the previous 0001/0002/0003 chain, which described a path from a
schema that never existed as a migration (tables were only ever created by
`Base.metadata.create_all`) to one that `create_all` already produced. That
chain could not run against any database — empty or existing.

The one object here that `Base.metadata` does NOT describe is the
`bookings_no_overlap` EXCLUDE constraint: it needs conflict-free data to be
applied, so it is deliberately owned by migrations alone and is not created by
`create_all` in the test fixtures. `alembic check` does not compare EXCLUDE
constraints, so this stays a documented exception rather than a silent drift.

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# Keep revision ids <= 32 chars: alembic's alembic_version.version_num is
# varchar(32) and a longer id fails to stamp with StringDataRightTruncationError.
revision = '0001_baseline_schema'
down_revision = None
branch_labels = None
depends_on = None

# Enum types are created implicitly by create_table but are NOT dropped by
# drop_table (alembic reflects a bare Table, so SQLAlchemy's ENUM drop hook
# never fires). Downgrade drops them by hand, otherwise a downgrade→upgrade
# round-trip dies with DuplicateObjectError.
ENUM_TYPES = ("org_plan", "member_role", "purchase_status", "booking_status", "payment_method")


def upgrade() -> None:
    # uuid-ossp backs the uuid_generate_v4() column defaults below; btree_gist
    # lets the EXCLUDE constraint combine `=` on a uuid with `&&` on a range in
    # one GiST index. Extensions are database-level prerequisites owned by the
    # DBA as much as by us, so IF NOT EXISTS is the correct form here.
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table('organizations',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('slug', sa.String(length=100), nullable=False),
    sa.Column('plan', sa.Enum('starter', 'pro', 'enterprise', name='org_plan'), server_default='starter', nullable=False),
    sa.Column('settings', sa.JSON(), server_default='{}', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('users',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=True),
    sa.Column('password_hash', sa.Text(), nullable=True),
    sa.Column('avatar_url', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_table('organization_members',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('role', sa.Enum('owner', 'admin', 'member', name='member_role'), server_default='member', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('org_id', 'user_id', name='uq_org_user')
    )
    op.create_table('packages',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('hours', sa.Integer(), nullable=False),
    sa.Column('price', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('validity_days', sa.Integer(), server_default='365', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('spaces',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('address', sa.Text(), nullable=True),
    sa.Column('city', sa.String(length=100), nullable=True),
    sa.Column('images', postgresql.ARRAY(sa.Text()), server_default='{}', nullable=False),
    sa.Column('amenities', postgresql.ARRAY(sa.Text()), server_default='{}', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('rooms',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('space_id', sa.UUID(), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('name', sa.String(length=255), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('capacity', sa.Integer(), server_default='1', nullable=False),
    sa.Column('hourly_rate', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('images', postgresql.ARRAY(sa.Text()), server_default='{}', nullable=False),
    sa.Column('amenities', postgresql.ARRAY(sa.Text()), server_default='{}', nullable=False),
    sa.Column('color', sa.String(length=20), server_default='#6366f1', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['space_id'], ['spaces.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('user_package_purchases',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('package_id', sa.UUID(), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('hours_total', sa.Numeric(precision=5, scale=2), nullable=False),
    sa.Column('hours_used', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
    sa.Column('hours_remaining', sa.Numeric(precision=5, scale=2), nullable=False),
    sa.Column('status', sa.Enum('pending', 'active', 'cancelled', name='purchase_status'), server_default='active', nullable=False),
    sa.Column('stripe_checkout_session_id', sa.String(length=255), nullable=True),
    sa.Column('purchased_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['package_id'], ['packages.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('stripe_checkout_session_id')
    )
    op.create_table('availability_rules',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('day_of_week', sa.Integer(), nullable=False),
    sa.Column('open_time', sa.Time(), server_default='09:00:00', nullable=False),
    sa.Column('close_time', sa.Time(), server_default='20:00:00', nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_availability_rules_room_id_day', 'availability_rules', ['room_id', 'day_of_week'], unique=False)
    op.create_table('bookings',
    sa.Column('id', sa.UUID(), server_default=sa.text('uuid_generate_v4()'), nullable=False),
    sa.Column('org_id', sa.UUID(), nullable=False),
    sa.Column('room_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_hours', sa.Numeric(precision=5, scale=2), nullable=False),
    sa.Column('total_amount', sa.Numeric(precision=10, scale=2), nullable=False),
    sa.Column('status', sa.Enum('pending', 'confirmed', 'cancelled', 'completed', name='booking_status'), server_default='confirmed', nullable=False),
    sa.Column('payment_method', sa.Enum('hourly', 'package', name='payment_method'), server_default='hourly', nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('stripe_checkout_session_id', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organizations.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('stripe_checkout_session_id')
    )
    op.create_index('ix_bookings_org_id_status', 'bookings', ['org_id', 'status'], unique=False)
    op.create_index('ix_bookings_room_id_start_time', 'bookings', ['room_id', 'start_time'], unique=False)
    op.create_index('ix_bookings_user_id', 'bookings', ['user_id'], unique=False)

    # Belt-and-braces against the read-then-insert race in create_booking: two
    # concurrent requests can both pass the overlap SELECT, and only the database
    # can arbitrate. Partial, because cancelled/completed rows may overlap freely.
    op.execute(
        """
        ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
            room_id WITH =,
            tstzrange(start_time, end_time, '[)') WITH &&
        ) WHERE (status IN ('pending', 'confirmed'))
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DROP CONSTRAINT bookings_no_overlap")

    op.drop_index('ix_bookings_user_id', table_name='bookings')
    op.drop_index('ix_bookings_room_id_start_time', table_name='bookings')
    op.drop_index('ix_bookings_org_id_status', table_name='bookings')
    op.drop_table('bookings')
    op.drop_index('ix_availability_rules_room_id_day', table_name='availability_rules')
    op.drop_table('availability_rules')
    op.drop_table('user_package_purchases')
    op.drop_table('rooms')
    op.drop_table('spaces')
    op.drop_table('packages')
    op.drop_table('organization_members')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('organizations')

    for enum_name in ENUM_TYPES:
        op.execute(f"DROP TYPE {enum_name}")

    op.execute("DROP EXTENSION IF EXISTS btree_gist")
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp"')
