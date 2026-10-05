"""The organisation's people (A05, G03, G04): list, create, update, role, anonymise, delete, reset
links, passwords, complimentary hours.
"""

import logging
import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock, deletion, email, package_hours, password_reset
from app.auth import hash_password, require_admin
from app.booking_validity import expire_user_holds
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.models.audit import AdminAction
from app.models.booking import Booking
from app.models.organization import MemberRole, Organization, OrganizationMember
from app.models.package import (
    BookingPackageDebit,
    Package,
    PurchaseSource,
    PurchaseStatus,
    UserPackagePurchase,
)
from app.models.password_reset import PasswordResetToken
from app.models.support import SupportRequest
from app.models.user import User
from app.ratelimit import AUTH_TIER, rate_limit
from app.schemas.admin_users import (
    AdminUserCreate,
    AdminUserUpdate,
    AnonymisedUserOut,
    ComplimentaryHoursCreate,
    ConfirmBody,
    OrgUserOut,
    RoleUpdate,
)
from app.schemas.booking import AdminBookingOut
from app.schemas.package import AdminPurchaseOut, PackageBalanceOut
from app.schemas.support import SupportRequestOut
from app.schemas.user import PasswordSet

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["admin-users"])


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
        assert raw is not None  # just created, cannot be suspended
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
    # Under the user's row lock, re-read (review on #65): a suspension
    # bumps `token_version` and must not overwrite a concurrent password
    # change's bump, and the email check below must see the current row.
    await password_reset.lock_user(db, user.id)
    changes = body.model_dump(exclude_unset=True)
    if "disabled_at" in changes and user.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot suspend your own account"
        )
    # The account is global: renaming, re-addressing or suspending someone
    # who also belongs to another organisation would reach into that tenant.
    await _refuse_other_memberships(db, member)
    await _refuse_non_owner_on_owner(db, admin, member)
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
    if "email" in changes and changes["email"].lower() != user.email.lower():
        # A reset link already in the old mailbox must not reset the account
        # after the address moved on (review on #65).
        await password_reset.invalidate_open(db, user.id)
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


async def _refuse_non_owner_on_owner(
    db: AsyncSession, admin: User, member: OrganizationMember
) -> None:
    """An owner's account is only another owner's to change (review on #65):
    an admin who could re-address, suspend, re-password or remove an owner
    could take the organisation over through the public reset flow."""
    if member.role is not MemberRole.owner or member.user_id == admin.id:
        return
    actor = await db.scalar(
        select(OrganizationMember.role).where(
            OrganizationMember.user_id == admin.id, OrganizationMember.org_id == member.org_id
        )
    )
    if actor is not MemberRole.owner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an owner can change another owner's account",
        )


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
        # Serialised per organisation (review on #65): two owners removing
        # each other at once would both count two and leave nobody. The
        # second waits on the row and counts after the first committed.
        await db.execute(
            select(Organization.id).where(Organization.id == member.org_id).with_for_update()
        )
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
    # Authored audit rows count too (review on #65): deleting the actor would
    # null `actor_id` and turn their actions into "Sistema". Anonymisation
    # keeps the row, so the trail keeps its "who".
    return {
        "admin_actions": await db.scalar(
            select(func.count())
            .select_from(AdminAction)
            .where(AdminAction.actor_user_id == user_id)
        )
        or 0,
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
    await _refuse_non_owner_on_owner(db, admin, member)
    await _refuse_self_and_last_owner(db, admin, member)
    # Locked and re-read like every other global-account mutation: an
    # enrolment into another organisation waits on the row instead of
    # landing after the sweep on an account about to be anonymised.
    await password_reset.lock_user(db, user.id)
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
    await _refuse_non_owner_on_owner(db, admin, member)
    await _refuse_self_and_last_owner(db, admin, member)
    # Locked: a membership, booking, purchase or help request being inserted
    # for this account waits on its row (KEY SHARE), so none can cross the
    # sweeps below and be cascaded away.
    await password_reset.lock_user(db, user.id)
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
    await _refuse_non_owner_on_owner(db, admin, member)
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
    if raw is None:
        # Suspended under the lock, by a concurrent request.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The account is disabled")
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
    # belongs to another organisation (the same rule as anonymisation), and
    # an owner's only by another owner.
    await _refuse_other_memberships(db, member)
    await _refuse_non_owner_on_owner(db, admin, member)
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
        # What "Origem" shows (K01): a grant, not a sale — the column's
        # default is for rows the customer paid for (review on #69).
        source=PurchaseSource.complimentary,
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
