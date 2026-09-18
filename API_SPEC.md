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

## Public Endpoints

### GET /spaces
List all active spaces (public).
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

Body: `{ room_id, start_time, end_time, notes?, payment_method? }`
Response: `{ booking: Booking, checkout_url: string | null }`
Errors: `403` not a member of the room's org, `404` unknown room, `409` slot
already booked *or* insufficient package hours.

### DELETE /bookings/:id
Cancel a booking (own only, if > 24h before; an unpaid checkout hold — `pending`
with a `hold_expires_at` — can be cancelled at any time). This is also how you
cancel **one occurrence** of a recurring series: the occurrence is marked
`cancelled` and the `RecurrenceRule` stays active. Package-paid bookings credit
hours back to the exact purchase they were taken from. `400` for `expired` and
`paid_unfulfilled` rows: they hold no slot to cancel.

### POST /bookings/:id/checkout
"Pagar agora" for an unpaid hold (own only). An hourly booking holds its slot
until `hold_expires_at` (`BOOKING_HOLD_MINUTES`, default 15); after that it reads
as `expired` and the hour is bookable again. This endpoint expires the previous
Checkout Session at the provider and mints a fresh one for the **same** booking:
a live `pending` hold gets a new deadline; an `expired` one becomes `pending`
again if its slot is still free. No second booking is ever created.
Response: `{ booking: Booking, checkout_url: string }` — same shape as `POST /bookings`.
`409` when the slot was taken meanwhile (the row stays `expired`), when the
booking is not an unpaid hourly hold (confirmed, package-paid, series
occurrence), or when the provider reports the previous session already paid
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
Body: `{ name, description, address, city, images?, amenities? }`

### PUT /admin/spaces/:id
Update a space.

### DELETE /admin/spaces/:id
Soft-delete a space.

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

### PUT /admin/bookings/:id
Update booking status.
Body: `{ status: "confirmed"|"cancelled" }`

### GET /admin/users
All users who have booked in this org.

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
  address: string
  city: string
  images: string[]
  amenities: string[]
  is_active: boolean
  created_at: string
  rooms?: Room[]
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
  total_amount: number
  // `expired`: an unpaid hold whose deadline passed (holds no slot; retry via
  // POST /bookings/:id/checkout). `paid_unfulfilled`: a payment arrived after
  // another booking took the slot; kept visible, refund handling is O02.
  status: "pending" | "confirmed" | "cancelled" | "completed" | "expired" | "paid_unfulfilled"
  payment_method: "hourly" | "package"
  notes?: string
  // Deadline of an unpaid checkout hold (C03). `null` when the row never
  // expires: package bookings, series occurrences, and every non-pending row.
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
