"""Users, as an operator sees them (A05): the org's members, one customer's
page, the admin role, and complimentary hours.

Everything here is scoped to the operator's organisation through the
membership row: a person who is not a member is not there, whatever their id.
"""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import clock
from app.auth import require_admin
from app.database import get_db
from app.models.booking import Booking
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import Package, PurchaseStatus, UserPackagePurchase
from app.models.support import SupportRequest
from app.models.user import User
from app.schemas.admin_users import ComplimentaryHoursCreate, ExpiryUpdate, OrgUserOut, RoleUpdate
from app.schemas.booking import AdminBookingOut
from app.schemas.package import AdminPurchaseOut
from app.schemas.support import SupportRequestOut

router = APIRouter(prefix="/admin/users", tags=["admin-users"])
# A customer's purchases, addressed by their own id (A06).
purchases_router = APIRouter(prefix="/admin/purchases", tags=["admin-users"])


async def _membership(
    db: AsyncSession, user_id: uuid.UUID, org_id: uuid.UUID
) -> OrganizationMember:
    row = await db.scalar(
        select(OrganizationMember)
        .options(selectinload(OrganizationMember.user))
        .where(OrganizationMember.user_id == user_id, OrganizationMember.org_id == org_id)
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return row


def _row(member: OrganizationMember, bookings_count: int) -> OrgUserOut:
    return OrgUserOut(
        id=member.user.id,
        email=member.user.email,
        name=member.user.name,
        role=member.role,
        joined_at=member.created_at,
        bookings_count=bookings_count,
        created_at=member.user.created_at,
    )


@router.get("")
async def admin_list_users(
    org_id: uuid.UUID = Query(...),
    q: str | None = Query(default=None, max_length=200),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The org's members (not only those who booked), searchable by name or
    email, with how many bookings each has here."""
    where = [OrganizationMember.org_id == org_id]
    if q:
        needle = f"%{q.strip().lower()}%"
        where.append(or_(func.lower(User.email).like(needle), func.lower(User.name).like(needle)))
    base = (
        select(OrganizationMember).join(User, User.id == OrganizationMember.user_id).where(*where)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    result = await db.execute(
        base.options(selectinload(OrganizationMember.user))
        .order_by(func.lower(User.name), User.email)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    members = result.scalars().all()
    counts = dict(
        (
            await db.execute(
                select(Booking.user_id, func.count())
                .where(Booking.org_id == org_id, Booking.user_id.in_([m.user_id for m in members]))
                .group_by(Booking.user_id)
            )
        ).all()
    )
    return {
        "users": [_row(m, counts.get(m.user_id, 0)) for m in members],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{user_id}")
async def admin_get_user(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One customer: their bookings, purchases and help requests IN THIS ORG."""
    member = await _membership(db, user_id, org_id)
    bookings = (
        (
            await db.execute(
                select(Booking)
                .options(selectinload(Booking.room))
                .where(Booking.user_id == user_id, Booking.org_id == org_id)
                .order_by(Booking.start_time.desc())
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    purchases = (
        (
            await db.execute(
                select(UserPackagePurchase)
                .options(selectinload(UserPackagePurchase.package))
                .where(UserPackagePurchase.user_id == user_id, UserPackagePurchase.org_id == org_id)
                .order_by(UserPackagePurchase.purchased_at.desc())
            )
        )
        .scalars()
        .all()
    )
    requests = (
        (
            await db.execute(
                select(SupportRequest)
                .options(selectinload(SupportRequest.booking).selectinload(Booking.room))
                .where(SupportRequest.user_id == user_id, SupportRequest.org_id == org_id)
                .order_by(SupportRequest.created_at.desc())
                .limit(50)
            )
        )
        .scalars()
        .all()
    )
    return {
        "user": _row(member, len(bookings)),
        "bookings": [AdminBookingOut.model_validate(b) for b in bookings],
        "purchases": [AdminPurchaseOut.model_validate(p) for p in purchases],
        "support_requests": [SupportRequestOut.model_validate(r) for r in requests],
    }


@router.put("/{user_id}/role")
async def admin_set_role(
    user_id: uuid.UUID,
    body: RoleUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Make a member an admin of THIS org, or an admin a member again.

    Per org: the same person may be an admin here and a member elsewhere. An
    operator cannot change their own role (the way out of admin is another
    admin), and an owner's role is not this endpoint's business.
    """
    if user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot change your own role"
        )
    member = await _membership(db, user_id, org_id)
    if member.role is MemberRole.owner:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An owner's role cannot be changed here",
        )
    member.role = MemberRole(body.role)
    await db.flush()
    count = await db.scalar(
        select(func.count()).where(Booking.user_id == user_id, Booking.org_id == org_id)
    )
    return {"user": _row(member, count or 0)}


@router.post("/{user_id}/complimentary-hours", status_code=status.HTTP_201_CREATED)
async def admin_grant_hours(
    user_id: uuid.UUID,
    body: ComplimentaryHoursCreate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Complimentary hours: a purchase of N hours at 0,00 € with a reason.

    Policy (A05): a purchase row, not a special balance, so the customer's
    packs page, the redemption ledger, cancellations and the reports all treat
    it exactly like a bought pack; `amount_paid` = 0 is what tells them apart.
    Expiry defaults to the package's validity from now.
    """
    await _membership(db, user_id, org_id)
    package = await db.scalar(
        select(Package).where(Package.id == body.package_id, Package.org_id == org_id)
    )
    if package is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Package not found")
    now = clock.utcnow()
    expires_at = body.expires_at or now + timedelta(days=package.validity_days)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="expires_at must be in the future"
        )
    purchase = UserPackagePurchase(
        user_id=user_id,
        package_id=package.id,
        org_id=org_id,
        hours_total=body.hours,
        hours_used=0,
        hours_remaining=body.hours,
        amount_paid=0,
        admin_note=body.reason,
        purchased_at=now,
        expires_at=expires_at,
        status=PurchaseStatus.active,
    )
    db.add(purchase)
    await db.flush()
    row = await db.scalar(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(UserPackagePurchase.id == purchase.id)
        .execution_options(populate_existing=True)
    )
    return {"purchase": AdminPurchaseOut.model_validate(row)}


@purchases_router.put("/{purchase_id}/expiry")
async def admin_extend_purchase(
    purchase_id: uuid.UUID,
    body: ExpiryUpdate,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """ "Prolongar validade" (A06): push a purchase's expiry later.

    Extending only — a later date than today's expiry and in the future; a
    lapsed pack may be brought back this way (that is the usual reason). The
    reason is appended to the purchase's note, dated, so the row tells its
    own story until there is an audit log (O05).
    """
    purchase = await db.scalar(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(UserPackagePurchase.id == purchase_id, UserPackagePurchase.org_id == org_id)
        .with_for_update(of=UserPackagePurchase)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found")
    if purchase.status is not PurchaseStatus.active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A {purchase.status.value} purchase cannot be extended",
        )
    now = clock.utcnow()
    if body.expires_at <= now or body.expires_at <= purchase.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="expires_at must be later than the current expiry and in the future",
        )
    line = (
        f"[{now:%Y-%m-%d}] Validade: {purchase.expires_at:%Y-%m-%d} → "
        f"{body.expires_at:%Y-%m-%d}. {body.reason}"
    )
    purchase.admin_note = f"{purchase.admin_note}\n{line}" if purchase.admin_note else line
    purchase.expires_at = body.expires_at
    await db.flush()
    return {"purchase": AdminPurchaseOut.model_validate(purchase)}
