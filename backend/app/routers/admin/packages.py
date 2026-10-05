"""Packages on sale: list, create, page, update, hard delete (G04)."""

import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit, clock, deletion
from app.auth import require_admin
from app.database import get_db
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.user import User
from app.schemas.package import PackageCreate, PackageDetailOut, PackageOut, PackageUpdate

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


# ─── Users ────────────────────────────────────────────────────────────────────


# ─── Packages ─────────────────────────────────────────────────────────────────


@router.get("/packages")
async def admin_list_packages(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Package).where(Package.org_id == org_id).order_by(Package.hours.asc())
    )
    packages = result.scalars().all()
    return {"packages": [PackageOut.model_validate(p) for p in packages]}


@router.post("/packages", status_code=status.HTTP_201_CREATED)
async def admin_create_package(
    body: PackageCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    package = Package(
        org_id=org_id,
        name=body.name,
        hours=body.hours,
        price=body.price,
        validity_days=body.validity_days,
    )
    db.add(package)
    await db.flush()
    await db.refresh(package)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=package,
        action="create",
        after=audit.snapshot(package),
    )
    return {"package": PackageOut.model_validate(package)}


@router.get("/packages/{package_id}")
async def admin_get_package(
    package_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One package for its page (G04): how many purchases, how many of them
    still spendable, and the hours still outstanding on those."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    now = clock.utcnow()
    total = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id)
    )
    live = UserPackagePurchase.status == PurchaseStatus.active
    unexpired = UserPackagePurchase.expires_at > now
    spendable = UserPackagePurchase.hours_remaining > 0
    active = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id, live, unexpired, spendable)
    )
    outstanding = await db.scalar(
        select(func.coalesce(func.sum(UserPackagePurchase.hours_remaining), 0)).where(
            UserPackagePurchase.package_id == package.id, live, unexpired, spendable
        )
    )
    return PackageDetailOut(
        package=PackageOut.model_validate(package),
        purchases={"total": total or 0, "active": active or 0},
        hours_outstanding=Decimal(outstanding or 0).quantize(Decimal("0.01")),
    )


@router.put("/packages/{package_id}")
async def admin_update_package(
    package_id: uuid.UUID,
    body: PackageUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Edit a package's price/hours/validity, or soft-deactivate it via is_active=false."""
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id)
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    before = audit.snapshot(package)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(package, field, value)

    await db.flush()
    await db.refresh(package)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=package,
        action="update",
        before=before,
        after=audit.snapshot(package),
    )
    return {"package": PackageOut.model_validate(package)}


@router.delete("/packages/{package_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_package(
    package_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hard delete (G02): only a package nobody ever bought or was granted;
    `is_active` is the everyday delete."""
    # Locked: a purchase being inserted waits on the package's row, so none
    # can cross the guard below and be cascaded away with the package.
    result = await db.execute(
        select(Package).where(Package.id == package_id, Package.org_id == org_id).with_for_update()
    )
    package = result.scalar_one_or_none()
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    deletion.require_confirm(confirm, package.id, package.name)
    purchases = await db.scalar(
        select(func.count())
        .select_from(UserPackagePurchase)
        .where(UserPackagePurchase.package_id == package.id)
    )
    if purchases:
        raise deletion.blocked(
            "The package has purchases; deactivate it instead", {"purchases": purchases}
        )
    before = audit.snapshot(package)
    await db.delete(package)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=package, action="delete", before=before
    )
