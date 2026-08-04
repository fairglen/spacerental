# TODO — Backlog

User stories for the items CLAUDE.md §11 marks as "intentionally not done yet," plus recurring bookings (design already agreed, no code yet). Each story is scoped to be picked up independently by an AI agent — acceptance criteria are Given/When/Then and name concrete endpoints, models, and files.

**Applies to every story below:** it ships with a way to exercise it locally — no real external account, no paid service, no deployed environment (CLAUDE.md §10.3). Third-party integrations get a stub implementation behind an explicit env-var switch, and the full test suite must pass with zero credentials configured.

The 7-item code-review followup (org_id/multi-org, AdminStats fields, require_admin dependency, booking-overlap constraint, Decimal normalization, dead code, test coverage) is **done** — all landed on `main` through commit `40c05bd`. Not repeated here.

## Priority

| Tier | Epic | Why this tier |
|---|---|---|
| **P0 — blocks going live** | 2. Stripe Payments | No real revenue without it; everything else is polish on top of an unpaid product. |
| | 7. Rate Limiting | CLAUDE.md §11 already flags this as needed "before exposing to the public internet" — required the moment this stops being POC-only. |
| **P1 — high-value, expected UX** | 4. Email Notifications | Booking with no confirmation email reads as broken to a real customer. |
| | 1. Recurring Bookings | Direct fit for the target user (therapists renting the same weekly slot) — design is already fully decided, lowest ambiguity to build. |
| **P2 — operational hardening, once there's traction** | 3. Seam Smart-Lock | Physical access matters, but a manually-shared code is a workable stopgap while validating the Lisbon location; wire this once it's clear the space is staying open. |
| | 8. Audit Log | Valuable for trust/dispute resolution, not blocking. |
| | 6. Row-Level Security | Manual `org_id` filtering already works; RLS is defense-in-depth, worth doing before onboarding a second org operator. |
| **P3 — defer until scale/expansion demands it** | 5. Pagination | Only matters once list sizes actually grow past a page. |
| | 9. i18n | Single-region (Portugal) product today; no multi-region ask yet. |

Suggested build order within tiers: **2 → 7 → 4 → 1 → 3 → 8 → 6 → 5 → 9.** Stripe unblocks real bookings, rate limiting is cheap and independent, then email + recurring bookings round out the core customer experience before investing in hardening.

---

## Epic 1 — Recurring Bookings

Design locked in: `RecurrenceRule` is the source of truth; `Booking` rows get a nullable `recurrence_rule_id` FK (flat expansion, not computed on read).

### 1.1 Create a recurring series
As a member, I want to book a weekly recurring slot in one request instead of booking each occurrence manually.

- **Given** `POST /api/v1/recurrences` with `{room_id, start_time, end_time, frequency: "weekly", until_date, notes?}`, **when** every generated occurrence is free, **then** one `RecurrenceRule` row and one `Booking` row per occurrence are created (each `Booking.recurrence_rule_id` set to the rule), and the response is `{"recurrence": {...}, "bookings": [...]}`.
- **Given** the same request, **when** at least one generated occurrence overlaps an existing `pending`/`confirmed` booking, **then** no rows are inserted at all and the response is `409` with `{"conflicts": ["2026-08-10T14:00:00Z", ...]}`.

### 1.2 Cancel one occurrence vs. the whole series
As a member, I want to cancel just one date or the rest of the series.

- **Given** a `Booking` with `recurrence_rule_id` set, **when** `DELETE /api/v1/bookings/{id}` is called, **then** only that occurrence is marked `cancelled` and the `RecurrenceRule` stays active.
- **Given** a series owner, **when** `DELETE /api/v1/recurrences/{id}?from_date=YYYY-MM-DD` is called, **then** that booking and all future bookings in the series (`start_time >= from_date`) are marked `cancelled` and `RecurrenceRule.is_active` is set to `False`.

### 1.3 Edit a series
As a member, I want to change the time for all future occurrences at once.

- **Given** `PUT /api/v1/recurrences/{id}` with `{start_time, end_time, until_date?}`, **when** the new occurrences are all free, **then** the `RecurrenceRule` is updated, not-yet-started bookings in the series are cancelled, and new `Booking` rows are generated at the new times.
- **Given** the same request, **when** any new occurrence conflicts, **then** nothing changes and the response is `409` with the conflicting dates (same all-or-nothing rule as creation). Past/completed bookings are never touched.

### 1.4 Frontend series booking UI
As a member, I want to see what I'm about to book before committing to a series.

- **Given** `frontend/components/booking/BookingModal.tsx`, **when** I toggle "repeat weekly" and pick an end date, **then** a preview list of generated dates renders before I submit.
- **Given** I submit and the API returns `409`, **when** the response includes `conflicts`, **then** the modal lists the conflicting dates inline instead of a generic error toast.

---

## Epic 2 — Stripe Payments

`Booking.total_amount` already exists and is `Decimal`-backed; wire Stripe on top of it.

### 2.1 Checkout for hourly bookings
- **Given** `POST /api/v1/bookings` with `payment_method: "hourly"`, **when** the room is available, **then** a Stripe Checkout Session is created for `total_amount`, the response includes `checkout_url`, and `Booking.status` stays `pending` until the webhook confirms payment.

### 2.2 Webhook confirms booking
- **Given** `POST /api/v1/webhooks/stripe` receives a `checkout.session.completed` event with a valid signature (verified against `STRIPE_WEBHOOK_SECRET`), **when** the session id matches a pending `Booking`, **then** `Booking.status` becomes `confirmed`.
- **Given** the same endpoint, **when** the signature is invalid, **then** the response is `400` and no DB write happens.

### 2.3 Package purchase checkout
- **Given** `POST /api/v1/packages/{id}/purchase`, **when** payment integration is enabled, **then** it follows the same Checkout Session + webhook pattern as bookings, and `UserPackagePurchase` is only marked active after the webhook confirms.

---

## Epic 3 — Seam Smart-Lock Integration

Booking timestamps are already shaped for time-scoped access codes.

### 3.1 Issue access code on confirmation
- **Given** a `Booking` transitions to `status: confirmed` (direct create or via Stripe webhook), **when** the Seam integration runs, **then** it requests a time-scoped code from Seam for the room's lock device valid for `[start_time, end_time]`, stores it, and returns it in the booking response.

### 3.2 Revoke code on cancellation
- **Given** a confirmed `Booking` with an issued access code, **when** `DELETE /api/v1/bookings/{id}` cancels it, **then** the Seam API is called to revoke the code before the response returns `204`.

### 3.3 Seam is best-effort, not a hard dependency
- **Given** the Seam API call fails or times out during booking create/cancel, **when** this happens, **then** the booking operation still succeeds with a 2xx and the failure is logged, not raised as a 500.

---

## Epic 4 — Email Notifications

Must go through a queue, never synchronously in the request (per CLAUDE.md §11).

### 4.1 Queue infrastructure
- **Given** a booking is confirmed, **when** the confirmation email needs to be sent, **then** a job is enqueued to a worker (Resend or Postmark, API key from `RESEND_API_KEY`/`POSTMARK_API_KEY` env var — fail loudly if missing, no silent fallback) and the HTTP response returns without waiting on delivery.

### 4.2 Booking confirmation email
- **Given** a queued confirmation job, **when** the worker processes it, **then** the user receives a Portuguese-language email with space/room name, date/time, and a cancellation link.

### 4.3 Cancellation email
- **Given** a booking is cancelled (by the user or an admin), **when** the cancellation commits, **then** a cancellation email job is enqueued.

---

## Epic 5 — Pagination

The wrapped response contract already supports adding this without breaking clients.

### 5.1 List endpoints accept paging
- **Given** `GET /api/v1/admin/bookings?page=2&page_size=20`, **when** called, **then** the response is `{"bookings": [...], "total": N, "page": 2, "page_size": 20}` — extending, not replacing, the existing wrap shape.

### 5.2 Frontend consumes pagination
- **Given** `frontend/components/admin/BookingsTable.tsx` and its `lib/api.ts` wrapper, **when** `total > page_size`, **then** pager controls appear and request subsequent pages.

---

## Epic 6 — Row-Level Security (RLS)

Would replace the manual `org_id` filters scattered across every query.

### 6.1 RLS policies enforce tenant isolation
- **Given** a new Alembic migration, **when** applied, **then** RLS is enabled on `bookings`, `spaces`, `rooms`, `packages`, `user_package_purchases`, each with a policy restricting rows to `current_setting('app.current_org_id')`, and the app sets `SET LOCAL app.current_org_id` per request (e.g. in `get_db` in `backend/app/database.py`).

### 6.2 Regression proof
- **Given** RLS is enabled, **when** a query runs against another org's row without `app.current_org_id` set for the current org, **then** it returns zero rows (not an error) — a backend test asserts this explicitly, proving isolation holds even if a route forgets an `org_id` filter.

---

## Epic 7 — Rate Limiting

Needed before exposing the app to the public internet.

### 7.1 Auth endpoint throttling
- **Given** repeated `POST /api/v1/auth/login` or `/auth/register` requests from the same IP, **when** more than 10 requests happen within a 1-minute window, **then** request 11+ returns `429` before Argon2 hashing or a DB query runs.

### 7.2 Public endpoint throttling
- **Given** `GET /api/v1/spaces` and `GET /api/v1/rooms/{id}/availability` are unauthenticated, **when** hit at high frequency from one IP, **then** they are rate-limited under a separate, higher threshold than auth endpoints.

---

## Epic 8 — Audit Log

Who-did-what for booking cancellations, role changes, etc.

### 8.1 Audit table
- **Given** a new `AuditLog` model (`org_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata` JSONB, `created_at`) in `backend/app/models/`, **when** a booking is cancelled or a role is changed via an admin endpoint, **then** a row is inserted in the same DB transaction as the mutating action.

### 8.2 Admin view
- **Given** `GET /api/v1/admin/audit-log?org_id=`, **when** called by an admin/owner (via `require_admin`), **then** the response is `{"entries": [...]}` ordered by `created_at` descending, and a new `frontend/app/admin/audit/page.tsx` renders it as a table.

---

## Epic 9 — i18n

Copy is hardcoded Portuguese today; extract before going multi-region.

### 9.1 Extract copy to a translation catalog
- **Given** hardcoded PT strings across `frontend/components/`, **when** they're moved into a single catalog (e.g. `pt.json`), **then** rendered output is unchanged — a snapshot test confirms no visible diff.

### 9.2 Add a second locale + switcher
- **Given** the `pt.json` catalog exists, **when** an `en.json` catalog and a locale switcher are added, **then** toggling language updates rendered copy and the choice persists across sessions (cookie or localStorage).
