import uuid
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.organization import MemberRole, OrganizationMember
from app.models.user import User

ALGORITHM = "HS256"

# Argon2id — OWASP recommended parameters (2024)
# m=65536 (64 MiB), t=3 iterations, p=4 parallelism
_ph = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def token_claims(user: User, *, role: str, memberships: list[dict] | None = None) -> dict:
    """The claims every login/registration token carries, in one place: the
    version claim (`tv`) is what lets a password change revoke it (G03)."""
    claims = {
        "sub": str(user.id),
        "email": user.email,
        "name": user.name,
        "role": role,
        "tv": user.token_version,
    }
    if memberships is not None:
        claims["memberships"] = memberships
    return claims


def create_access_token(data: dict) -> str:
    payload = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload["exp"] = expire
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception from None

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    # A token issued before the last password change or anonymisation carries
    # an older version (or none: read as 0, what every account started at).
    if payload.get("tv", 0) != user.token_version:
        raise credentials_exception
    if user.disabled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_optional_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    if token is None:
        return None
    try:
        return await get_current_user(token=token, db=db)
    except HTTPException:
        return None


async def require_admin(
    org_id: uuid.UUID = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.org_id == org_id,
            OrganizationMember.role.in_([MemberRole.admin, MemberRole.owner]),
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have admin access to this organization",
        )

    return user


async def require_owner(
    org_id: uuid.UUID = Query(...),
    user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> User:
    """The organisation's owner only (G04): what admins may read but not
    change. Built on `require_admin`, so an owner route is an operator route
    first (the S01 matrix checks that) and refuses everyone else the same way."""
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.org_id == org_id,
            OrganizationMember.role == MemberRole.owner,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the organisation's owner can do this",
        )

    return user
