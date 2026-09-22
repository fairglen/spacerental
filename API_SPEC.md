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
| Availability rules | weekday 0 to 6, opening before closing, at most 50 per call |
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
null) and emails `SUPPORT_EMAIL` with `Reply-To` = the customer and subject
`[Ajuda] <categoria> — #<reference>`. A mail failure does not lose the request.
Throttled tightly (`RATE_LIMIT_SUPPORT_*`, default 5/hour per client) → `429`.
Response `201`: `{ request: { id, reference, status, created_at } }` — never the
message: a public endpoint does not reflect what it was sent.

### GET /spaces
List all active spaces (public). Each space carries its location: `address`,
`postal_code`, `city`, `latitude`, `longitude` (any of them may be `null`).
Response: `{ spaces: Space[] }`

### GET /spaces/:id
Space detail with rooms.
Response: `{ space: Space, rooms: Room[] }`

### GET /rooms/:id/availability
Query: `?date=YYYY-MM-DD`
Response: `{ slots: [{ start: ISO8601, end: ISO8601, available: bool }] }`

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
  ignores any such numbers in the body.
  - One purchase can cover the whole block → a plain `package` booking
    (confirmed, no `checkout_url`), exactly as above.
  - Otherwise the soonest-expiring purchase that still has hours gives what it
    has (one purchase per booking). Those hours are debited NOW, the booking is
    `pending` with `package_hours_used` set, `total_amount` is the money for the
    remaining hours only, and `checkout_url` charges just that. The Checkout
    description reads e.g. `1h Sala Calma (7h pagas com o pack)`.
  - No usable hours at all → a plain `hourly` booking.
  The reserved hours go back to the same purchase whenever the hold ends
  without being paid (backing out of Checkout, the hold expiring, a cancel) and
  are taken again if the hold is resumed. Confirmation changes nothing about
  them. Expiry is lazy: a lapsed hold's hours return the next time that
  customer's bookings, packs or a new booking are read, or the slot is touched.

Body: `{ room_id, start_time, end_time, notes?, payment_method? }`
Response: `{ booking: Booking, checkout_url: string | null }`
Errors: `403` not a member of the room's org, `404` unknown room, `409` slot
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
Body: `{ org_id }`
Response: `{ purchase: UserPackagePurchase, checkout_url: string }`

### GET /packages/me
My package purchases and remaining hours.
Response: `{ purchases: UserPackagePurchase[] }`

---

## Admin Endpoints (requires admin/owner role)

### GET /admin/dashboard
Stats: total bookings, revenue, occupancy rate, active users.

### GET /admin/spaces
All spaces for admin's org.

### POST /admin/spaces
Create a space.
Body: `{ name, description?, address?, city?, postal_code?, latitude?, longitude?, images?, amenities? }`

Location rules (422 otherwise): `postal_code` is at most 20 characters;
`latitude` is within -90..90 and `longitude` within -180..180, as a number or a
decimal string, rounded to 6 decimal places; `latitude` and `longitude` are
given together or not at all.

### PUT /admin/spaces/:id
Update a space. Omitted fields are left as they are. `postal_code`, `latitude`
and `longitude` may be cleared with an explicit `null`. The two coordinates are
one value: a body that carries one must carry the other (both numbers, or both
`null`), so an update can never leave half a point — sending only one is a 422.

### DELETE /admin/spaces/:id
Soft-delete a space.

### GET /admin/support/requests
The help-form inbox (C19), operator of `org_id` only. Newest first. Query:
`status?` (`new` | `closed`), `page` (default 1), `page_size` (default 20, max
100). A request whose tenant could not be resolved appears in no inbox.
Response: `{ requests: SupportRequest[], total, page, page_size }` where each
row is `{ id, reference, category, status, contact_email, user_id, booking_id,
booking: Booking | null, message, context, created_at, updated_at }`.

### PUT /admin/support/requests/:id
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

### PUT /admin/rooms/:id
Update a room.

### POST /admin/rooms/:id/availability
Set availability rules for a room.
Body: `{ rules: [{ day_of_week, open_time, close_time }] }`

### GET /admin/bookings
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
Any combination of (A01): a status change (`status`), a move (`start_time`,
`end_time`, `room_id` — the room must be in the same org, else `404`) and a
private note (`admin_note`). Omitted fields are unchanged; an empty body is
`422`. A move passes the same validity and conflict checks as a customer
booking (`400`/`409`) with NO 24h rule for operators, and moves NO money: a
changed duration recomputes nothing about `total_amount`; the response carries
`hours: { before, after }` and the operator settles the difference outside the
platform (known limitation). A moved confirmed booking gets the confirmation
email again with the line "A tua reserva foi alterada" and a new access code.
Response: `{ booking: AdminBooking, hours? }`.

`AdminBooking` = `Booking` + `admin_note: string | null`. **`admin_note` is
never returned by a customer endpoint.**
Body: `{ status: "confirmed"|"cancelled" }`

### GET /admin/users
The org's members (A05), searchable and paged.
Query: `q` (name or email, case-insensitive, ≤200 chars), `page` (≥1),
`page_size` (1–100, default 20).
Response: `{ users: OrgUser[], total, page, page_size }` where
`OrgUser = { id, email, name, role: "owner"|"admin"|"member", joined_at, bookings_count, created_at }`.
`bookings_count` counts the member's bookings in this org only.

### GET /admin/users/{user_id}
One member of this org: `{ user: OrgUser, bookings: AdminBooking[] (newest
first, ≤200, with `room`), purchases: AdminPurchase[] (with `package`),
support_requests: SupportRequest[] (≤50) }`. Everything is scoped to this
org. A person who is not a member → 404, identical to an unknown id.
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

### PUT /admin/purchases/{purchase_id}/expiry
"Prolongar validade" (A06). Body: `{ expires_at (tz-aware; later than the
current expiry and in the future), reason (1–2000) }` → `{ purchase:
AdminPurchase }`. The reason is appended to `admin_note`, dated. 400 when the
date does not extend; 409 unless the purchase is `active`; 404 for another
org's purchase or an unknown id.

### GET /admin/packages
List packages for this org.

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
  description: string
  capacity: number
  hourly_rate: number
  images: string[]
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
  package_id: string
  org_id: string
  hours_total: number
  hours_used: number
  hours_remaining: number
  amount_paid: number      // the package's price at purchase time; 0 for granted hours (A05)
  status: "pending" | "active" | "cancelled"
  purchased_at: string
  expires_at: string
  package: Package
}

type OrgMembership = {
  org_id: string
  role: "owner" | "admin" | "member"
}
```
