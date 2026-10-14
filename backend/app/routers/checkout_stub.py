"""Browser-facing stub Checkout page (T10).

`StubPaymentGateway.create_checkout_session` (app/payments.py) hands back a
URL pointing here instead of an unreachable `checkout.stripe.stub` hostname,
so a human can walk the booking/purchase → pay → confirmed flow end to end on
a laptop with zero Stripe credentials (CLAUDE.md §10.3) — not just automate it
against the webhook, as the E2E suite used to.

Deliberately mounted WITHOUT the `/api/v1` prefix (see app/main.py): this is
an HTML page for a browser tab, not a JSON API route, mirroring how a real
Stripe Checkout Session lives on its own domain rather than under our API.

"Pay" does not shortcut around the webhook's own logic — it builds the exact
`checkout.session.completed` payload Stripe would send, signs it the same way
the stub always has, and runs it through the same
`app.routers.webhooks.apply_checkout_completion` a real webhook delivery
uses. That includes the booking-confirmation email (Epic 4 / PR #16) and the
Seam access-code issuance (Epic 3) — a "Pay" click here has to trigger both
too, not bypass them.

In `STRIPE_MODE=live` every route here 404s: `get_payment_gateway()` returns
a `StripeGateway`, `_require_stub_gateway` rejects anything that isn't a
`StubPaymentGateway`, and a real Stripe Checkout Session's URL is on Stripe's
domain anyway — nothing should ever link here in live mode.
"""

import html
import json
import re
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock
from app.config import BRAND_NAME
from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import LockGateway, get_lock_gateway
from app.payments import CheckoutKind, PaymentGateway, StubPaymentGateway, get_payment_gateway
from app.routers.webhooks import (
    apply_checkout_completion,
    cancel_pending_purchase,
    expire_pending_hold,
)

router = APIRouter(prefix="/checkout/stub", tags=["checkout-stub"])

# The page's copy in both languages the frontend ships (B65). A module-level
# table rather than the frontend's JSON catalogs: this HTML is served by the
# backend alone, and two short translations do not justify a catalog loader.
# Portuguese stays in the formal register (CLAUDE.md §9).
_COPY: dict[str, dict[str, str]] = {
    "pt": {
        "title": f"Finalizar pagamento (modo teste) — {BRAND_NAME}",
        "badge": "Ambiente de testes — nenhum valor é cobrado",
        "heading": "Finalizar pagamento",
        "description": "Descrição",
        "kind": "Tipo",
        "amount": "Valor",
        "pay": "Pagar",
        "cancel": "Cancelar",
        "kind:booking": "Reserva de sala",
        "kind:package_purchase": "Compra de pacote de horas",
    },
    "en": {
        "title": f"Complete payment (test mode) — {BRAND_NAME}",
        "badge": "Test environment — no amount is charged",
        "heading": "Complete payment",
        "description": "Description",
        "kind": "Type",
        "amount": "Amount",
        "pay": "Pay",
        "cancel": "Cancel",
        "kind:booking": "Room booking",
        "kind:package_purchase": "Hour pack purchase",
    },
}
_DEFAULT_LANGUAGE = "pt"
# RFC 9110 §12.4.2 qvalue: 0 to 1 with at most three decimals. Anything else
# ("abc", "1.5", "nan") is not a weight and drops its range rather than
# guessing one.
_QVALUE = re.compile(r"^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$")


def negotiate_language(accept_language: str | None) -> str:
    """Pick the page language from an `Accept-Language` header.

    Ranges are ranked by q-weight, highest first and header order among
    equals, and the first whose primary subtag has copy wins: so
    `en-GB,en;q=0.9,pt;q=0.8` is English and `pt-PT,pt;q=0.9,en;q=0.5` is
    Portuguese. A range with `q=0`, a malformed q-value or a language without
    copy is skipped. No header, or nothing usable in it, is Portuguese — the
    page's only language before B65 and the product's home market.
    """
    ranked: list[tuple[float, int, str]] = []
    for position, element in enumerate((accept_language or "").split(",")):
        tag, *params = (part.strip() for part in element.split(";"))
        weight = 1.0
        for param in params:
            name, _, value = (piece.strip() for piece in param.partition("="))
            if name.lower() == "q":
                weight = float(value) if _QVALUE.match(value) else 0.0
                break
        if tag and weight > 0:
            ranked.append((-weight, position, tag.split("-", 1)[0].lower()))
    for _, _, primary in sorted(ranked):
        if primary in _COPY:
            return primary
    return _DEFAULT_LANGUAGE


def _require_stub_gateway(
    gateway: PaymentGateway = Depends(get_payment_gateway),
) -> StubPaymentGateway:
    """Only ever serve this page for the stub gateway.

    In live mode the real Stripe SDK issued the Checkout Session, so there is
    nothing of ours to render here — 404 rather than leak a fake payment UI.
    """
    if not isinstance(gateway, StubPaymentGateway):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return gateway


def _session_or_404(gateway: StubPaymentGateway, session_id: str) -> dict:
    session = gateway.sessions.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Checkout session not found"
        )
    return session


def _render_page(session_id: str, session: dict, language: str) -> str:
    copy = _COPY[language]
    amount = Decimal(session["amount_cents"]) / 100
    # pt-PT formatting in both languages: it matches the frontend's
    # `formatCurrency`, which is pt-PT whichever catalog is active.
    amount_label = f"{amount:.2f}".replace(".", ",") + " €"
    description = html.escape(session["description"])
    kind_label = html.escape(copy.get("kind:" + session["kind"], session["kind"]))
    return f"""<!doctype html>
<html lang="{language}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{copy["title"]}</title>
<style>
  body {{
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f7f5;
    color: #1f2a24;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    margin: 0;
  }}
  main {{
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
    padding: 2.5rem;
    width: 100%;
    max-width: 420px;
  }}
  .badge {{
    display: inline-block;
    background: #fef3c7;
    color: #92400e;
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
    margin-bottom: 1rem;
  }}
  h1 {{ font-size: 1.35rem; margin: 0 0 1.25rem; }}
  dl {{ margin: 0 0 1.75rem; }}
  dt {{ font-size: 0.8rem; color: #5b6b62; margin-top: 0.75rem; }}
  dd {{ font-size: 1.05rem; font-weight: 600; margin: 0.15rem 0 0; }}
  form {{ margin: 0 0 0.75rem; }}
  button {{
    width: 100%;
    padding: 0.75rem;
    border-radius: 10px;
    border: none;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }}
  .pay {{ background: #4c9a72; color: white; }}
  .pay:hover {{ background: #3f8461; }}
  .cancel {{ background: #eef2ef; color: #1f2a24; }}
  .cancel:hover {{ background: #e2e8e4; }}
</style>
</head>
<body>
  <main>
    <span class="badge">{copy["badge"]}</span>
    <h1>{copy["heading"]}</h1>
    <dl>
      <dt>{copy["description"]}</dt>
      <dd>{description}</dd>
      <dt>{copy["kind"]}</dt>
      <dd>{kind_label}</dd>
      <dt>{copy["amount"]}</dt>
      <dd>{amount_label}</dd>
    </dl>
    <!-- Relative on purpose (D20): the page is reached through the frontend's
         proxy at /backend/checkout/stub/{{id}} as well as directly at
         /checkout/stub/{{id}}, and `{{id}}/pay` resolves under either. -->
    <form method="post" action="{session_id}/pay">
      <button type="submit" class="pay">{copy["pay"]}</button>
    </form>
    <form method="post" action="{session_id}/cancel">
      <button type="submit" class="cancel">{copy["cancel"]}</button>
    </form>
  </main>
</body>
</html>"""


def _checkout_completed_payload(session_id: str, session: dict) -> bytes:
    """The same `checkout.session.completed` shape a real Stripe webhook sends."""
    return json.dumps(
        {
            "type": "checkout.session.completed",
            "data": {
                "object": {
                    "object": "checkout.session",
                    "id": session_id,
                    "payment_status": "paid",
                    "metadata": {
                        "kind": session["kind"],
                        "reference_id": session["reference_id"],
                        "org_id": session["org_id"],
                    },
                }
            },
        }
    ).encode()


@router.get("/{session_id}", response_class=HTMLResponse)
async def show_checkout(
    session_id: str,
    request: Request,
    gateway: StubPaymentGateway = Depends(_require_stub_gateway),
) -> HTMLResponse:
    session = _session_or_404(gateway, session_id)
    language = negotiate_language(request.headers.get("accept-language"))
    # The body is chosen per Accept-Language, so a shared cache has to key on
    # it; the gzip layer appends Accept-Encoding to the same header.
    return HTMLResponse(
        _render_page(session_id, session, language), headers={"Vary": "Accept-Language"}
    )


@router.post("/{session_id}/pay")
async def pay_checkout(
    session_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    gateway: StubPaymentGateway = Depends(_require_stub_gateway),
    email_gateway: EmailGateway = Depends(get_email_gateway),
    lock_gateway: LockGateway = Depends(get_lock_gateway),
) -> RedirectResponse:
    session = _session_or_404(gateway, session_id)
    payload = _checkout_completed_payload(session_id, session)
    # Round-trips through the gateway's own signature scheme rather than
    # calling apply_checkout_completion directly — this exercises exactly
    # the same verify-then-apply path a real webhook delivery takes.
    event = gateway.parse_webhook_event(payload, gateway.sign_payload(payload))
    assert event.checkout_session is not None  # we just built this payload
    await apply_checkout_completion(
        db,
        event.checkout_session,
        background_tasks=background_tasks,
        email_gateway=email_gateway,
        lock_gateway=lock_gateway,
    )
    return RedirectResponse(
        session.get("success_url") or gateway.success_url, status_code=status.HTTP_303_SEE_OTHER
    )


@router.post("/{session_id}/cancel")
async def cancel_checkout(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    gateway: StubPaymentGateway = Depends(_require_stub_gateway),
) -> RedirectResponse:
    session = _session_or_404(gateway, session_id)
    # Backing out releases what the session held at once: a booking hold to
    # `expired` (the slot frees up; "Pagar agora" later if it is still free),
    # a pack purchase to `cancelled` (B68) — the same helpers the
    # `checkout.session.expired` webhook runs. Live Stripe's cancel URL is a
    # plain redirect, so there the hold lapses at BOOKING_HOLD_MINUTES and
    # the purchase waits for that webhook or the sweeper.
    if session["kind"] == CheckoutKind.booking.value:
        await expire_pending_hold(db, session_id, clock.utcnow())
    elif session["kind"] == CheckoutKind.package_purchase.value:
        await cancel_pending_purchase(db, session_id)
    return RedirectResponse(
        session.get("cancel_url") or gateway.cancel_url, status_code=status.HTTP_303_SEE_OTHER
    )
