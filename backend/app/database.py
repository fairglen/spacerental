from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

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
    """Declarative base and the schema's source of truth.

    `Base.metadata.create_all` is used by the test fixtures only (see
    tests/conftest.py). Every other database — dev, CI, production — is built
    and migrated by alembic; the container entrypoint runs `alembic upgrade
    head` before uvicorn starts. Do not reintroduce a create_all call in the
    application: two code paths claiming to own schema creation is exactly the
    divergence that made `alembic upgrade head` impossible to run (TODO T8).
    """


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
