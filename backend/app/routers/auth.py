import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock, email, password_reset
from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    token_claims,
    verify_password,
)
from app.config import settings
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.models.organization import MemberRole, Organization, OrganizationMember, OrgPlan
from app.models.user import User
from app.ratelimit import AUTH_TIER, rate_limit
from app.schemas.organization import EnrollmentOut, OrgMembershipDetail, OrgMembershipOut
from app.schemas.user import (
    BillingDetailsOut,
    BillingDetailsUpdate,
    PasswordResetConfirm,
    PasswordResetRequest,
    TokenOut,
    UserLogin,
    UserOut,
    UserRegister,
)

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


async def _get_memberships(user: User, db: AsyncSession) -> list[OrgMembershipDetail]:
    """Fetch the user's memberships joined with their organization rows."""
    result = await db.execute(
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.org_id)
        .where(OrganizationMember.user_id == user.id)
        .order_by(Organization.created_at.asc())
    )
    return [
        OrgMembershipDetail(org_id=m.org_id, org_name=o.name, org_slug=o.slug, role=m.role)
        for m, o in result.all()
    ]


def _memberships_claim(memberships: list[OrgMembershipDetail]) -> list[dict]:
    """Compact representation included in the JWT claim."""
    return [{"org_id": str(m.org_id), "role": m.role.value} for m in memberships]


MAX_SLUG_ATTEMPTS = 50


async def _create_default_org(user: User, db: AsyncSession) -> OrganizationMember:
    base = re.sub(r"[^a-z0-9]+", "-", (user.name or user.email.split("@")[0]).lower()).strip("-")
    base = base[:90] or "my-space"

    counter = 0
    for _attempt in range(MAX_SLUG_ATTEMPTS):
        slug_candidate = base if counter == 0 else f"{base}-{counter}"
        existing = await db.execute(select(Organization).where(Organization.slug == slug_candidate))
        if existing.scalar_one_or_none() is not None:
            counter += 1
            continue

        org = Organization(
            name=f"{user.name or user.email}'s Space",
            slug=slug_candidate,
            plan=OrgPlan.starter,
            settings={},
        )
        try:
            # A SAVEPOINT isolates this attempt: a concurrent operator
            # registration with the same name can win the same slug between
            # our SELECT above and this INSERT. A plain flush() would abort
            # the whole outer transaction — including the user row already
            # flushed in _register — instead of just this candidate.
            async with db.begin_nested():
                db.add(org)
                await db.flush()
        except IntegrityError:
            counter += 1
            continue

        membership = OrganizationMember(org_id=org.id, user_id=user.id, role=MemberRole.owner)
        db.add(membership)
        await db.flush()
        return membership

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Não foi possível gerar um identificador único para a organização.",
    )


async def _enrollment_org(db: AsyncSession) -> Organization:
    if not settings.CUSTOMER_ENROLLMENT_ENABLED:
        raise HTTPException(status_code=403, detail="A adesão ao espaço está encerrada.")
    slug = (settings.CUSTOMER_ENROLLMENT_ORG_SLUG or "").strip()
    if not slug:
        raise HTTPException(status_code=503, detail="O espaço de adesão não está configurado.")
    org = await db.scalar(select(Organization).where(Organization.slug == slug))
    if org is None:
        raise HTTPException(status_code=503, detail="O espaço de adesão não está disponível.")
    return org


async def _enroll_member(user: User, org: Organization, db: AsyncSession) -> OrganizationMember:
    # Concurrent retries must not create duplicates or downgrade an existing owner.
    await db.execute(
        insert(OrganizationMember)
        .values(org_id=org.id, user_id=user.id, role=MemberRole.member)
        .on_conflict_do_nothing(constraint="uq_org_user")
    )
    return (
        await db.execute(
            select(OrganizationMember).where(
                OrganizationMember.org_id == org.id, OrganizationMember.user_id == user.id
            )
        )
    ).scalar_one()


async def _register(body: UserRegister, db: AsyncSession, *, operator: bool = False) -> TokenOut:
    org = None if operator else await _enrollment_org(db)
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Este email já está registado.")

    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        # Race with a concurrent registration for the same email — the
        # preliminary SELECT above can't see another in-flight, uncommitted
        # insert. Roll back so no partial user row survives.
        await db.rollback()
        raise HTTPException(status_code=400, detail="Este email já está registado.") from None

    if operator:
        await _create_default_org(user, db)
    else:
        await _enroll_member(user, org, db)
    await db.commit()
    await db.refresh(user)

    role = await _get_highest_role(user, db)
    memberships = await _get_memberships(user, db)
    token = create_access_token(
        token_claims(user, role=role, memberships=_memberships_claim(memberships))
    )
    return TokenOut(access_token=token, user=UserOut.model_validate(user), role=role)


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
@rate_limit(AUTH_TIER)
async def register(body: UserRegister, db: AsyncSession = Depends(get_db)):
    return await _register(body, db)


@router.post("/register/operator", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
@rate_limit(AUTH_TIER)
async def register_operator(body: UserRegister, db: AsyncSession = Depends(get_db)):
    return await _register(body, db, operator=True)


@router.post("/enroll", response_model=EnrollmentOut)
async def enroll(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    org = await _enrollment_org(db)
    membership = await _enroll_member(user, org, db)
    await db.commit()
    return {"membership": OrgMembershipOut.model_validate(membership)}


@router.post("/login", response_model=TokenOut)
@rate_limit(AUTH_TIER)
async def login(body: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if (
        user is None
        or user.password_hash is None
        or not verify_password(body.password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    # After the password check on purpose: the distinct answer is for the
    # account's own holder, not for whoever knows the email (G02).
    if user.disabled_at is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="A conta está desativada."
        )

    role = await _get_highest_role(user, db)
    memberships = await _get_memberships(user, db)
    token = create_access_token(
        token_claims(user, role=role, memberships=_memberships_claim(memberships))
    )
    return TokenOut(access_token=token, user=UserOut.model_validate(user), role=role)


async def _user_by_email(db: AsyncSession, email: str) -> User | None:
    """The account for an address, matched without regard to case. `users.email`
    is unique case-sensitively (B37), so two accounts may differ only by case:
    then the exact spelling wins, and with no exact match nobody does — the
    endpoint must never pick one of two people."""
    rows = (
        (await db.execute(select(User).where(func.lower(User.email) == email.lower())))
        .scalars()
        .all()
    )
    if len(rows) == 1:
        return rows[0]
    return next((u for u in rows if u.email == email), None)


RESET_REQUESTED = (
    "Se existir uma conta com este email, vai receber uma ligação para repor a password."
)
RESET_LINK_INVALID = "A ligação é inválida ou já expirou."


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
@rate_limit(AUTH_TIER)
async def request_password_reset(
    body: PasswordResetRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    email_gateway: EmailGateway = Depends(get_email_gateway),
):
    """Always the same 202, whether or not the email exists or the account
    is enabled (G03): this endpoint must not say who has an account. When it
    does exist and is enabled, one email with a single-use, one-hour link."""
    user = await _user_by_email(db, body.email)
    if user is not None and user.disabled_at is None:
        raw = await password_reset.issue(db, user, now=clock.utcnow())
        # None: suspended under the lock meanwhile — the same neutral answer.
        if raw is not None:
            email.enqueue_email(
                background_tasks,
                email_gateway,
                email.password_reset_email(to=user.email, link=password_reset.reset_link(raw)),
            )
    return {"detail": RESET_REQUESTED}


@router.post("/password-reset/confirm")
@rate_limit(AUTH_TIER)
async def confirm_password_reset(body: PasswordResetConfirm, db: AsyncSession = Depends(get_db)):
    """The link's token plus a new password. 400 for a token that is unknown,
    used or expired — one message for all three, so the endpoint cannot be
    used to probe tokens. Success bumps `token_version`: every session issued
    before it is signed out."""
    now = clock.utcnow()
    token = await password_reset.consume(db, body.token, now=now)
    if token is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=RESET_LINK_INVALID)
    user = await db.scalar(select(User).where(User.id == token.user_id).with_for_update())
    if user is None or user.disabled_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=RESET_LINK_INVALID)
    token.used_at = now
    await password_reset.set_password(db, user, hash_password(body.password))
    return {"detail": "Password alterada. Já pode iniciar sessão."}


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.get("/me/billing")
async def my_billing_details(user: User = Depends(get_current_user)):
    """What an invoice to the caller names (I04): NIF, billing name, address."""
    return {"billing": BillingDetailsOut.model_validate(user)}


@router.put("/me/billing")
async def update_my_billing_details(
    body: BillingDetailsUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The caller's own details only; the operator edits a customer's on
    `/admin/users/{id}`, audited. Every field is sent, blank clears it."""
    user.tax_id = body.tax_id
    user.billing_name = body.billing_name
    user.billing_address = body.billing_address
    db.add(user)
    await db.flush()
    return {"billing": BillingDetailsOut.model_validate(user)}


@router.get("/memberships")
async def memberships(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current user's organization memberships with org details."""
    items = await _get_memberships(user, db)
    return {"memberships": items}
