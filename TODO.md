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

**Bugs (below) outrank all of it.** The core booking flow is broken today — shipping more features on top of a booking UI that can't book is the wrong order.

---

## Bugs

### B1 Multi-hour bookings are impossible — a drag always books exactly one hour
The core booking flow is broken. Selecting 09:00–12:00 on the calendar creates a 09:00–10:00 booking.

**Root cause** (confirmed in code, not speculation): `frontend/components/booking/BookingCalendar.tsx:52` — `handleSelectSlot` destructures only `{ start }` from react-big-calendar's selection payload and **discards `end`**. It then finds the single availability slot whose start matches exactly and calls `onSlotSelect(slot.start, slot.end)`. With `step={60}` and `timeslots={1}`, that is always a one-hour range no matter how far the user dragged.

- **Given** a room with 09:00–12:00 free, **when** I drag across 09:00 to 12:00 in the day view, **then** the modal shows *Duração 3h* and the total is `3 × hourly_rate`, and confirming creates one booking spanning 09:00–12:00.
- **Given** a drag spanning 09:00–12:00 where 10:00–11:00 is already taken, **when** I release, **then** the selection is rejected with a message naming the unavailable hour — it must not silently book a shorter range or create a booking overlapping the taken slot.
- **Given** a single click on one free hour, **when** it registers, **then** behavior is unchanged from today (a 1-hour booking).
- **Given** the drag crosses a boundary the backend rejects, **when** `POST /bookings` returns 409, **then** the modal surfaces the conflict rather than the generic *Erro ao criar reserva*.

### B2 Booking several separate blocks in one day (gaps for lunch) is unverified
Following from B1: a therapist booking 09:00–12:00 and 14:00–18:00 on the same day must end up with **two** bookings and a free 12:00–14:00, with no accidental merge into one 09:00–18:00 block and no phantom hold over lunch.

- **Given** I book 09:00–12:00 and then 14:00–18:00 on the same room and day, **when** both confirm, **then** `GET /bookings/me` returns two distinct bookings and the calendar shows 12:00–14:00 still free and bookable.
- **Given** those two bookings exist, **when** another user loads that day's availability, **then** only 09:00–12:00 and 14:00–18:00 read as unavailable.

### B3 Recurring bookings do not exist in the UI (not a regression)
Recorded because it was reported as broken: there is **no recurrence code anywhere** — `grep -ri "recurr\|repeat\|semanal"` returns nothing across `frontend/` and `backend/app/`. Nothing is broken; the feature was never built. It is **Epic 1**, and story 1.4 is the UI half. No separate bug fix needed — this entry exists so it isn't tracked twice.

### B4 After Stripe lands, the booking flow dead-ends at *Pendente*
`POST /bookings` now returns a `checkout_url`, but `BookingModal` never navigates to it — `onSuccess` just closes the dialog. The user sees a *Pendente* booking, is never sent to payment, and it can never be confirmed. This was out of the payments agent's file fence, so it shipped incomplete by design.

- **Given** a successful `POST /bookings` response carrying `checkout_url`, **when** the mutation succeeds, **then** the browser navigates to that URL instead of silently closing the modal.
- **Given** `STRIPE_MODE=stub`, **when** I complete the stub checkout flow locally, **then** the booking reaches `confirmed` and appears as such on the dashboard — no Stripe account required (§10.3).

### B5 E2E coverage for the real booking shapes
`frontend/tests/e2e/booking.spec.ts` is a smoke test; none of B1/B2 would have been caught by it. Add Playwright specs for the flows people actually perform. These are the regression net for B1, B2 and B4 — write them so they **fail against today's code**.

- **Given** a signed-in user, **when** they book a recurring-style morning block (09:00–12:00, a single multi-hour drag), **then** the dashboard shows one 3-hour booking with the correct total.
- **Given** a signed-in user, **when** they book 09:00–12:00 and 14:00–18:00 on the same day, **then** two bookings appear and the lunch gap stays bookable.
- **Given** a booked slot, **when** a second user opens the same day, **then** those hours render as *Ocupado* and are not selectable.
- **Given** a user cancels a booking, **when** the cancellation succeeds, **then** the freed hours become selectable again on the calendar.
- **Once Epic 1 ships:** booking a weekly recurring morning generates the expected series, and cancelling one occurrence leaves the rest intact.

---

## Tech Debt

Known-and-accepted shortcuts. Each names why it was deferred, so the next person isn't re-deriving it.

### T8 Alembic and `Base.metadata.create_all` are two competing sources of schema truth — **blocker**
Discovered while proving T1. The revision-id fix in T1 is real, but it does not make migrations work: **`alembic upgrade head` cannot succeed against any database, empty or existing.** Verified against a throwaway PostgreSQL 16 — every migration in the chain fails independently:

- **There is no baseline migration.** `0001` calls `create_index` and `op.execute` but never `create_table`. Tables are only ever created by `Base.metadata.create_all` in `database.py:42`, invoked from `main.py` startup. On an empty database `alembic upgrade head` dies at `0001` with `UndefinedTableError: relation "bookings" does not exist`.
- **`0001` duplicates what `create_all` already did.** Against an `init_db()`-built schema it dies with `DuplicateTableError: relation "ix_bookings_room_id_start_time" already exists` — `create_all` creates the same four indexes.
- **`0002` and `0003` target a schema state the models no longer have.** `0002` fails with `UndefinedColumnError` on `bookings.package_redemption_id` (dropped from the models, so `create_all` never makes it); `0003` fails with `DuplicateColumnError` on `stripe_checkout_session_id` (already created by `create_all`).

The chain describes a path *from* a schema that no longer exists *to* one `create_all` already produces. Consequence: the app cannot be deployed with a migration-based workflow at all, and any environment where you can't drop and recreate the database is unreachable.

Invisible to CI for the same reason as T1 — `conftest.py` builds tables from `Base.metadata` and never invokes alembic, so 87 passing tests say nothing about this.

Fix is a real piece of work, not a patch: author a genuine baseline migration reflecting current `Base.metadata`, reconcile `0001`–`0003` against it (likely collapsing them), decide whether `init_db()`'s `create_all` should survive at all outside tests, and add a CI job that runs `alembic upgrade head` against an empty database so this can never regress silently. Do **not** paper over it with `IF NOT EXISTS` guards — that hides the divergence instead of fixing it.

### T1 Alembic migration `0002` can never be applied — **blocker**
`revision = "0002_drop_booking_package_redemption"` is 36 characters; alembic's `version_num` column is `varchar(32)`. Stamping raises `StringDataRightTruncationError`, so **migrations cannot run against a real database at all.** Found while building Epic 2, left alone because it was outside that PR's file fence. Fix: shorten the id (e.g. `0002_drop_pkg_redemption`) and update the `down_revision` of `0003_stripe_payments` to match. Verify with a real `upgrade → downgrade → upgrade` against a throwaway PG16, since the test suite creates tables via `Base.metadata` and never exercises alembic.

### T2 Ruff's newer rules are not adopted
CI pins `ruff==0.15.17` with an explicit `select = ["E4","E7","E9","F"]` in `ruff.toml`. Ruff 0.16.1's widened defaults surface ~126 additional findings (`FURB157`, `I001`, …), largely stylistic and mostly in tests. Deliberately not adopted: it was a 126-error cleanup that would have ridden along on unrelated PRs. Worth its own pass — adopt the rules, fix the findings, bump the pin, all in one commit.

### T3 `admin.spec.ts` "admin dashboard loads" is flaky
Failed a `waitForURL` on the sign-in redirect and passed on retry during the Epic 2 run. Touches no payments code, so it predates that work. A retry-masked flake in an auth redirect is worth diagnosing rather than tolerating — it may be a real race in the sign-in flow, not just test timing.

### T4 `frontend-tests` is path-filtered and silently absent
`.github/workflows/frontend-tests.yml` only triggers on `paths: ['frontend/**']`. Backend-only PRs show the check as **absent, not skipped** — which reads like "passing" at a glance and doesn't block merge. Fine as-is, but know that a green PR page does not mean frontend tests ran.

### T5 `docker-compose.yml` doesn't forward `STRIPE_*` to the backend
Stub mode needs nothing (it's the config default), so local dev works out of the box. Live mode requires adding the vars to the `backend` service's `environment:` block. Out of fence for the Epic 2 PR.

### T6 `backend/.env.example` was not updated for Stripe
The root `.env.example` documents every new var; the backend-local copy was outside the Epic 2 fence. Reconcile the two, or delete the duplicate if the root one is authoritative.

### T7 Booking timestamps rely on exact-millisecond slot matching
`BookingCalendar` matches selections to availability slots with `parseISO(s.start).getTime() === date.getTime()`. Exact equality against a backend-supplied UTC instant is brittle — it holds for Portugal (UTC+0/+1) but breaks for any non-integer-hour offset, and it's the mechanism behind B1. Whoever fixes B1 should replace the lookup with a range check rather than patching around the equality.

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
