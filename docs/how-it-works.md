# How FlowSpace works

A plain-language tour of what the application does and how its main flows
hang together. It is the functional companion to the other docs:

- [README.md](../README.md) — how to run and set it up.
- [CLAUDE.md](../CLAUDE.md) — architecture, conventions and the gotchas the code lives with.
- [API_SPEC.md](../API_SPEC.md) — the endpoint-by-endpoint contract.
- [docs/runbooks/aws.md](runbooks/aws.md) — how it is deployed and operated.
- [roadmap.md](../roadmap.md) and [TODO.md](../TODO.md) — what is built, parked or still open.

FlowSpace rents professional spaces (therapy rooms, consultation offices,
coworking) by the hour. It began as a proof of concept for one location in
Lisbon and is built to grow into a platform other operators can use. The UI
is Portuguese throughout, in the formal register.

---

## 1. Tenants, users and roles

Everything belongs to an **organization** (one space operator). Every
business row carries an `org_id`; a second operator is a new organization
and nothing else changes. People are **users**, linked to organizations
through **organization_members** with a role:

- **owner / admin** — may manage that organization through the admin panel.
  Admin checks are per organization, never global: an admin of one org has
  no rights in another.
- **member** — an ordinary customer.

A customer who signs up on the site joins the one configured organization
(`CUSTOMER_ENROLLMENT_ORG_SLUG`) as a member. Explicit operator signup
creates a new organization. Existing users can enroll elsewhere without
losing their current memberships.

## 2. Signing in

Two linked auth flows (detail in CLAUDE.md §2):

- The browser holds a **NextAuth session** cookie (httpOnly, encrypted).
- Inside it sits a **FastAPI JWT** issued by the backend at login or
  registration, sent as a bearer token on every API call.

Routes under `/dashboard` and `/admin` are gated by the session; the admin
area additionally checks the role.

## 3. The catalogue: spaces, rooms, availability

An organization has **spaces** (a physical location, with address and
opening hours) and, within each, **rooms** that are booked. Each room has an
hourly rate (Decimal, never a float), a set of **availability rules** (per
weekday opening windows) and photos.

Anyone, logged in or not, can browse: list the active spaces, open a space
to see its rooms, and ask a room for a given day's free hours
(`GET /rooms/{id}/availability`). Availability subtracts existing bookings,
operator **blocks** (maintenance, private use) and past hours, and respects
Lisbon wall-clock time across daylight-saving changes.

Photos are uploaded by operators, re-encoded to WebP with metadata stripped,
and served either from the API (`MEDIA_STORAGE=local`) or from CloudFront in
front of a private S3 bucket (`MEDIA_STORAGE=s3`, production). See
README "Room and space photos".

## 4. Booking an hour

A booking moves through these states (`BookingStatus`):

`pending` → `confirmed` → `completed`, or `pending` → `expired`, or
`confirmed` → `cancelled`.

A customer picks a room, a day and an hour. What happens next depends on how
they pay (`create_booking`, `backend/app/routers/bookings.py`):

- **Pay by the hour (`hourly`).** The booking is created `pending` next to a
  checkout session and **holds the slot** — the overlap check counts pending
  bookings. The hold lasts `BOOKING_HOLD_MINUTES` (15). It becomes
  `confirmed` only when payment completes (section 6). An unpaid hold that
  lapses turns `expired` and frees the slot.
- **Use a prepaid pack (`package`).** Hours are debited from an active
  purchase in the same transaction and the booking is `confirmed`
  immediately — there is nothing to pay, so no checkout page, and the
  confirmation email is sent straight away.
- **Mixed (`mixed`) — "use my pack and pay the rest".** The server decides
  the split: it draws as many hours as it can from the customer's hour bank
  (active, unexpired purchases, soonest-expiring first) and sends only the
  remaining hours to checkout as a `pending` hold. If the bank covers the
  whole block it is a `package` booking; if it covers none it is a plain
  `hourly` one.

An unpaid hold can be resumed or retried from the dashboard ("Pagar agora",
`POST /bookings/{id}/checkout`): a live hold gets a fresh checkout session, a
lapsed one is reinstated if its slot is still free. The previous session is
always cancelled first, so a late payment of it cannot double-book, and no
second row is ever created.

**The hold sweeper.** A background task reconciles lapsed holds on a timer so
the customer's reads do not have to. Exactly one sweeper runs per deployment,
however many workers or replicas there are, guarded by a PostgreSQL advisory
lock (`backend/app/holds.py`).

## 5. Packs and the hour bank

An operator offers **packages** (for example "Pack 10 horas"): a number of
hours, a price and a validity in days. A customer buys one
(`POST /packages/{id}/purchase`), which — like an hourly booking — goes
through checkout and becomes an `active` purchase when payment completes.

Active, unexpired purchases together form the customer's **hour bank**.
Booking with `package` or `mixed` draws from it, soonest-expiring first; the
debits are recorded per purchase so each one's remaining hours are exact. A
pack checkout left unpaid is cancelled by the same sweep that expires holds,
so only genuinely paid packs ever count.

Purchases also arise two other ways (`PurchaseSource`): an operator can grant
**complimentary** hours, and a cancelled paid booking returns hours as a
**cancellation credit** (next section).

## 6. Paying: checkout, the webhook, stub mode

Payment sits behind a gateway with two implementations chosen by
`STRIPE_MODE` (CLAUDE.md §10.3, README "Third-party integrations"):

- **`stub`** (default, and the first production deploy) — a walkable local
  checkout page, no account, no money, logged. Fine for demos and the smoke
  test.
- **`live`** — real Stripe Checkout; cards and MB WAY.

Either way the flow is the same: the booking or pack purchase is created
`pending`, the customer is sent to a checkout page, and a signed
**`checkout.session.completed` webhook** (`backend/app/routers/webhooks.py`)
is what promotes the row to `confirmed`/`active` and sends the confirmation.
Confirmation is never granted on the return redirect alone. A payment that
arrives after the hold expired is still honoured (the row is reconciled), and
a webhook for an already-handled session is ignored.

## 7. Cancelling, and the credit

A `confirmed` booking can be cancelled by the customer, by an operator, or as
part of a series. On cancellation (`backend/app/booking_cancellation.py`):

- Any **paid** hours come back as a `cancellation_credit` purchase — the
  hours the recorded amount buys at the room's rate, with an expiry of
  `CANCELLATION_CREDIT_VALIDITY_DAYS`. Money never moves; the credit lives in
  the hour bank. One credit per booking, ever; never for an unpaid or
  `package` booking.
- Reinstating a cancelled booking takes the credit back, unless some of it
  was already spent, in which case a new booking is the way.

## 8. Access codes (smart locks)

Each customer gets **one door PIN**, not a code per booking (L01). It is
issued on their first **confirmed** booking (every checkout path), named on
the lock by our customer id, with no time window — freedom at the door, audit
afterwards. The PIN is encrypted at rest and shown only to the customer, on
their dashboard; the operator sees its status and can rotate, revoke or open
the door, never the clear code. Issuance only writes database rows; the
sweeper pass (`backend/app/holds.py`, under the N01 advisory lock) does the
lock work, so a lock outage never fails a payment, and a customer idle for
`ACCESS_DORMANCY_DAYS` is taken off the lock and re-registered on their next
booking. `LOCK_PROVIDER=stub` is an in-memory lock for local use;
`LOCK_PROVIDER=nuki` talks to the Nuki Web API (`docs/runbooks/nuki.md`). The
lock's log becomes the audit trail (L02).

## 9. Billing and invoices

Admins can issue **invoices** for a customer. Each invoice is a record
(number, date, amount, line items) plus an optional **private PDF** kept out
of public reach — the API streams it after an ownership check, never a public
URL, under both storage modes. The customer sees their invoices on
`/dashboard/billing`; the operator manages them on `/admin/billing`. The
dashboard also reports the month's money by type.

## 10. When emails are sent

Every message is queued after the HTTP response (FastAPI background tasks):
delivery does not block the request, a failure is logged and shown on the
admin **Email** card, and there is no automatic retry yet (roadmap O01). The
gateway is chosen by `EMAIL_MODE`: `stub` (logged, nothing leaves the host),
`ses` (Amazon SES with the instance role, production), or `live` (Resend).

In ordinary customer use mail goes out on:

| Event | To | Where |
|---|---|---|
| Password reset requested | the customer | `auth.py` |
| Booking confirmed by payment | the customer | `webhooks.py`, `checkout_stub.py` |
| Booking confirmed from a pack | the customer | `bookings.py` |
| Booking cancelled | the customer | `booking_cancellation.py` |
| Invoice issued | the customer | `admin/invoices.py` |
| Help form submitted | the customer (acknowledgement) and the support inbox | `support.py` |

Operator-initiated messages: creating a user or sending a set-password /
reset link, and confirming or changing a booking from the admin panel
(`admin/users.py`, `admin/bookings.py`). The admin Email card can also send a
test message to the operator's own address.

## 11. What operators do (the admin panel)

Gated to owners/admins of the organization, per org, every mutation audited
(`admin_actions`, newest-first, browsable at `/admin/audit`):

- **Rooms and spaces** — create, edit, activate/deactivate (with a
  future-bookings check), manage photos and their order.
- **Bookings and the calendar** — view, confirm, change and cancel; block
  time for maintenance or private use.
- **Users** — list, see a customer, grant admin, grant complimentary hours,
  send a password-reset or set-password link.
- **Packages and purchases** — manage the catalogue; extend a purchase's
  validity, see remaining hours.
- **Billing** — issue and manage invoices.
- **Settings** — organization settings, and the Email card (mode, sender,
  recent delivery failures, test send).

## 12. Modes and integrations, in one place

Each third party sits behind a thin gateway with a local fake, chosen by an
explicit env var; a missing credential in a live mode stops the app at
startup rather than silently running the stub (CLAUDE.md §10.3).

| Concern | Env var | Values |
|---|---|---|
| Payments | `STRIPE_MODE` | `stub` · `live` |
| Email | `EMAIL_MODE` | `stub` · `ses` · `live` (Resend) |
| Media storage | `MEDIA_STORAGE` | `local` · `s3` (CloudFront) |
| Smart locks | `LOCK_PROVIDER` | `stub` · `nuki` (one PIN per customer, L01) |
| Rate-limit store | `RATE_LIMIT_STORE` | `memory` · `postgres` (shared) |

The whole test suite runs with zero third-party credentials and never
touches the network.

## 13. Not built yet / parked

- **Recurring weekly series** — the API and UI exist but are gated off
  (`RECURRING_BOOKINGS_ENABLED=false`); hourly booking is the only product
  today (roadmap R02/R03).
- **Durable notifications and access** — the email outbox and the smart-lock
  integration are in-process foundations; retries and persistence remain
  O01/O04.
- **Abandoned-payment recovery and cash refunds** — C03/O02.

See `roadmap.md` for the outcome order and `TODO.md` for the current queue.
