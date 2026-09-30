"""Reset links (G03): issue, consume, invalidate.

The raw token exists only in the email; the table holds its SHA-256. One
live token per user: issuing a new one deletes the older unused rows, and
setting a password by any path deletes them all.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.password_reset import PasswordResetToken
from app.models.user import User

TOKEN_TTL = timedelta(minutes=60)


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def reset_link(raw: str) -> str:
    return f"{settings.FRONTEND_URL}/reset-password/{raw}"


async def invalidate_open(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None)
        )
    )


async def issue(
    db: AsyncSession, user: User, *, now: datetime, created_by_admin_id: uuid.UUID | None = None
) -> str:
    """A fresh raw token for `user`, its hash stored; the older unused ones are gone."""
    await invalidate_open(db, user.id)
    raw = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_hash(raw),
            expires_at=now + TOKEN_TTL,
            created_by_admin_id=created_by_admin_id,
            created_at=now,
        )
    )
    await db.flush()
    return raw


async def consume(db: AsyncSession, raw: str, *, now: datetime) -> PasswordResetToken | None:
    """The token's row if it is live — unused and not expired — locked; else None."""
    row = await db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == _hash(raw))
        .with_for_update()
    )
    if row is None or row.used_at is not None or row.expires_at <= now:
        return None
    return row


async def set_password(db: AsyncSession, user: User, password_hash: str) -> None:
    """The one way a password changes: hash in, every session and open link out."""
    user.password_hash = password_hash
    user.token_version += 1
    await invalidate_open(db, user.id)
    await db.flush()
