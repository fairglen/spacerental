import re
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, verify_password, create_access_token, get_current_user
from app.database import get_db
from app.models.user import User
from app.models.organization import Organization, OrganizationMember, MemberRole, OrgPlan
from app.schemas.user import UserOut, UserRegister, UserLogin, TokenOut
from app.schemas.organization import OrgMembershipOut

router = APIRouter(prefix="/auth", tags=["auth"])


async def _get_highest_role(user: User, db: AsyncSession) -> str:
    result = await db.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user.id)
    )
    memberships = result.scalars().all()
    roles = {m.role for m in memberships}
    if MemberRole.owner in roles:
        return "owner"
    if MemberRole.admin in roles:
        return "admin"
    return "member"


async def _create_default_org(user: User, db: AsyncSession) -> OrganizationMember:
    base = re.sub(r"[^a-z0-9]+", "-", (user.name or user.email.split("@")[0]).lower()).strip("-")
    slug_candidate = base[:90] or "my-space"
    counter = 1
    while True:
        existing = await db.execute(select(Organization).where(Organization.slug == slug_candidate))
        if existing.scalar_one_or_none() is None:
            break
        slug_candidate = f"{base}-{counter}"
        counter += 1

    org = Organization(
        name=f"{user.name or user.email}'s Space",
        slug=slug_candidate,
        plan=OrgPlan.starter,
        settings={},
    )
    db.add(org)
    await db.flush()

    membership = OrganizationMember(org_id=org.id, user_id=user.id, role=MemberRole.owner)
    db.add(membership)
    await db.flush()
    return membership


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()

    membership = await _create_default_org(user, db)
    await db.commit()
    await db.refresh(user)

    role = "owner"
    token = create_access_token({"sub": str(user.id), "email": user.email, "name": user.name, "role": role})
    return TokenOut(access_token=token, user=UserOut.model_validate(user), role=role)


@router.post("/login", response_model=TokenOut)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or user.password_hash is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    role = await _get_highest_role(user, db)
    token = create_access_token({"sub": str(user.id), "email": user.email, "name": user.name, "role": role})
    return TokenOut(access_token=token, user=UserOut.model_validate(user), role=role)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)
