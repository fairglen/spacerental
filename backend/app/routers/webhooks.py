import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.booking import Booking, BookingStatus
from app.models.package import PurchaseStatus, UserPackagePurchase
from app.payments import (
    CheckoutKind,
    CheckoutSessionInfo,
    InvalidWebhookPayload,
    InvalidWebhookSignature,
    PaymentGateway,
    get_payment_gateway,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

CHECKOUT_COMPLETED = "checkout.session.completed"


def _required_uuid(raw: str | None, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Checkout Session metadata has no valid {field}",
        )


async def _confirm_booking(
    db: AsyncSession, *, booking_id: uuid.UUID, org_id: uuid.UUID, session_id: str
) -> bool:
    result = await db.execute(
        select(Booking).where(
            Booking.id == booking_id,
            Booking.org_id == org_id,
            Booking.stripe_checkout_session_id == session_id,
        )
    )
    booking = result.scalar_one_or_none()
    if booking is None or booking.status is not BookingStatus.pending:
        return False
    booking.status = BookingStatus.confirmed
    return True


async def _activate_purchase(
    db: AsyncSession, *, purchase_id: uuid.UUID, org_id: uuid.UUID, session_id: str
) -> bool:
    result = await db.execute(
        select(UserPackagePurchase).where(
            UserPackagePurchase.id == purchase_id,
            UserPackagePurchase.org_id == org_id,
            UserPackagePurchase.stripe_checkout_session_id == session_id,
        )
    )
    purchase = result.scalar_one_or_none()
    if purchase is None or purchase.status is not PurchaseStatus.pending:
        return False
    purchase.status = PurchaseStatus.active
    return True


async def _apply_checkout_completion(db: AsyncSession, session: CheckoutSessionInfo) -> bool:
    # Async payment methods complete the session before the money lands.
    if session.payment_status != "paid":
        return False
    if session.kind not in (CheckoutKind.booking.value, CheckoutKind.package_purchase.value):
        return False
    if not session.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Checkout Session has no id",
        )

    # org_id rides in the session metadata so the lookup stays tenant-scoped (§4).
    org_id = _required_uuid(session.org_id, "org_id")
    reference_id = _required_uuid(session.reference_id, "reference_id")

    if session.kind == CheckoutKind.booking.value:
        return await _confirm_booking(
            db, booking_id=reference_id, org_id=org_id, session_id=session.id
        )
    return await _activate_purchase(
        db, purchase_id=reference_id, org_id=org_id, session_id=session.id
    )


@router.post("/stripe")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
    gateway: PaymentGateway = Depends(get_payment_gateway),
):
    """Payment provider event sink.

    Unauthenticated by design — the `Stripe-Signature` header verified against
    STRIPE_WEBHOOK_SECRET is the credential. An unverified payload is rejected
    with 400 before any query runs, so a forged event can never write.

    Returns a plain `{"received", "handled"}` ack rather than a wrapped
    resource: no client of ours reads it, the provider just needs a 2xx.
    """
    payload = await request.body()
    try:
        event = gateway.parse_webhook_event(payload, request.headers.get("stripe-signature"))
    except InvalidWebhookSignature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe signature",
        )
    except InvalidWebhookPayload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Malformed webhook payload",
        )

    if event.type != CHECKOUT_COMPLETED or event.checkout_session is None:
        return {"received": True, "handled": False}

    handled = await _apply_checkout_completion(db, event.checkout_session)
    return {"received": True, "handled": handled}
