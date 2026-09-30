"""Users, as an operator sees them (A05): the org's members, one customer's
page, the admin role, and complimentary hours.

Everything here is scoped to the operator's organisation through the
membership row: a person who is not a member is not there, whatever their id.
"""

import uuid
from datetime import timedelta
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock, deletion, email, package_hours, password_reset
from app.auth import hash_password, require_admin
from app.booking_validity import expire_user_holds
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.models.booking import Booking
from app.models.organization import MemberRole, OrganizationMember
from app.models.package import BookingPackageDebit, Package, PurchaseStatus, UserPackagePurchase
from app.models.password_reset import PasswordResetToken
from app.models.space import Room
from app.models.support import SupportRequest
from app.models.user import User
from app.payments import (
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.ratelimit import AUTH_TIER, rate_limit
from app.schemas.admin_users import (
    AdminUserCreate,
    AdminUserUpdate,
    AnonymisedUserOut,
    ComplimentaryHoursCreate,
    ConfirmBody,
    ExpiryUpdate,
    OrgUserOut,
    PurchaseAdjust,
    PurchaseDebitOut,
    PurchaseUpdate,
    PurchaseUserOut,
    RoleUpdate,
)
from app.schemas.booking import AdminBookingOut
from app.schemas.package import AdminPurchaseOut, PackageBalanceOut
from app.schemas.support import SupportRequestOut
from app.schemas.user import PasswordSet

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
        disabled_at=member.user.disabled_at,
        created_at=member.user.created_at,
    )


UserSort = Literal["name", "-name", "email", "-email", "joined_at", "-joined_at"]


@router.get("")
async def admin_list_users(
    org_id: uuid.UUID = Query(...),
    q: str | None = Query(default=None, max_length=200),
    role: MemberRole | None = Query(default=None),
    disabled: bool | None = Query(default=None),
    sort: UserSort = Query(default="name"),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The org's members (not only those who booked), searchable by name or
    email, filtered by role and suspension (G04), with how many bookings
    each has here."""
    where = [OrganizationMember.org_id == org_id]
    if q:
        needle = f"%{q.strip().lower()}%"
        where.append(or_(func.lower(User.email).like(needle), func.lower(User.name).like(needle)))
    if role is not None:
        where.append(OrganizationMember.role == role)
    if disabled is not None:
        where.append(User.disabled_at.isnot(None) if disabled else User.disabled_at.is_(None))
    base = (
        select(OrganizationMember).join(User, User.id == OrganizationMember.user_id).where(*where)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery()))
    column = {
        "name": func.lower(User.name),
        "email": func.lower(User.email),
        "joined_at": OrganizationMember.created_at,
    }[sort.lstrip("-")]
    order = column.desc() if sort.startswith("-") else column.asc()
    result = await db.execute(
        base.options(selectinload(OrganizationMember.user))
        .order_by(order, User.email)
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


@router.post("", status_code=status.HTTP_201_CREATED)
async def admin_create_user(
    body: AdminUserCreate,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
):
    """An account made by the operator (G04), enrolled here as a member.
    Without a password the person gets a "Defina a sua password" link (the
    reset flow's token, G03); with one, nothing is sent. The response never
    carries a password; the trail never sees one."""
    taken = await db.scalar(
        select(func.count()).select_from(User).where(func.lower(User.email) == body.email.lower())
    )
    if taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An account with this email exists"
        )
    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password) if body.password else None,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # A concurrent creation or registration with the same email won the
        # unique index between the lookup above and this insert.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An account with this email exists"
        ) from None
    member = OrganizationMember(org_id=org_id, user_id=user.id, role=MemberRole.member)
    db.add(member)
    await db.flush()
    await db.refresh(user)
    await db.refresh(member)
    member.user = user
    if not body.password:
        raw = await password_reset.issue(db, user, now=clock.utcnow(), created_by_admin_id=admin.id)
        email.enqueue_email(
            background_tasks,
            email_gateway,
            email.set_password_email(to=user.email, link=password_reset.reset_link(raw)),
        )
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=user,
        action="create",
        after={**audit.snapshot(user), "role": "member", "invited": not body.password},
    )
    return {"user": _row(member, 0)}


@router.put("/{user_id}")
async def admin_update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Name, email (409 when taken) and suspension (G02/G04): `disabled_at`
    set signs the person out everywhere and refuses their login and reset
    requests; an explicit null reactivates. Not your own account."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    changes = body.model_dump(exclude_unset=True)
    if "disabled_at" in changes and user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot suspend your own account"
        )
    # The account is global: renaming, re-addressing or suspending someone
    # who also belongs to another organisation would reach into that tenant.
    await _refuse_other_memberships(db, member)
    if "email" in changes and changes["email"].lower() != user.email.lower():
        taken = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(func.lower(User.email) == changes["email"].lower(), User.id != user.id)
        )
        if taken:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="An account with this email exists"
            )
    before = audit.snapshot(user)
    action = "update"
    if "disabled_at" in changes:
        was_disabled = user.disabled_at is not None
        now_disabled = changes["disabled_at"] is not None
        if now_disabled and not was_disabled:
            action = "suspend"
            # Signed out everywhere at once, not when the token happens to expire.
            user.token_version += 1
        elif was_disabled and not now_disabled:
            action = "reactivate"
    for field, value in changes.items():
        setattr(user, field, value)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="An account with this email exists"
        ) from None
    await db.refresh(user)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=user,
        action=action,
        before=before,
        after=audit.snapshot(user),
    )
    count = await db.scalar(
        select(func.count()).where(Booking.user_id == user_id, Booking.org_id == org_id)
    )
    return {"user": _row(member, count or 0)}


@router.get("/{user_id}")
async def admin_get_user(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One customer: their bookings, purchases and help requests IN THIS ORG."""
    member = await _membership(db, user_id, org_id)
    # Expiry is lazy: a lapsed mixed hold still has hours debited until
    # something reconciles it. The customer's own packs page does this; the
    # operator's view of the same bank must not read short, nor list debits
    # for a booking that holds nothing.
    now = clock.utcnow()
    await expire_user_holds(db, user_id, now)
    bookings = (
        (
            await db.execute(
                select(Booking)
                .options(
                    selectinload(Booking.room),
                    selectinload(Booking.package_debits)
                    .selectinload(BookingPackageDebit.purchase)
                    .selectinload(UserPackagePurchase.package),
                )
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
        # The same bank the customer sees on their packs page (H02).
        "balance": PackageBalanceOut.model_validate(
            package_hours.bank_balance(list(purchases), now)
        ),
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
    before = {"id": str(user_id), "role": member.role.value}
    member.role = MemberRole(body.role)
    await db.flush()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=member.user,
        action="role.set",
        before=before,
        after={"id": str(user_id), "role": member.role.value},
    )
    count = await db.scalar(
        select(func.count()).where(Booking.user_id == user_id, Booking.org_id == org_id)
    )
    return {"user": _row(member, count or 0)}


async def _refuse_self_and_last_owner(
    db: AsyncSession, admin: User, member: OrganizationMember
) -> None:
    """The two rules every membership-ending action shares (G02): not the
    operator's own account, and never the organisation's last owner."""
    if member.user_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot do this to your own account"
        )
    if member.role is MemberRole.owner:
        owners = await db.scalar(
            select(func.count())
            .select_from(OrganizationMember)
            .where(
                OrganizationMember.org_id == member.org_id,
                OrganizationMember.role == MemberRole.owner,
            )
        )
        if (owners or 0) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The organisation's last owner cannot be removed",
            )


async def _refuse_other_memberships(db: AsyncSession, member: OrganizationMember) -> None:
    """An account is global; an operator's authority is not. Anonymising or
    deleting someone who also belongs to another organisation would reach
    into that tenant, so it is refused (DECISION, TODO G02)."""
    elsewhere = await db.scalar(
        select(func.count())
        .select_from(OrganizationMember)
        .where(
            OrganizationMember.user_id == member.user_id,
            OrganizationMember.org_id != member.org_id,
        )
    )
    if elsewhere:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The user belongs to another organisation as well",
        )


async def _references(db: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    return {
        "bookings": await db.scalar(
            select(func.count()).select_from(Booking).where(Booking.user_id == user_id)
        )
        or 0,
        "purchases": await db.scalar(
            select(func.count())
            .select_from(UserPackagePurchase)
            .where(UserPackagePurchase.user_id == user_id)
        )
        or 0,
        "support_requests": await db.scalar(
            select(func.count())
            .select_from(SupportRequest)
            .where(SupportRequest.user_id == user_id)
        )
        or 0,
    }


@router.post("/{user_id}/anonymise")
async def admin_anonymise_user(
    user_id: uuid.UUID,
    body: ConfirmBody,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """ "Delete" for an account anything references (G02): the identity goes,
    the history stays. Name, email and avatar become placeholders, the
    password is gone, the account is disabled for good, every session and
    reset link dies, the membership here is removed; bookings, purchases and
    help requests keep pointing at the placeholder."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    deletion.require_confirm(body.confirm, user.id, user.email)
    await _refuse_self_and_last_owner(db, admin, member)
    await _refuse_other_memberships(db, member)
    before = audit.snapshot(user)
    short = deletion.short_id(user.id)
    user.email = f"utilizador-{short}@anon.invalid"
    user.name = "Utilizador removido"
    user.avatar_url = None
    user.password_hash = None
    user.disabled_at = clock.utcnow()
    user.token_version += 1
    await db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id))
    await db.delete(member)
    await db.flush()
    await db.refresh(user)
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=user,
        action="anonymise",
        before=before,
        after=audit.snapshot(user),
        reason=body.reason,
    )
    return {"user": AnonymisedUserOut.model_validate(user)}


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_user(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hard delete (G02): only an account nothing references — no booking,
    purchase or help request anywhere; otherwise 409 with the counts, and
    anonymisation is the way."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    deletion.require_confirm(confirm, user.id, user.email)
    await _refuse_self_and_last_owner(db, admin, member)
    await _refuse_other_memberships(db, member)
    references = await _references(db, user.id)
    if any(references.values()):
        raise deletion.blocked("The account is referenced; anonymise it instead", references)
    before = audit.snapshot(user)
    await db.delete(user)
    await db.flush()
    await audit.record(db, actor=admin, org_id=org_id, entity=user, action="delete", before=before)


@router.delete("/{user_id}/membership", status_code=status.HTTP_204_NO_CONTENT)
async def admin_remove_membership(
    user_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The person leaves THIS organisation (G02); the account itself is
    untouched. Not yourself, not the last owner."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    deletion.require_confirm(confirm, user.id, user.email)
    await _refuse_self_and_last_owner(db, admin, member)
    before = {"id": str(user.id), "role": member.role.value}
    await db.delete(member)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=user, action="membership.remove", before=before
    )


@router.post("/{user_id}/password-reset", status_code=status.HTTP_202_ACCEPTED)
async def admin_send_password_reset(
    user_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
):
    """ "Enviar ligação de recuperação" (G03): the same single-use, one-hour
    link the customer can ask for themselves, sent by the operator. A
    suspended account gets nothing (409): reactivate first."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    if user.disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The account is disabled")
    now = clock.utcnow()
    raw = await password_reset.issue(db, user, now=now, created_by_admin_id=admin.id)
    email.enqueue_email(
        background_tasks,
        email_gateway,
        email.password_reset_email(to=user.email, link=password_reset.reset_link(raw)),
    )
    # The token itself is never part of the row: `after` says only that a
    # link went out, and when.
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=user,
        action="password_reset.send",
        after={"id": str(user.id), "sent_to": user.email, "sent_at": now.isoformat()},
    )
    return {"sent_to": user.email, "sent_at": now}


@router.post("/{user_id}/set-password")
@rate_limit(AUTH_TIER)
async def admin_set_password(
    user_id: uuid.UUID,
    body: PasswordSet,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """ "Definir password" (G03): the operator sets it directly. Every session
    and every open reset link of the account dies with it; the audit row
    records that it happened and never the value. Allowed on a suspended
    account (the person still cannot sign in until it is reactivated)."""
    member = await _membership(db, user_id, org_id)
    user = member.user
    # A password is the global credential: never set it for someone who also
    # belongs to another organisation (the same rule as anonymisation).
    await _refuse_other_memberships(db, member)
    await password_reset.set_password(db, user, hash_password(body.password))
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=user,
        action="password.set",
        after={"id": str(user.id), "sessions_revoked": True},
    )
    count = await db.scalar(
        select(func.count()).where(Booking.user_id == user_id, Booking.org_id == org_id)
    )
    return {"user": _row(member, count or 0)}


@router.post("/{user_id}/complimentary-hours", status_code=status.HTTP_201_CREATED)
async def admin_grant_hours(
    user_id: uuid.UUID,
    body: ComplimentaryHoursCreate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
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
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=row,
        action="create.complimentary",
        after=audit.snapshot(row),
        reason=body.reason,
    )
    return {"purchase": AdminPurchaseOut.model_validate(row)}


@purchases_router.get("")
async def admin_list_purchases(
    org_id: uuid.UUID = Query(...),
    user_id: uuid.UUID | None = Query(default=None),
    package_id: uuid.UUID | None = Query(default=None),
    purchase_status: PurchaseStatus | None = Query(default=None, alias="status"),
    expiring_before: AwareDatetime | None = Query(default=None),
    page: int = Query(default=1, ge=1, le=1_000_000),
    page_size: int = Query(default=20, ge=1, le=100),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """The org's purchases, "Banco de horas" (G04): newest first, with the
    customer alongside each row."""
    where = [UserPackagePurchase.org_id == org_id]
    if user_id is not None:
        where.append(UserPackagePurchase.user_id == user_id)
    if package_id is not None:
        where.append(UserPackagePurchase.package_id == package_id)
    if purchase_status is not None:
        where.append(UserPackagePurchase.status == purchase_status)
    if expiring_before is not None:
        where.append(UserPackagePurchase.expires_at <= expiring_before)
    total = await db.scalar(select(func.count()).select_from(UserPackagePurchase).where(*where))
    rows = (
        (
            await db.execute(
                select(UserPackagePurchase)
                .options(
                    selectinload(UserPackagePurchase.package),
                    selectinload(UserPackagePurchase.user),
                )
                .where(*where)
                .order_by(UserPackagePurchase.purchased_at.desc(), UserPackagePurchase.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return {
        "purchases": [
            {
                **AdminPurchaseOut.model_validate(p).model_dump(mode="json"),
                "user": PurchaseUserOut.model_validate(p.user).model_dump(mode="json"),
            }
            for p in rows
        ],
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


async def _purchase_in_org(
    db: AsyncSession, purchase_id: uuid.UUID, org_id: uuid.UUID, *, lock: bool = False
) -> UserPackagePurchase:
    query = (
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package), selectinload(UserPackagePurchase.user))
        .where(UserPackagePurchase.id == purchase_id, UserPackagePurchase.org_id == org_id)
    )
    if lock:
        query = query.with_for_update(of=UserPackagePurchase)
    purchase = await db.scalar(query)
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found")
    return purchase


async def _debits_of_purchase(db: AsyncSession, purchase_id: uuid.UUID) -> list[PurchaseDebitOut]:
    rows = (
        await db.execute(
            select(BookingPackageDebit, Booking, Room.name)
            .join(Booking, Booking.id == BookingPackageDebit.booking_id)
            .join(Room, Room.id == Booking.room_id)
            .where(BookingPackageDebit.purchase_id == purchase_id)
            .order_by(Booking.start_time)
        )
    ).all()
    return [
        PurchaseDebitOut(
            booking_id=booking.id,
            hours=debit.hours,
            start_time=booking.start_time,
            end_time=booking.end_time,
            status=booking.status.value,
            room_name=room_name,
        )
        for debit, booking, room_name in rows
    ]


@purchases_router.get("/{purchase_id}")
async def admin_get_purchase(
    purchase_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """One purchase for its page (G04): the customer and every booking still
    drawing on it."""
    purchase = await _purchase_in_org(db, purchase_id, org_id)
    return {
        "purchase": AdminPurchaseOut.model_validate(purchase),
        "user": PurchaseUserOut.model_validate(purchase.user),
        "debits": await _debits_of_purchase(db, purchase.id),
    }


@purchases_router.post("/{purchase_id}/adjust")
async def admin_adjust_purchase(
    purchase_id: uuid.UUID,
    body: PurchaseAdjust,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Hours added to or taken from a purchase (G04), with a reason. Both
    `hours_total` and `hours_remaining` move by the delta; the balance can
    never go below zero — the hours bookings already drew stay theirs, and
    the 409 lists them."""
    purchase = await _purchase_in_org(db, purchase_id, org_id, lock=True)
    remaining = purchase.hours_remaining + body.hours
    if remaining < 0:
        raise deletion.blocked(
            "The purchase's hours are held by bookings; cancel or move them first",
            [d.model_dump(mode="json") for d in await _debits_of_purchase(db, purchase.id)],
        )
    if purchase.hours_total + body.hours > Decimal("999.99"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A purchase holds at most 999.99 hours",
        )
    before = audit.snapshot(purchase)
    purchase.hours_total += body.hours
    purchase.hours_remaining = remaining
    await db.flush()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=purchase,
        action="adjust",
        before=before,
        after=audit.snapshot(purchase),
        reason=body.reason,
    )
    return {"purchase": AdminPurchaseOut.model_validate(purchase)}


@purchases_router.put("/{purchase_id}/expiry")
async def admin_extend_purchase(
    purchase_id: uuid.UUID,
    body: ExpiryUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
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
    before = audit.snapshot(purchase)
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
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=purchase,
        action="expiry.extend",
        before=before,
        after=audit.snapshot(purchase),
        reason=body.reason,
    )
    return {"purchase": AdminPurchaseOut.model_validate(purchase)}


@purchases_router.put("/{purchase_id}")
async def admin_update_purchase(
    purchase_id: uuid.UUID,
    body: PurchaseUpdate,
    org_id: uuid.UUID = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Status and private note (G02/G04). `cancelled` with a reason is the
    delete: no money moves, the remaining hours go to 0, the debit rows of
    bookings already paid with it stay. `active` brings a cancelled purchase
    back with `hours_total - hours_used`. A `pending` purchase (unpaid at
    Checkout) is not this endpoint's business."""
    purchase = await db.scalar(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(UserPackagePurchase.id == purchase_id, UserPackagePurchase.org_id == org_id)
        .with_for_update(of=UserPackagePurchase)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found")
    before = audit.snapshot(purchase)
    action = "update"
    if body.status is not None:
        if purchase.status is PurchaseStatus.pending:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An unpaid purchase cannot be cancelled or activated here",
            )
        wanted = PurchaseStatus(body.status)
        if wanted is not purchase.status:
            purchase.status = wanted
            if wanted is PurchaseStatus.cancelled:
                purchase.hours_remaining = Decimal("0.00")
                action = "cancel"
            else:
                purchase.hours_remaining = max(
                    purchase.hours_total - purchase.hours_used, Decimal("0.00")
                )
                action = "reactivate"
    if "admin_note" in body.model_fields_set:
        purchase.admin_note = body.admin_note
    await db.flush()
    await audit.record(
        db,
        actor=admin,
        org_id=org_id,
        entity=purchase,
        action=action,
        before=before,
        after=audit.snapshot(purchase),
        reason=body.reason,
    )
    return {"purchase": AdminPurchaseOut.model_validate(purchase)}


@purchases_router.delete("/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_purchase(
    purchase_id: uuid.UUID,
    org_id: uuid.UUID = Query(...),
    confirm: str | None = Query(default=None, max_length=255),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
):
    """Hard delete (G02): only a purchase no money was paid for and no
    booking ever drew on; a paid one is cancelled instead. A `pending`
    purchase still has a payable Checkout Session: it is expired at the
    provider first, and one that already completed keeps the row (409) so
    the webhook can still activate it."""
    purchase = await db.scalar(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(UserPackagePurchase.id == purchase_id, UserPackagePurchase.org_id == org_id)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found")
    deletion.require_confirm(confirm, purchase.id)
    debits = await db.scalar(
        select(func.count())
        .select_from(BookingPackageDebit)
        .where(BookingPackageDebit.purchase_id == purchase.id)
    )
    if purchase.amount_paid != 0 or debits:
        raise deletion.blocked(
            "The purchase was paid for or has been drawn on; cancel it instead",
            {"amount_paid": f"{purchase.amount_paid:.2f}", "debits": debits or 0},
        )
    if purchase.stripe_checkout_session_id:
        try:
            await gateway.expire_checkout_session(purchase.stripe_checkout_session_id)
        except CheckoutSessionCompletedError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Payment already received for this purchase; waiting for confirmation",
            ) from None
        except PaymentProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not close the payment session",
            ) from exc
    before = audit.snapshot(purchase)
    await db.delete(purchase)
    await db.flush()
    await audit.record(
        db, actor=admin, org_id=org_id, entity=purchase, action="delete", before=before
    )
