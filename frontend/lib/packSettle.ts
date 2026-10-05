// K02: back from Checkout with `pagamento=sucesso`, the pack is not
// necessarily in the bank yet — Stripe activates the purchase from its
// webhook, which can land after the customer does (the stub activates it
// before redirecting, so locally the wait is never seen). The booking modal
// polls the bank this often, for this long, before handing the choice back.
export const PACK_SETTLE_POLL_MS = 2_000
export const PACK_SETTLE_WAIT_MS = 20_000
