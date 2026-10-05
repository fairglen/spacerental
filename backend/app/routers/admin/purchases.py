"""Pack purchases and the hour bank (A06, H02, G04): list, page, adjust, extend, status, hard
delete.
"""

import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import AwareDatetime
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import audit, clock, deletion
from app.auth import require_admin
from app.database import get_db
from app.models.booking import Booking, BookingStatus
from app.models.package import (
    BookingPackageDebit,
    PurchaseSource,
    PurchaseStatus,
    UserPackagePurchase,
)
from app.models.space import Room
from app.models.user import User
from app.payments import (
    CheckoutSessionCompletedError,
    PaymentGateway,
    PaymentProviderError,
    get_payment_gateway,
)
from app.schemas.admin_users import (
    ExpiryUpdate,
    PurchaseAdjust,
    PurchaseDebitOut,
    PurchaseUpdate,
    PurchaseUserOut,
)
from app.schemas.package import AdminPurchaseOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/purchases", tags=["admin-users"])


@router.get("")
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


@router.get("/{purchase_id}")
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


@router.post("/{purchase_id}/adjust")
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


@router.put("/{purchase_id}/expiry")
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


@router.put("/{purchase_id}")
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
            if (
                wanted is PurchaseStatus.active
                and purchase.source is PurchaseSource.cancellation_credit
                and purchase.source_booking_id is not None
            ):
                # K01: a credit is the paid hours of a CANCELLED booking. Once
                # that booking is back (reverse_credit cancelled the row), the
                # row must not come back too — the customer would hold the
                # booking and the hours it was paid with (review on #69). The
                # reinstatement path locks the booking first and this row
                # second; this path locks only the row and reads the booking,
                # so the two cannot wait on each other.
                booking_status = await db.scalar(
                    select(Booking.status).where(Booking.id == purchase.source_booking_id)
                )
                if booking_status is not BookingStatus.cancelled:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "The booking this credit came from is no longer cancelled; "
                            "reactivating the credit would pay for it twice"
                        ),
                    )
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


@router.delete("/{purchase_id}", status_code=status.HTTP_204_NO_CONTENT)
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
    # Locked: a redemption drawing on this purchase waits on its row, so no
    # debit can cross the guard below and be cascaded away.
    purchase = await db.scalar(
        select(UserPackagePurchase)
        .options(selectinload(UserPackagePurchase.package))
        .where(UserPackagePurchase.id == purchase_id, UserPackagePurchase.org_id == org_id)
        .with_for_update(of=UserPackagePurchase)
    )
    if purchase is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase not found")
    deletion.require_confirm(confirm, purchase.id)
    debits = await db.scalar(
        select(func.count())
        .select_from(BookingPackageDebit)
        .where(BookingPackageDebit.purchase_id == purchase.id)
    )
    # A `pending` row carries the package's price from creation but nothing
    # was paid yet (review on #65): it is unpaid. Money that did arrive —
    # `active`/`cancelled` with an amount — makes the purchase history.
    paid = purchase.status is not PurchaseStatus.pending and purchase.amount_paid != 0
    if paid or debits:
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
