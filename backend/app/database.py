from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import text
from app.config import settings


engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
)

async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
        from app.models import organization, user, space, booking, package  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        # Indexes for dev parity with alembic. The EXCLUDE constraint is
        # intentionally NOT created here — it requires clean data and lives
        # in the alembic migration.
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_bookings_room_id_start_time "
            "ON bookings (room_id, start_time)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_bookings_user_id "
            "ON bookings (user_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_bookings_org_id_status "
            "ON bookings (org_id, status)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_availability_rules_room_id_day "
            "ON availability_rules (room_id, day_of_week)"
        ))
