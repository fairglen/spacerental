import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.package import Package, UserPackagePurchase
from app.models.organization import OrganizationMember
from app.models.user import User
from app.schemas.package import PackageOut, UserPackagePurchaseOut, PackagePurchaseBody

router = APIRouter(prefix="/packages", tags=["packages"])


@router.get("")
async def list_packages(
    org_id: uuid.UUID = Query(..., description="Organization ID"),
    db: AsyncSession = Depends(get_db),
):
    """List available packages for an org (public)."""
    result = await db.execute(
        select(Package).where(
            Package.org_id == org_id,
            Package.is_active == True,  # noqa: E712
        ).order_by(Package.hours.asc())
    )
    packages = result.scalars().all()
    return {"packages": [PackageOut.model_validate(p) for p in packages]}


@router.post("/{package_id}/purchase", status_code=status.HTTP_201_CREATED)
async def purchase_package(
    package_id: uuid.UUID,
    body: PackagePurchaseBody,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Purchase a package."""
    result = await db.execute(
        select(Package).where(
            Package.id == package_id,
            Package.org_id == body.org_id,
            Package.is_active == True,  # noqa: E712
        )
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")

    # Verify user is a member of this org
    result = await db.execute(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user.id,
            OrganizationMember.org_id == body.org_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this organization",
        )

    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(days=package.validity_days)
    hours_total = Decimal(str(package.hours))

    purchase = UserPackagePurchase(
        user_id=user.id,
        package_id=package.id,
        org_id=body.org_id,
        hours_total=hours_total,
        hours_used=Decimal("0"),
        hours_remaining=hours_total,
        purchased_at=now,
        expires_at=expires_at,
    )
    db.add(purchase)
    await db.flush()
    await db.refresh(purchase)

    return {"purchase": UserPackagePurchaseOut.model_validate(purchase)}


@router.get("/me")
async def my_packages(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """My package purchases and remaining hours."""
    result = await db.execute(
        select(UserPackagePurchase)
        .where(UserPackagePurchase.user_id == user.id)
        .order_by(UserPackagePurchase.expires_at.asc())
    )
    purchases = result.scalars().all()
    return {"purchases": [UserPackagePurchaseOut.model_validate(p) for p in purchases]}
