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


async def lock_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Every path that changes a user's tokens, password, email or standing
    takes the user's row lock first (user → tokens), so two concurrent
    requests cannot both delete the old token and both insert a replacement
    — one live link per user — and issue/consume/set_password never wait on
    each other in a cycle. The whole row is re-read under the lock
    (`populate_existing`), so a `User` the caller loaded before waiting
    reflects what the other transaction did: a changed address, a
    suspension, a bumped `token_version` (review on #65)."""
    return await db.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


_lock_user = lock_user


async def issue(
    db: AsyncSession, user: User, *, now: datetime, created_by_admin_id: uuid.UUID | None = None
) -> str | None:
    """A fresh raw token for `user`, its hash stored; the older unused ones
    are gone. None when the account turns out to be suspended under the
    lock — the link would go to someone who cannot use it."""
    await _lock_user(db, user.id)
    if user.disabled_at is not None:
        return None
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
    found = await db.scalar(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == _hash(raw))
    )
    if found is None:
        return None
    # User first, then the token (see `_lock_user`); re-read under the lock.
    await _lock_user(db, found.user_id)
    row = await db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.id == found.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if row is None or row.used_at is not None or row.expires_at <= now:
        return None
    return row


async def set_password(db: AsyncSession, user: User, password_hash: str) -> None:
    """The one way a password changes: hash in, every session and open link out."""
    await _lock_user(db, user.id)
    user.password_hash = password_hash
    user.token_version += 1
    await invalidate_open(db, user.id)
    await db.flush()
