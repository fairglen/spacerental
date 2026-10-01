# SpaceRental — Shared API Contract

Base URL: `http://localhost:8000/api/v1`

## Auth
All protected routes require `Authorization: Bearer <jwt>` header.
JWT is HS256, signed with the backend `SECRET_KEY`, issued by `POST /auth/login` or `POST /auth/register`.

## Roles
- `owner` — org owner, full admin
- `admin` — admin within an org
- `member` — regular user / customer

---

## Request bounds

Every request field is bounded, and input outside a bound is answered with
422, never stored and never a server error. The limits are technical and
generous; they live in `backend/app/schemas/bounds.py`.

| Field | Bound |
|---|---|
| Names (user, space, room, package) | 1 to 255 characters; a user's name may be empty |
| `city`, `address`, `description` | 100, 500, 5000 characters |
| `notes` (booking, series) | 2000 characters |
| `amenities`, `images` | at most 50 entries; 100 and 500 characters each; images are `http(s)` URLs |
| `color` | `#RRGGBB` |
| `capacity` | 1 to 10000 |
| `hourly_rate`, `price` | 0 to 99999999.99, two decimals |
| Package `hours`, `validity_days` | 1 to 999, 1 to 3650 |
| Availability rules | weekday 0 to 6, opening before closing, at most 50 per call; times are the space's wall clock (R01) |
| Booking and series instants, `until_date` | before the year 2100 |
| Admin list `page` | 1 to 1000000 |

No string may contain a NUL byte. On `PUT`, an omitted field is left as it is;
an explicit `null` is accepted only for `description`, `address` and `city`,
which it clears.

## Public Endpoints

### POST /support/requests
The help form ("Ajuda"). Public; a Bearer token is optional, but one that is
present and invalid is a `401` (an expired session is reported, not silently
filed as an anonymous request).
Body: `{ category: "technical" | "booking" | "payment" | "package" | "other",
message (20–2000 chars), contact_email?, booking_id?, context?, website? }`
- `contact_email` is required for a visitor and IGNORED for a signed-in
  customer, whose account address is used.
- `booking_id` is honoured only for the signed-in customer's OWN booking;
  someone else's is a `404` identical to a missing one. A visitor's is ignored.
- `context` is a whitelist — `page_url`, `viewport`, `user_agent`,
  `app_version`, `timestamp` — each bounded; anything else is dropped.
- `website` is a honeypot: a non-empty value is answered exactly like a success
  and nothing is stored or sent.
Stores a `support_requests` row (status `new`; `org_id` from the booking, else
the customer's only organisation, else `CUSTOMER_ENROLLMENT_ORG_SLUG`, else
null) and sends two emails (K03): the inbox copy to `SUPPORT_INBOX_EMAIL`
(default `geral+support@flowspace.pt`) with `Reply-To` = the customer,
subject `[Ajuda] <categoria> — #<reference>` and a link to
`/admin/support/<id>`; and the requester's copy to their address with
`Reply-To` = the inbox, subject `[FlowSpace] Recebemos o seu pedido
#<reference>`, the category, the booking's date and hours when one is
linked, and the message quoted (escaped). A mail failure does not lose the
request; the honeypot sends nothing.
Throttled tightly (`RATE_LIMIT_SUPPORT_*`, default 5/hour per client) → `429`.
Response `201`: `{ request: { id, reference, status, created_at } }` — never the
message: a public endpoint does not reflect what it was sent.

### GET /spaces
List all active spaces (public). Each space carries its location: `address`,
`postal_code`, `city`, `latitude`, `longitude` (any of them may be `null`).
Response: `{ spaces: Space[] }`

### GET /spaces/:id
Response: `{ space, rooms, contact: { email, phone } }` — `contact` is the
organisation's public contact when the owner set one (G04), else nulls, and
the customer-facing block keeps its default then.
Each room carries `availability_rules: [{ day_of_week, open_time, close_time }]`
(V06): its active opening windows, weekday 0 = Monday, times in UTC like every
rule (R01). "Onde estamos" derives the space's hours from their union. The
list endpoint (`GET /spaces`) does not load rooms.
Space detail with rooms.
Response: `{ space: Space, rooms: Room[] }`

### GET /rooms/:id/availability
Query: `?date=YYYY-MM-DD` — the SPACE's local date (R01).
Response: `{ slots: [{ start: ISO8601, end: ISO8601, available: bool, reason }] }`

Opening hours are the space's wall clock (`Space.timezone`, Europe/Lisbon for
the pilot): a room open "08:00–22:00" is open 08:00–22:00 on the door all
year, and the slots come back as UTC instants (08:00Z in winter, 07:00Z in
summer). Slots are whole hours on that clock, and a slot is a real hour of
the room's time: on the spring-forward day the hour that does not exist
yields no slot (one slot fewer across the change), and on the fall-back day
the repeated hour yields two slots, one per occurrence (one slot more) — both
are distinct, contiguous UTC instants. Lisbon changes its clocks at 01:00 UTC,
so a window such as 08:00–22:00 never spans the change and has 14 slots on
those days like on any other.

`reason` (H01) says why a slot is not bookable and is `null` exactly when
`available` is true: `"past"` (already started), `"beyond_window"` (later than
now + `BOOKING_MAX_ADVANCE_DAYS`, the customer's horizon), `"booked"` (a
booking holds it) or `"blocked"` (operator blocked time). One reason per slot,
in that order of precedence. A `date` after the window's last day (the space's
local date of that instant) is refused with `400` (`date is beyond the booking
window`) rather than served as all unavailable.

---

## Auth Endpoints

### POST /auth/register
Body: `{ email, password, name? }` (password 8-128 chars, Argon2id hashed)
Response: `{ access_token, token_type: "bearer", user: User, role: "owner"|"admin"|"member" }`

Customer registration returns 201 and `role: "member"`, enrolling only in
`CUSTOMER_ENROLLMENT_ORG_SLUG`. It creates no organization. Duplicate email: 400;
closed enrollment: 403; blank or unknown configured target: 503. Failures create
neither an account nor a membership. Caller-supplied tenant/role fields do not
select the target or grant privileges.

### POST /auth/register/operator
Body and authentication response envelope match `/auth/register`. Creates a new
organization and an owner membership deliberately; no access to existing orgs.
201 on success, 400 for duplicate email, 422 for invalid credentials. Shares
login/customer registration rate limits. Customer enrollment settings do not
control independent operator creation.

### POST /auth/enroll
Headers: `Authorization: Bearer <jwt>`. No request body.
Response (200): `{ membership: { org_id, role } }`.
Explicitly enrolls an existing user in the configured location. Idempotent even
under concurrent retries; preserves any existing role and other memberships.
401 without authentication; 403 when closed; 503 for a missing/unknown target.
No automatic account migration or enrollment on login.

### POST /auth/login
Body: `{ email, password }`
Response: `{ access_token, token_type, user, role }` — same shape as register

### POST /auth/password-reset/request
Body: `{ email }`. **Always 202** with `{ detail: "Se existir uma conta com
este email, vai receber uma ligação para repor a password." }` — whether or
not the email has an account, and whether or not that account is enabled —
so the endpoint says nothing about who is registered. When it does exist and
is enabled, one email with `<FRONTEND_URL>/reset-password/<token>`: a 32-byte
urlsafe token stored only as its SHA-256, valid 60 minutes, single use; a
new request invalidates the user's older unused links. Auth rate-limit tier.

### POST /auth/password-reset/confirm
Body: `{ token, password (8–128) }`. 400 `A ligação é inválida ou já expirou.`
for a token that is unknown, used, expired, or belongs to a disabled account
(one message for all, so tokens cannot be probed). Success (200) sets the
password, marks the token used and bumps the account's `token_version`,
which signs every earlier session out: the backend refuses the old bearer
token, and the app ends the NextAuth session that carried it the moment a
call answers 401 (`lib/sessionRevoked.ts`) — the dashboard layout also
checks the token against `GET /auth/me` before rendering, so a stale
cookie never gets the page (it lands on `/sign-in?session=expired`). Auth
rate-limit tier.

**Sessions and suspended accounts (G02/G03).** Every token carries `tv`, the
`token_version` it was issued under (older tokens without the claim read as
0); a token whose `tv` differs from the account's is a 401. A suspended
account (`disabled_at` set) gets 401 `A conta está desativada.` at login (after
the password check, so only the account's holder hears it), 401 `Account
disabled` on any token, and no reset email.

### GET /auth/me
Headers: `Authorization: Bearer <jwt>`
Response: `User`

---

## User Endpoints (requires auth)

### GET /bookings/me
My bookings list.
Response: `{ bookings: Booking[] }`

### POST /bookings
Create a booking. `payment_method` selects how it is paid for and therefore
what comes back:

- `hourly` (default) — the booking is `pending` and `checkout_url` points at the
  Checkout Session that will confirm it via webhook.
- `package` — prepaid hours are debited from the caller's active purchase in the
  same transaction, the booking comes back already `confirmed`, and
  `checkout_url` is `null` because there is nothing left to pay. Hours are taken
  from the soonest-expiring eligible purchase, and `409` is returned if no
  active, unexpired purchase in the room's org has enough hours for the whole
  block. Nothing is written when it fails.
- `mixed` — "use my pack and pay the rest". A request, not an instruction: the
  server alone decides the method stored, the pack share and the amount, and
  ignores any such numbers in the body. Since H02 the caller's purchases form
  ONE hour bank (every `active`, unexpired purchase in the room's org),
  drawn on soonest-expiring first, one `booking_package_debits` row per
  purchase touched:
  - The bank covers the whole block → a plain `package` booking (confirmed,
    no `checkout_url`), exactly as above, even when that takes several
    purchases.
  - Otherwise the bank gives everything it has — `min(duration, bank)`. Those
    hours are debited NOW, the booking is `pending` with `package_hours_used`
    set, `total_amount` is the money for the remaining hours only, and
    `checkout_url` charges just that. The Checkout description reads e.g.
    `1h Sala Calma (7h pagas com o pack)`.
  - An empty bank → a plain `hourly` booking.
  The reserved hours go back, each to the purchase it came from, whenever the
  hold ends without being paid (backing out of Checkout, the hold expiring, a
  cancel) and are taken again — from whatever the bank holds then — if the
  hold is resumed. Confirmation changes nothing about them. Expiry is lazy: a
  lapsed hold's hours return the next time that customer's bookings, packs or
  a new booking are read, or the slot is touched. `package` is the same walk
  all-or-nothing: `409` and nothing debited when the bank cannot cover the
  block.

  `Booking.package_purchase_id` is **deprecated** (H02): no longer written,
  kept nullable for one release. `package_hours_used` stays the booking's
  pack share for good; the per-purchase split is the operator's
  `package_debits` (below).

Body: `{ room_id, start_time, end_time, notes?, payment_method? }`
Response: `{ booking: Booking, checkout_url: string | null }`
Errors: `400` `start_time cannot be in the past`, `start_time is beyond the
booking window` (later than now + `BOOKING_MAX_ADVANCE_DAYS`, default 30 —
a customer's rule; operator endpoints have no horizon, H01), outside opening
hours; `403` not a member of the room's org, `404` unknown room, `409` slot
already booked *or* insufficient package hours.

### DELETE /bookings/:id
Cancel a booking (own only, if > 24h before; an unpaid checkout hold — `pending`
with a `hold_expires_at` — can be cancelled at any time). This is also how you
cancel **one occurrence** of a recurring series: the occurrence is marked
`cancelled` and the `RecurrenceRule` stays active. Bookings paid with pack hours credit
`package_hours_used` back to the exact purchase they were taken from — all of a
`package` booking, the prepaid share of a `mixed` one. Cancelling moves no money
for any method. `400` for `expired` and
`paid_unfulfilled` rows: they hold no slot to cancel.

**Cancellation credit (K01).** The money share of a cancelled paid booking —
all of an `hourly` or `manual` one, the paid hours of a `mixed` one — comes
back as hours in the customer's bank, never as a refund: one
`UserPackagePurchase` with `source: "cancellation_credit"`, `package: null`,
`source_booking_id` = the booking, `hours_total = hours_remaining =
total_amount / room.hourly_rate` (to 0.01), `amount_paid = total_amount` (so
money reports still add up), and `expires_at` = now +
`CANCELLATION_CREDIT_VALIDITY_DAYS` (default 365). Only a `confirmed` or
`completed` booking with `total_amount > 0` is credited: an unpaid hold, an
`expired` row and a `package` booking credit nothing. One credit per booking,
ever (unique `source_booking_id`); a booking cancelled, reinstated and
cancelled again reactivates its one row with a fresh expiry. The cancellation
email gains the line "As N horas pagas ficaram no seu banco de horas, válidas
até <data>." when a credit was created. Credited hours spend like any other:
`package` and `mixed` bookings draw them soonest-expiring first.

### POST /bookings/:id/checkout
"Pagar agora" for an unpaid hold (own only). An hourly booking holds its slot
until `hold_expires_at` (`BOOKING_HOLD_MINUTES`, default 15); after that it reads
as `expired` and the hour is bookable again. This endpoint expires the previous
Checkout Session at the provider and mints a fresh one for the **same** booking:
a live `pending` hold gets a new deadline; an `expired` one becomes `pending`
again if its slot is still free. No second booking is ever created.
Response: `{ booking: Booking, checkout_url: string }` — same shape as `POST /bookings`.
`409` when the slot was taken meanwhile (the row stays `expired`), when an
expired `mixed` hold's pack can no longer give back the hours it had reserved
(the split and price of an existing booking are never recomputed — book again),
when the booking is not an unpaid `hourly`/`mixed` hold (confirmed,
package-paid, series occurrence), or when the provider reports the previous session already paid
(`Payment already received…`: keep waiting for the webhook). `502` when the
provider cannot start or close a session.

### POST /recurrences
Experimental; returns 404 unless `RECURRING_BOOKINGS_ENABLED=true`.
Create a weekly recurring series, all-or-nothing. One `RecurrenceRule` plus one
`pending` booking per occurrence; each booking carries `recurrence_rule_id`.
Body: `{ room_id, start_time, end_time, until_date, frequency?, notes? }`
Response: `{ recurrence: Recurrence, bookings: Booking[] }`
`409` when any occurrence is taken: `{ detail, conflicts: string[] }` — the
start of every clashing occurrence. Nothing is written.

### PUT /recurrences/:id
Move a series to a new time, all-or-nothing. Not-yet-started occurrences are
cancelled and regenerated at the new times; past and in-progress occurrences are
never touched.
Body: `{ start_time, end_time, until_date? }`
Response: `{ recurrence: Recurrence, bookings: Booking[] }`, or the same `409`
`conflicts` shape with nothing changed.

### DELETE /recurrences/:id
Cancel future occurrences on/after the cutoff and deactivate the rule. Past
cutoffs cannot change history. If any affected occurrence starts within 24h,
the whole request is rejected (400); successful cancellation uses the individual
booking notification and package-credit behavior.
Query: `?from_date=YYYY-MM-DD` (UTC; defaults to now, i.e. everything remaining)
Response: `204`

### GET /packages
List available packages for an org.
Query: `?org_id=`

### POST /packages/:id/purchase
Purchase a package. Same Checkout pattern as `POST /bookings`: the purchase is
recorded `pending` and only the `checkout.session.completed` webhook (Stripe
or the local stub) flips it to `active` — that's what makes its hours
spendable.
Body: `{ org_id, return_to? }`
Response: `{ purchase: UserPackagePurchase, checkout_url: string }`

`return_to` (K02) is where Checkout sends the customer back to instead of the
dashboard: a relative path on the frontend — starts with a single `/`, no
`//`, backslash, scheme, host, fragment, whitespace or control characters,
at most 512 characters; anything else is `422` and no purchase is created.
The success URL becomes `<FRONTEND_URL><return_to>` + `pagamento=sucesso`
(`&` when the path already has a query, `?` otherwise), the cancel URL the
same with `pagamento=cancelado`; the stub checkout honours both. The booking
page sends `/spaces/<id>?room=&start=&end=` so it can reopen the slot.

### GET /packages/me
My package purchases and remaining hours, plus the hour bank they form (H02).
Response: `{ purchases: UserPackagePurchase[], balance: PackageBalance }` with
`PackageBalance = { hours_available, hours_expiring_next: { hours, expires_at }
| null }`: `hours_available` sums every `active`, unexpired purchase the
caller holds (across organizations, like the list — the product has one
location); `hours_expiring_next` is the slice that lapses first (purchases
lapsing at the same instant are added together), `null` when the bank is
empty. Lazy hold expiry runs first, so a lapsed mixed hold's hours are back in
the number.

---

## Admin Endpoints (requires admin/owner role)

Every admin mutation below writes exactly one row to the audit trail (G01)
in the same transaction as the change, so a refused or rolled-back call
leaves no row. Rows carry the entity's PUBLIC schema reduced to the keys
that changed (plus `id`); a create or delete keeps the whole snapshot. A
response carries `X-Request-ID` (honoured from the request when well-formed,
`[A-Za-z0-9._-]{1,64}`), and every row written during that request stores it.

### GET /admin/audit
The organisation's trail, newest first. Query: `entity_type?` (one of `space`,
`room`, `availability_rule`, `room_block`, `booking`, `user`, `package`,
`purchase`, `support_request`, `organization`; 422 otherwise), `entity_id?`,
`actor?` (user id), `from?`/`to?` (tz-aware instants on `created_at`),
`page` (default 1), `page_size` (default 20, max 100).
Response: `{ actions: [AdminAction], total, page, page_size }` where
`AdminAction = { id, org_id, actor: { id, name, email } | null, entity_type,
entity_id, action, before, after, reason, request_id, created_at }`.
`actor` is null for a system action or an account that no longer exists.

### GET /admin/spaces/:id/history · /admin/rooms/:id/history · /admin/bookings/:id/history · /admin/users/:id/history · /admin/packages/:id/history · /admin/purchases/:id/history · /admin/support/requests/:id/history
One entity's rows, same shape and paging as `/admin/audit`. The entity is
first found INSIDE the caller's organisation: another org's id or an unknown
one is a 404 with no further detail. A user's history stays readable after
the membership is gone (anonymised or removed) because the trail itself is
the proof they were here.

### Deletion policy (G02)
Deleting a money-bearing or history-bearing row is never a plain DELETE.
Every hard delete below, the membership removal and anonymisation take
`confirm=<entity name or short id>` — the short id is the first 8 hex
characters of the uuid — and answer 422 without it or with a mismatch. A
refused delete is a 409 whose `detail` is `{ message, blockers }`. Each
successful one writes one audit row with the whole entity in `before`.

| Entity | Everyday delete | Hard `DELETE` allowed when | Otherwise |
|---|---|---|---|
| Space | `PUT is_active=false` | no room of the space ever had a booking | 409, `blockers: [{ room_id, name, bookings }]` |
| Room | `PUT is_active=false` (A07's future-bookings 409 stays) | zero bookings and zero blocks ever (cancelled and expired count) | 409, `blockers: { bookings, blocks }` |
| Availability rule | — | always (`DELETE /admin/rooms/:id/availability/:rule_id`, no confirm: recreated in one click) | — |
| Booking | cancel (`PUT status=cancelled`) | `expired`; or `cancelled` with `total_amount` 0 and no debit rows; or an operator's `manual` booking with `reason=` (422 without one) | 409 "cancel it instead" |
| User | `POST /admin/users/:id/anonymise` (below) | nothing references the account: no booking, purchase or help request anywhere; not yourself; not the last owner; no membership in another organisation | 409 with the counts or the rule |
| Membership | — | `DELETE /admin/users/:id/membership`: not yourself, not the last owner | 409 |
| Package | `PUT is_active=false` | zero purchases ever | 409, `blockers: { purchases }` |
| Purchase | `PUT /admin/purchases/:id` `{ status: "cancelled", reason }` | `amount_paid` 0 and no debit rows | 409, `blockers: { amount_paid, debits }` |
| Support request | — | always (spam) | — |
| Organisation | not deletable from the panel | — | — |

### POST /admin/users/:id/anonymise
Body: `{ confirm, reason? }` → `{ user: { id, email, name, disabled_at } }`.
Name, email and avatar become placeholders (`Utilizador removido`,
`utilizador-<short id>@anon.invalid`), the password is removed, the account
is disabled for good, `token_version` is bumped (every session out), every
reset link is deleted and the membership here is removed. Bookings,
purchases and help requests keep pointing at the placeholder. 409 for
yourself, for the organisation's last owner, and for an account that also
belongs to another organisation (the row is global, the operator's authority
is not); 404 for a non-member. Audited as `anonymise` with the reason.

**Owners are only another owner's to change.** `PUT /admin/users/:id`
(name, email, suspension), `POST …/set-password`, `POST …/anonymise`,
`DELETE /admin/users/:id` and `DELETE …/membership` answer 403 when the
target is an owner of the organisation and the caller is an admin: any of
them would let an admin take the organisation over (re-address the owner,
then use the public reset flow). Sending the reset link (`POST
…/password-reset`) stays allowed — it reaches the owner's own inbox. The
last-owner rule counts under the organisation's row lock, so two owners
removing each other at once leave one (the second answers 409).

### PUT /admin/purchases/:id
Body: `{ status?: "active" | "cancelled", admin_note?, reason? }` → `{ purchase:
AdminPurchase }`. A status change requires `reason` (422 otherwise);
`cancelled` sets `hours_remaining` to 0 and leaves the debit rows of bookings
already paid with it untouched — no money moves; `active` brings it back with
`hours_total - hours_used`. 409 for a `pending` (unpaid) purchase. Audited as
`cancel` / `reactivate` / `update`.

### GET /admin/organization · PUT /admin/organization
The organisation's settings (G04): `{ organization: { id, name, slug, plan,
contact_email, contact_phone, timezone, created_at, updated_at } }`. Admins
read; only the owner writes (403 otherwise). PUT body: `{ name?,
contact_email?, contact_phone?, timezone? }` — an explicit `null` clears a
contact; `slug` is read-only; `timezone` is an IANA name. The contact and
the timezone live in `organizations.settings`; the public space detail
carries the contact.

### GET /admin/dashboard
Stats: total bookings, revenue, occupancy rate, active users.

### GET /admin/spaces
All spaces for admin's org.

### POST /admin/spaces
Create a space.
Body: `{ name, description?, address?, city?, postal_code?, latitude?, longitude?, timezone?, images?, amenities? }`

`timezone` (R01) is an IANA zone name (`Europe/Lisbon` by default; 422 for a
name the backend cannot resolve): the clock every room's availability rules
are read on. `PUT /admin/spaces/:id` accepts it too.

Location rules (422 otherwise): `postal_code` is at most 20 characters;
`latitude` is within -90..90 and `longitude` within -180..180, as a number or a
decimal string, rounded to 6 decimal places; `latitude` and `longitude` are
given together or not at all.

### GET /admin/spaces/:id
One space for its page (G04): `{ space (rooms embedded, each with its active
`availability_rules`), photo_count (space + rooms), bookings: { total,
upcoming } }`. 404 for another org's space.

### PUT /admin/spaces/:id
Update a space. Omitted fields are left as they are. `postal_code`, `latitude`
and `longitude` may be cleared with an explicit `null`. The two coordinates are
one value: a body that carries one must carry the other (both numbers, or both
`null`), so an update can never leave half a point — sending only one is a 422.

### DELETE /admin/spaces/:id
Hard delete under the deletion policy above (`confirm=` required). The rooms,
their rules and blocks and every photo file go with it. Deactivating is
`PUT { is_active: false }`.

### GET /admin/support/requests
The help-form inbox (C19), operator of `org_id` only. Newest first. Query:
`status?` (`new` | `closed`), `page` (default 1), `page_size` (default 20, max
100). A request whose tenant could not be resolved appears in no inbox.
Response: `{ requests: SupportRequest[], total, page, page_size }` where each
row is `{ id, reference, category, status, contact_email, user_id, booking_id,
booking: Booking | null, message, context, created_at, updated_at }`.

### GET /admin/support/requests/:id
One request for its page (G04): the inbox row plus `admin_note` and `user:
{ id, name, email } | null`.

### PUT /admin/support/requests/:id
Body (G04): `{ status?: new | in_progress | closed, admin_note? }`, at least
one. `{ request }` with the note and the person.
Body: `{ status: "new" | "closed" }` — mark handled, or reopen. `404` for
another organisation's request. Response: `{ request: SupportRequest }`.
Answering happens by email (the notification carries `Reply-To`); nothing here
sends anything. Full handling stays deferred (TODO.md D06).

### Blocked time: GET · POST /admin/rooms/:id/blocks · PUT · DELETE /admin/rooms/:id/blocks/:block_id
A stretch of time the operator takes a room out of service (A02). Operator of
`org_id` only; the room is looked up inside the org first (`404` otherwise).
Body (POST): `{ start_time, end_time, reason }`; PUT takes any subset. A block
may have started already but may not lie entirely in the past (`400`), and is
at most 31 days long (`400`). A block counts as unavailable everywhere a
booking does: hidden in `GET /rooms/:id/availability` and refused by every
booking path's conflict check, customer and operator alike (`409`).
A block over a booking that holds its slot is refused — `409` with
`detail: { detail, conflicts: [{ id, start_time, end_time, status }] }` — the
operator moves or cancels the booking first; nothing is overridden silently.
Two blocks on one room may not overlap (database EXCLUDE constraint; `409`).
GET accepts `from`/`to` to window the list. Responses: `{ blocks: RoomBlock[] }`,
`{ block: RoomBlock }`, `204` on delete, where `RoomBlock = { id, org_id,
room_id, start_time, end_time, reason, created_by, created_at }`.

### Photos: POST /admin/rooms/:id/images · POST /admin/spaces/:id/images
Upload ONE photo (`multipart/form-data`, field `file`). Operator of `org_id`
only; the room/space is looked up inside that org first, so another tenant's id
answers `404` exactly like an id that does not exist.
The file is judged by its content, never its name or Content-Type: JPEG, PNG or
WebP, else `415`; more than 8 MB (or 50 megapixels) → `413`; an 11th photo →
`409`. On upload the image is rotated per its EXIF orientation, stripped of ALL
metadata, resized to at most 1600px on the long edge, re-encoded as WebP
(q≈82) with a 480px thumbnail, and stored under a random name.
Throttled (`RATE_LIMIT_UPLOAD_*`, default 30/min per client) → `429`.
Response `201`: the updated entity, `{ room: Room }` / `{ space: Space }`.

### PUT /admin/rooms/:id/images/order · PUT /admin/spaces/:id/images/order
Body: `{ order: string[] }` — EVERY current photo id, once, in the order wanted.
The first is the cover. Anything that is not a permutation of the current list
(one missing, unknown or repeated — e.g. a list gone stale) → `409`.
Response: the updated entity.

### DELETE /admin/rooms/:id/images/:image_id · DELETE /admin/spaces/:id/images/:image_id
Removes the photo and its files. Response `200` with the updated entity (not
`204`: the caller needs the new list and cover). `404` for an unknown photo.

### GET /media/...
The stored photo files, read-only, served by the API while
`MEDIA_STORAGE=local` (`image/webp`, `X-Content-Type-Options: nosniff`). Clients
never build these URLs: they arrive ready-made in `photos`.

### POST /admin/spaces/:id/rooms
Add a room to a space.
Body: `{ name, description, capacity, hourly_rate, color, amenities?, images? }`
`description` is the operator's **internal note** since V03 ("Notas internas
(não visíveis ao cliente)" in the admin): it is still returned by the public
room endpoints for compatibility but no customer screen renders it — the
photos say what the room is like.

### GET /admin/rooms/:id
One room for its page (G04): `{ room, space, rules: [AvailabilityRule with
ids], blocks: [RoomBlock] (the next 30 days), photo_count, bookings: { total,
upcoming } }`.

### POST /admin/rooms/:id/duplicate
A copy in the same space (G04): name + " (cópia)", description, capacity,
rate, colour, amenities and the opening rules; not the photos. 201 `{ room }`,
audited as `duplicate` on the new room.

### POST /admin/rooms/:id/availability/copy-to-all-days
Body: `{ day_of_week }` (0 = Monday). Every other weekday gets that day's
window(s); 422 when the source day is closed. `{ rules }`, audited like the
replace-all (`availability.set`, whole schedule before/after).

### PUT /admin/rooms/:id
Update a room. `is_active: false` switches it off for customers (A07) — but
not while bookings still hold future slots in it: then **409** with
`detail = { message, total, bookings: [{ id, start_time, end_time, status,
customer_email, customer_name }] }` (soonest first, at most 20; `total` is the
true count) and the room stays active. Move or cancel them first.
`is_active: true` is always accepted.

### POST /admin/rooms/:id/availability
Set availability rules for a room.
Body: `{ rules: [{ day_of_week, open_time, close_time }] }`

### GET /admin/bookings/:id
One booking for its page (G04): `{ booking: AdminBookingDetail, history:
[AdminAction] (last 20) }`. `AdminBookingDetail` is the admin booking plus
`stripe_checkout_session_id` — never in a customer response — with the
customer, room, `payment_method`, `total_amount`, `package_debits` per
purchase, `access_code`, `notes`, `admin_note` and `hold_expires_at`.

### GET /admin/bookings
Query (G04): `q` matches the customer's name or email (case-insensitive) or
the booking's short id prefix; `payment_method`; `include_cancelled`
(default true; false hides `cancelled` rows); `sort` = `start_time` |
`-start_time` (default) | `created_at` | `-created_at`; plus `room_id`,
`status`, `from`, `to`, `page`, `page_size` as before.
All bookings for org.
Query: `?status=&room_id=&from=&to=`

### POST /admin/bookings
A booking the operator makes for a customer, paid or arranged outside the
platform (A01). Body: `{ user_id, room_id, start_time, end_time, admin_note?,
notes? }`. The customer must be a member of `org_id` and the room in it (else
`404`); the same validity and conflict checks as a customer booking (`400`,
`409`), but no 24h rule. Created `confirmed` with `payment_method: "manual"`,
an access code and the confirmation email. `total_amount` is the slot's value
for the record; nothing is charged. Response `201`: `{ booking: AdminBooking }`.

### POST /admin/bookings/:id/mark-paid
Body: `{ reason }` (required). A `pending` or `expired` `hourly`/`mixed` hold
the customer paid some other way (cash, MB WAY): becomes `confirmed` with
`payment_method: "manual"`, an access code and the confirmation email; the
reason is appended to `admin_note`. The open Checkout Session is expired at the
provider and the row loses its session id, so a late
`checkout.session.completed` cannot double-confirm it. An expired hold's slot
is re-checked (`409` if taken); a lapsed `mixed` hold's pack hours are taken
again (`409` if gone). `409` for anything that is not an unpaid hourly/mixed
hold. Response: `{ booking: AdminBooking }`.

### PUT /admin/bookings/:id
Also (G04): `notes` (the customer-visible note) and the price override —
`total_amount` (≥ 0, 2 decimals) with a required `reason` (422 without one).
No charge and no refund is made; the recorded amount changes, the customer's
dashboard shows it, and the trail keeps the old and new amounts with the
reason (`price.override`). `status` may be set to any value, `completed`
included and back, under the same slot and pack-hour rules.
Any combination of (A01): a status change (`status`), a move (`start_time`,
`end_time`, `room_id` — the room must be in the same org, else `404`) and a
private note (`admin_note`). Omitted fields are unchanged; an empty body is
`422`. A move passes the same opening-hours and conflict checks as a customer
booking (`400`/`409`) with NO 24h rule and NO booking window for operators.
The past rule is an operator's (H03): a booking that has already started may
keep its start — or be given a later one — while the end or the room
changes; only a START earlier than both now and the original is `400`
(`start_time cannot be in the past`), and the new END must lie ahead (`400`
`end_time cannot be in the past`). A move moves NO money: `total_amount` is
never recomputed. The PACK share does follow the new length (H03) through
the hour bank: shrinking credits the surplus back, latest-expiring purchase
first, so the hours that lapse soonest stay spent; growing draws the extra
from the bank, soonest-expiring first. The response carries `hours: {
before, after, uncovered? }` — `uncovered` is what the bank could not give
for a longer booking (the operator settles it with the customer outside the
platform; no charge is created). A write that still trips a database
constraint answers `409` `The change violates a constraint (<name>)`, never
`500`. A moved confirmed booking gets the confirmation email again with the
line "A sua reserva foi alterada" and a new access code.
Response: `{ booking: AdminBooking, hours?, credit? }`.

Cancelling (K01): `status: "cancelled"` on a paid booking creates the
cancellation credit described under `DELETE /bookings/:id` unless
`credit_hours: false` is sent — which needs a `reason` (`422` without one;
the trail keeps it). The response then carries `credit: { id, hours,
expires_at }` when one was created. Reinstating a cancelled booking
(`status` back to `pending`/`confirmed`/`completed`) takes the credit back
if none of it was spent; once any credited hour went into another booking
the reinstatement is `409` `The hours credited for this cancellation were
already used; make a new booking instead`.

`GET /admin/bookings/:id` also carries `cancellation_credit: { id,
hours_total, hours_remaining, status, expires_at } | null`.

`AdminBooking` = `Booking` + `admin_note: string | null` +
`package_debits: [{ purchase_id, hours, package_name, expires_at }]` (H02: the
purchases the booking's pack hours are currently drawn from, soonest-expiring
first; empty when it holds no hours). **Neither is returned by a customer
endpoint.**
Body: `{ status: "confirmed"|"cancelled" }`

### POST /admin/users/{user_id}/password-reset
"Enviar ligação de recuperação" (G03): sends the customer the same single-use,
one-hour link they could ask for themselves, recording the operator on the
token. 202 `{ sent_to, sent_at }`; 409 when the account is suspended; 404 for
a non-member. Audited as `password_reset.send` — the row never carries the
token.

### POST /admin/users/{user_id}/set-password
"Definir password" (G03). Body: `{ password (8–128) }` → `{ user: OrgUser }`.
Sets the password, bumps `token_version` (every session out) and deletes the
account's open reset links. Allowed on a suspended account (they still cannot
sign in until reactivated). Audited as `password.set` without the value. Auth
rate-limit tier.

### GET /__test__/emails
**Local only.** Mounted only with the explicit opt-in `TEST_HOOKS_ENABLED=true`
(off by default; the dev Compose stack sets it), `EMAIL_MODE=stub` and
`APP_ENV != production`:
`{ emails: [{ to, subject, links }] }`, the last 20 messages the stub gateway
"sent", so a browser test can follow a reset link. Absent from a production
app.

### POST /admin/users
Body: `{ email, name?, password? (8–128) }` → 201 `{ user: OrgUser }`, enrolled
as a member. Without `password` the person gets a "Defina a sua password"
email with a one-hour link (the G03 flow); with one, nothing is sent. 409
when the email has an account. The response and the trail never carry a
password.

### PUT /admin/users/{user_id}
Body: `{ name?, email? (409 when taken), disabled_at? }` → `{ user: OrgUser }`.
An instant in `disabled_at` suspends the account (signed out everywhere at
once; login and reset requests refused); an explicit `null` reactivates.
409 for your own account. Audited as `suspend` / `reactivate` / `update`.

### GET /admin/users
Query (G04): `role` (owner|admin|member), `disabled` (true|false), `sort` =
`name` (default) | `-name` | `email` | `-email` | `joined_at` | `-joined_at`;
plus `q`, `page`, `page_size`. Rows carry `disabled_at`.
The org's members (A05), searchable and paged.
Query: `q` (name or email, case-insensitive, ≤200 chars), `page` (≥1),
`page_size` (1–100, default 20).
Response: `{ users: OrgUser[], total, page, page_size }` where
`OrgUser = { id, email, name, role: "owner"|"admin"|"member", joined_at, bookings_count, created_at }`.
`bookings_count` counts the member's bookings in this org only.

### GET /admin/users/{user_id}
One member of this org: `{ user: OrgUser, bookings: AdminBooking[] (newest
first, ≤200, with `room` and `package_debits`), purchases: AdminPurchase[]
(with `package`), balance: PackageBalance (the same hour bank the customer
sees, over this org's purchases), support_requests: SupportRequest[] (≤50) }`.
Everything is scoped to this org. A person who is not a member → 404,
identical to an unknown id.
`AdminPurchase` = `UserPackagePurchase` + `admin_note: string | null`.

### PUT /admin/users/{user_id}/role
Body: `{ role: "admin" | "member" }` — per org. Response `{ user: OrgUser }`.
409 when the target is yourself or an owner; 422 for `owner`; 404 for a
non-member.

### POST /admin/users/{user_id}/complimentary-hours
Complimentary hours (A05): a purchase of `hours` of `package_id` at 0,00 €
with a reason. Body: `{ hours (0 < h ≤ 999, 2 dp), package_id, reason
(1–2000), expires_at? (tz-aware, future; default now + the package's
`validity_days`) }`. → 201 `{ purchase: AdminPurchase }` with
`amount_paid: "0.00"`, `admin_note = reason`, `status: "active"`. 404 for a
non-member or a package of another org; 400 for a past `expires_at`.

`UserPackagePurchase` now carries `amount_paid` (the package's price at
purchase time, or `"0.00"` for granted hours). `admin_note` is never returned
by a customer endpoint.

### GET /admin/purchases
"Banco de horas" (G04). Query: `user_id`, `package_id`, `status`,
`expiring_before` (tz-aware), `page`, `page_size`. `{ purchases: [AdminPurchase
+ user: { id, name, email }], total, page, page_size }`, newest first.

### GET /admin/purchases/{purchase_id}
`{ purchase: AdminPurchase, user: { id, name, email }, debits: [{ booking_id,
hours, start_time, end_time, status, room_name }] }` — every booking still
drawing on it.

### POST /admin/purchases/{purchase_id}/adjust
Body: `{ hours (≠ 0, ± with 2 decimals), reason }` → `{ purchase }`. Both
`hours_total` and `hours_remaining` move by the delta. The balance can never
go below zero: the hours bookings already drew stay theirs, and the 409 lists
them (`blockers: [debit]`). Audited as `adjust` with the reason.

### PUT /admin/purchases/{purchase_id}/expiry
"Prolongar validade" (A06). Body: `{ expires_at (tz-aware; later than the
current expiry and in the future), reason (1–2000) }` → `{ purchase:
AdminPurchase }`. The reason is appended to `admin_note`, dated. 400 when the
date does not extend; 409 unless the purchase is `active`; 404 for another
org's purchase or an unknown id.

### GET /admin/packages
List packages for this org.

### GET /admin/packages/:id
`{ package, purchases: { total, active }, hours_outstanding }` (G04) —
`active` = spendable now, `hours_outstanding` their remaining hours.

### POST /admin/packages
Create a package.
Body: `{ name, hours, price, validity_days }`

---

## Data Types

```typescript
type Space = {
  id: string
  org_id: string
  name: string
  description: string
  address: string | null
  city: string | null
  postal_code: string | null
  // Decimal strings on the wire ("38.755723"), like money; both or neither.
  // frontend/lib/api.ts converts them to numbers and keeps null as null.
  latitude: string | null
  longitude: string | null
  timezone: string             // IANA zone the rooms' opening hours are read on (R01)
  // Legacy list of external URLs; nothing renders it. Left as it was.
  images: string[]
  // Uploaded photos in display order, first = cover (C14).
  photos: Photo[]
  amenities: string[]
  is_active: boolean
  created_at: string
  rooms?: Room[]
}

type Photo = {
  id: string
  url: string         // absolute; up to 1600px on the long edge, WebP
  thumb_url: string   // absolute; up to 480px
  width: number | null   // of `url`; null for a photo carried over from `images`
  height: number | null
}

type Room = {
  id: string
  space_id: string
  org_id: string
  name: string
  description: string          // operator's internal note (V03); not rendered to customers
  capacity: number
  hourly_rate: number
  images: string[]
  availability_rules?: { day_of_week: number; open_time: string; close_time: string }[]  // on GET /spaces/:id (V06)
  amenities: string[]
  color: string
  is_active: boolean
}

type Booking = {
  id: string
  org_id: string
  room_id: string
  user_id: string
  start_time: string   // ISO8601
  end_time: string
  duration_hours: number
  // `hourly`/`mixed`: the money charged. `package`: the slot's value (nothing
  // was charged; the pack was paid for earlier). Revenue sums hourly + mixed.
  total_amount: number
  // Hours paid with the linked pack: 0 for `hourly`, the whole duration for
  // `package`, strictly in between for `mixed`. Fixed at creation.
  package_hours_used: number
  // `expired`: an unpaid hold whose deadline passed (holds no slot; retry via
  // POST /bookings/:id/checkout). `paid_unfulfilled`: a payment arrived after
  // another booking took the slot; kept visible, refund handling is O02.
  status: "pending" | "confirmed" | "cancelled" | "completed" | "expired" | "paid_unfulfilled"
  payment_method: "hourly" | "package" | "mixed"
  notes?: string
  // Deadline of an unpaid checkout hold (C03). `null` for package bookings,
  // series occurrences and any booking once it is confirmed. It is kept on
  // `expired` rows and on a hold the customer cancelled while still unpaid:
  // that marker is how a late `checkout.session.completed` is recognised as
  // paying an unpaid hold (never a cancelled paid booking).
  hold_expires_at: string | null
  room?: Room
  user?: User
  created_at: string
  // Seam smart-lock code (Epic 3), present once the booking is confirmed.
  // Not a DB column — read from the lock gateway's in-memory table, so it
  // resets on a backend restart and is `null` if Seam issuance failed
  // (best-effort, never blocks the booking) or the booking isn't confirmed.
  access_code: string | null
}

type User = {
  id: string
  clerk_id: string
  email: string
  name: string
  avatar_url?: string
}

type Package = {
  id: string
  org_id: string
  name: string
  hours: number
  price: number
  validity_days: number
  is_active: boolean
}

type UserPackagePurchase = {
  id: string
  user_id: string
  package_id: string | null   // null for a cancellation credit (K01)
  org_id: string
  hours_total: number
  hours_used: number
  hours_remaining: number
  amount_paid: number      // the package's price at purchase time; 0 for granted hours (A05);
                           // what the cancelled booking cost for a credit (K01)
  status: "pending" | "active" | "cancelled"
  source: "purchase" | "complimentary" | "cancellation_credit"   // K01
  source_booking_id: string | null                              // the cancelled booking of a credit
  purchased_at: string
  expires_at: string
  package: Package | null
}

type OrgMembership = {
  org_id: string
  role: "owner" | "admin" | "member"
}
```
