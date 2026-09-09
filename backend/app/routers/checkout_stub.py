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
from decimal import Decimal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.email import EmailGateway, get_email_gateway
from app.locks import LockGateway, get_lock_gateway
from app.payments import PaymentGateway, StubPaymentGateway, get_payment_gateway
from app.routers.webhooks import apply_checkout_completion

router = APIRouter(prefix="/checkout/stub", tags=["checkout-stub"])

_KIND_LABELS = {
    "booking": "Reserva de sala",
    "package_purchase": "Compra de pacote de horas",
}


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


def _render_page(session_id: str, session: dict) -> str:
    amount = Decimal(session["amount_cents"]) / 100
    amount_label = f"{amount:.2f}".replace(".", ",") + " €"
    description = html.escape(session["description"])
    kind_label = html.escape(_KIND_LABELS.get(session["kind"], session["kind"]))
    return f"""<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Finalizar pagamento (modo teste) — EspaçoHora</title>
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
    <span class="badge">Ambiente de testes — nenhum valor é cobrado</span>
    <h1>Finalizar pagamento</h1>
    <dl>
      <dt>Descrição</dt>
      <dd>{description}</dd>
      <dt>Tipo</dt>
      <dd>{kind_label}</dd>
      <dt>Valor</dt>
      <dd>{amount_label}</dd>
    </dl>
    <form method="post" action="/checkout/stub/{session_id}/pay">
      <button type="submit" class="pay">Pagar</button>
    </form>
    <form method="post" action="/checkout/stub/{session_id}/cancel">
      <button type="submit" class="cancel">Cancelar</button>
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
    gateway: StubPaymentGateway = Depends(_require_stub_gateway),
) -> HTMLResponse:
    session = _session_or_404(gateway, session_id)
    return HTMLResponse(_render_page(session_id, session))


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
    return RedirectResponse(gateway.success_url, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/{session_id}/cancel")
async def cancel_checkout(
    session_id: str,
    gateway: StubPaymentGateway = Depends(_require_stub_gateway),
) -> RedirectResponse:
    _session_or_404(gateway, session_id)
    return RedirectResponse(gateway.cancel_url, status_code=status.HTTP_303_SEE_OTHER)
