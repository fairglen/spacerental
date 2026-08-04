import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.organization import OrganizationMember
from app.models.user import User
from app.payments import (
    CheckoutKind,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.package import (
    PackageOut,
    PackagePurchaseBody,
    PackagePurchaseCheckoutOut,
    UserPackagePurchaseOut,
)

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
    gateway: PaymentGateway = Depends(get_payment_gateway),
):
    """Purchase a package.

    Same Checkout Session + webhook pattern as bookings: the purchase is
    recorded `pending` and only the `checkout.session.completed` webhook marks
    it `active`, i.e. makes its hours spendable.
    """
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
        status=PurchaseStatus.pending,
    )
    db.add(purchase)
    await db.flush()

    try:
        session = await gateway.create_checkout_session(
            amount=package.price,
            description=f"{package.name} — {package.hours}h",
            kind=CheckoutKind.package_purchase,
            reference_id=purchase.id,
            org_id=purchase.org_id,
        )
    except PaymentProviderError as exc:
        # get_db rolls back on the raised exception — no dangling purchase.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not start the payment session",
        ) from exc
    purchase.stripe_checkout_session_id = session.id
    await db.flush()
    await db.refresh(purchase)

    return PackagePurchaseCheckoutOut(
        purchase=UserPackagePurchaseOut.model_validate(purchase),
        checkout_url=session.url,
    )


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
