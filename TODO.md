# TODO — Backlog

User stories for the items CLAUDE.md §11 marks as "intentionally not done yet," plus recurring bookings (design already agreed, no code yet). Each story is scoped to be picked up independently by an AI agent — acceptance criteria are Given/When/Then and name concrete endpoints, models, and files.

**Applies to every story below:** it ships with a way to exercise it locally — no real external account, no paid service, no deployed environment (CLAUDE.md §10.3). Third-party integrations get a stub implementation behind an explicit env-var switch, and the full test suite must pass with zero credentials configured.

The 7-item code-review followup (org_id/multi-org, AdminStats fields, require_admin dependency, booking-overlap constraint, Decimal normalization, dead code, test coverage) is **done** — all landed on `main` through commit `40c05bd`. Not repeated here.

**Shipped since the epics/bugs/tech-debt below were written** (this list wasn't groomed as things landed — recording it here once, 2026-09-01):
- **B1, B2, B4, B5, T7** — booking calendar books the full dragged range and follows through to checkout (`84b8e86`).
- **T1** — alembic `0002` revision id shortened to fit `varchar(32)` (`a9ae853`).
- **T5, T6** — `STRIPE_*` forwarded through docker-compose, duplicate env template dropped (`5b24379`).
- **Epic 2.1, 2.2, 2.3** — Stripe checkout for hourly bookings + webhook + package purchase (`147f698`). Payment-method `package` (redeem prepaid hours instead of charging) is still unbuilt — see **Epic 2.4** below.
- **Epic 7** — two-tier IP rate limiting on auth/public endpoints (`d8d4c3a`).

## Scoping decision (2026-09-01)

**Single main space, multiple rooms — for now.** The seed data already matches this (`backend/app/seed.py`: one org, one `Space` "Espaço Calmo", three `Room`s). Don't build or prioritize multi-space/multi-org UX beyond what already exists. Concretely:
- **Epic 6 (RLS)** drops a tier — it's explicitly framed as "worth doing before onboarding a *second* org operator," which isn't the near-term plan.
- The admin **org switcher** (`frontend/contexts/OrgContext.tsx`, `Navbar.tsx`) and its React-Query cache bug (**B7** below) are real, but low-priority — don't invest in the multi-org UI, just don't let it silently serve wrong data. A future pass may simplify the switcher away entirely rather than fixing it.
- New work should default to "the one org/space" rather than plumbing an `org_id` selector through yet another screen.

## Agent dispatch — model tiers

Every item below is tagged **Model: Haiku / Sonnet / Opus** for whoever dispatches it to a subagent. Rule of thumb:
- **Haiku** — mechanical, low-judgment, narrow blast radius: copy/doc changes, env/compose forwarding, one-file fixes with an obvious diff, lint autofix sweeps.
- **Sonnet** — the default: a typical endpoint + test, a frontend form wired to an existing API, a contained new feature following an established pattern (e.g. the `payments.py` stub/live split).
- **Opus** — schema or cross-cutting design decisions, anything touching money/consistency/concurrency correctness, or work where the spec is deliberately underspecified and requires judgment calls that are expensive to get wrong (RLS, migration reconciliation, package-hours redemption accounting).

## Priority

| Tier | Epic | Why this tier |
|---|---|---|
| **P0 — blocks going live** | 7. Rate Limiting | ~~Done~~ — see shipped list above. |
| **P1 — high-value, expected UX** | 4. Email Notifications | Booking with no confirmation email reads as broken to a real customer. |
| | 1. Recurring Bookings | Direct fit for the target user (therapists renting the same weekly slot) — design is already fully decided, lowest ambiguity to build. |
| | 2.4 Package redemption at booking | `payment_method: "package"` is accepted by the schema but hard-rejected at `backend/app/routers/bookings.py:56-62` — a package holder cannot actually spend their hours. |
| **P2 — operational hardening, once there's traction** | 3. Seam Smart-Lock | Physical access matters, but a manually-shared code is a workable stopgap while validating the Lisbon location; wire this once it's clear the space is staying open. |
| | 8. Audit Log | Valuable for trust/dispute resolution, not blocking. |
| **P3 — defer until scale/expansion demands it** | 5. Pagination | Only matters once list sizes actually grow past a page. |
| | 6. Row-Level Security | Deferred further by the single-space scoping decision above. |
| | 9. i18n | Single-region (Portugal) product today; no multi-region ask yet. |

Suggested build order within tiers: **4 → 1 → 2.4 → 3 → 8 → 5 → 6 → 9.** Email + recurring bookings round out the core customer experience; package redemption closes a real gap in the payments epic; the rest is hardening.

**Bugs (below) outrank all of it.** The admin panel and package-purchase flow have real gaps today — shipping more epics on top of a broken admin/purchase experience is the wrong order.

---

## Bugs

### B1, B2, B4, B5 — ✅ Done (`84b8e86`)
Multi-hour drag booking, same-day gap bookings, checkout follow-through, and E2E coverage for those shapes all landed together. See the shipped list at the top of this file.

### B3 Recurring bookings do not exist in the UI (not a regression)
Recorded because it was reported as broken: there is **no recurrence code anywhere** — `grep -ri "recurr\|repeat\|semanal"` returns nothing across `frontend/` and `backend/app/`. Nothing is broken; the feature was never built. It is **Epic 1**, and story 1.4 is the UI half. No separate bug fix needed — this entry exists so it isn't tracked twice.

### B6 The booking page still tells users to click, now that dragging works — **Model: Haiku**
`frontend/app/spaces/[id]/page.tsx:78` reads *"Clica num slot disponível (verde) para reservar."* Dragging across several hours is now the primary way to book more than one hour (B1 landed), and nothing on the page says so. Users will keep making one-hour bookings because that is what the instructions describe.

- **Given** the booking page, **when** it renders, **then** the copy explains both interactions: click one hour, or drag across several to book a longer block.
- Portuguese copy, consistent in tone with the surrounding text (§9).

### B7 Admin pages silently serve the wrong org's cached data after switching org — **Model: Sonnet**
`frontend/lib/hooks/useApi.ts:9-16` attaches `org_id` to the axios instance's `defaults.params` once `currentOrgId` resolves — it's the sole source of `org_id` for admin dashboard/spaces/bookings/packages calls. But every admin page's React Query key is static and org-agnostic: `['admin','dashboard']` (`app/admin/page.tsx:22`), `['admin','bookings']`, `['admin','spaces']`, `['admin','bookings','all']`, `['admin','packages']`. None append `currentOrgId`, and `enabled` never gates on it either. Switching org via the Navbar selector (`setCurrentOrgId`, `Navbar.tsx:22-42`) changes state but React Query keeps serving the previous org's cached response.

- **Given** an admin who belongs to two orgs, **when** they switch org via the navbar selector on `/admin`, `/admin/spaces`, `/admin/bookings`, or `/admin/packages`, **then** the page refetches and shows the newly-selected org's data.
- Per the scoping decision above, this is real but low-priority — don't build out more multi-org UI while fixing it.

### B8 Rooms can never be edited or deleted from the admin UI — **Model: Sonnet**
`adminApi.updateRoom` (`frontend/lib/api.ts:157-158`) has zero call sites, even though the backend fully supports it (`PUT /admin/rooms/{room_id}`, `backend/app/routers/admin.py:201-221`). `frontend/app/admin/rooms/[id]/page.tsx` only renders a "create room" form (lines 76-114) — existing room cards (lines 58-73) have no edit or delete affordance.

- **Given** a room already created under a space, **when** an admin opens `/admin/rooms/{spaceId}`, **then** each room card offers an edit control that calls `adminApi.updateRoom` for name/capacity/hourly_rate/color.

### B9 Packages can never be edited or deactivated after creation — **Model: Sonnet**
There is no `PUT`/`DELETE /admin/packages/{id}` route on the backend and no `updatePackage`/`deletePackage` in `adminApi`. Yet `frontend/app/admin/packages/page.tsx:58` renders an "Ativo/Inativo" `Badge` implying toggleable state that nothing can ever flip.

- **Given** an existing package, **when** an admin views `/admin/packages`, **then** an action exists to edit its price/hours or deactivate it.

### B10 Spaces have no edit form for their own fields — **Model: Sonnet**
Only creation and soft-delete (`updateSpace(id, {is_active:false})`, `spaces/page.tsx:24`) are wired up. `SpaceUpdate` (`backend/app/schemas/space.py:99-106`) already supports `name/description/address/city/images/amenities`, but the only other action on a space card (`spaces/page.tsx:54`, "Salas") routes to room management, never to editing the space itself.

- **Given** an existing space, **when** an admin wants to fix its name/address/city, **then** an edit form exists and calls `adminApi.updateSpace`.

### B11 No admin UI for room availability rules — **Model: Sonnet**
`admin_set_availability` (`POST /admin/rooms/{id}/availability`, `backend/app/routers/admin.py:224-263`) has no `adminApi` wrapper and no page. A newly created room has no way to get opening hours set except by re-running the seed script.

- **Given** a newly created room, **when** an admin wants to set its opening hours per day of week, **then** a UI exists to submit availability rules via that endpoint.

### B12 There is no way to actually buy a package, and the landing CTA doesn't account for being signed in — **Model: Sonnet**
`packagesApi.purchase` (`frontend/lib/api.ts:129-133`) wraps a fully-implemented backend endpoint (`POST /packages/{id}/purchase`, Epic 2.3) — but nothing in the frontend calls it. `frontend/app/dashboard/packages/page.tsx` only *lists* purchases already made. The only "buy" entry points are the landing page's "Comprar Pack" buttons (`frontend/components/landing/Pricing.tsx:25,36`), which are hardcoded `<Link href="/sign-up">` regardless of whether the visitor is already signed in — a signed-in user clicking "Comprar Pack" is sent to sign-up again, not to a purchase flow, and there's no purchase flow to send them to anyway.

- **Given** a signed-out visitor clicks "Comprar Pack," **when** they land on `/sign-up`, **then** completing sign-up returns them to a page where they can immediately buy the package they picked (the choice isn't lost).
- **Given** a signed-in user, **when** they click "Comprar Pack" (from the landing page or a new packages page), **then** it calls `packagesApi.purchase` and follows the returned `checkout_url`, the same way `BookingModal` follows a booking's checkout URL (B4).
- **Given** `STRIPE_MODE=stub`, **when** the purchase flow completes, **then** the package appears active with the correct `hours_remaining` on `/dashboard/packages` — no Stripe account required (§10.3).

### B13 Booking-type coverage is unverified, and "daily"/"monthly" bookings don't exist yet — **Model: Sonnet** (E2E authoring) / **Model: Opus** (scope decision, if daily bookings are wanted)
Reported as "calendar bookings are still not working." Two separate things are true here:
1. **Hourly bookings** (the only type that exists) landed in B1/B2/B4/B5 with E2E coverage (`84b8e86`) — if this is regressing, it needs fresh manual verification against current `main`, since nothing since that commit should have touched the calendar path.
2. **"Daily" bookings are not a concept in the system at all** — `Room` only has `hourly_rate` (`backend/app/models/space.py`), no daily rate or daily booking mode. **Recurring bookings only exist as a *weekly* design** (Epic 1, unbuilt) — there is no monthly frequency in the locked-in `RecurrenceRule` design.

- **Given** the current codebase, **when** someone re-tests the calendar, **then** file the specific broken interaction (which room, which drag, what happened) rather than re-diagnosing B1 from scratch — if it reproduces, it's a regression of `84b8e86` and jumps the queue.
- **Given** Epic 1 ships weekly recurrence, **when** E2E coverage is written for it, **then** it belongs in `frontend/tests/e2e/booking.spec.ts` alongside the hourly cases, per B5's "once Epic 1 ships" line.
- **Daily bookings and monthly recurrence are out of scope** until explicitly requested — don't build them speculatively. If they're wanted, that's a scoping conversation (new epic), not a bug fix.

---

## Tech Debt

Known-and-accepted shortcuts. Each names why it was deferred, so the next person isn't re-deriving it.

### T8 Alembic and `Base.metadata.create_all` are two competing sources of schema truth — ✅ Done (PR #17)
`alembic upgrade head` could not succeed against any database: empty → `UndefinedTableError` (no migration ever ran `create_table`), existing → `DuplicateTableError` (`create_all` had already made the same objects), and `0002`/`0003` targeted a schema state the models no longer had.

Resolved by giving the schema a single owner:

- `0001`–`0003` were deleted and replaced by one autogenerated baseline, `0001_baseline_schema`, that reproduces `Base.metadata` exactly. The `bookings_no_overlap` EXCLUDE constraint and the four indexes from the old `0001` are folded into it; the indexes also moved into the models' `__table_args__` so `--autogenerate` stops trying to drop them.
- `init_db()` is gone. The app no longer creates tables; `backend/docker-entrypoint.sh` runs `alembic upgrade head` before uvicorn, so `docker-compose up` on a fresh clone still comes up in one step. `create_all` survives in `tests/conftest.py` only.
- `.github/workflows/migrations.yml` runs upgrade → `alembic check` → downgrade to base → upgrade again against an empty PostgreSQL 16. `alembic check` also fails any model change that ships without a migration, closing the other half of the drift.

Convention written up in CLAUDE.md §6.5.

### T10 The stub checkout URL is not reachable, so the local payment flow can't be walked in a browser — **Model: Sonnet**
`backend/app/payments.py:282` returns `url=f"https://checkout.stripe.stub/{session_id}"`. That hostname does not resolve, so once the frontend follows `checkout_url` (B4), a human clicking through locally lands on a connection error. The E2E suite only gets past it by intercepting the route.

This partially undercuts §10.3: the flow is *automatable* locally but not *walkable* locally, and §10.3 exists so a person can see the thing work on a laptop. Fix by having the stub gateway serve a real local page — a minimal backend-rendered checkout stub with pay/cancel buttons that redirect to `STRIPE_SUCCESS_URL`/`STRIPE_CANCEL_URL` and fire the `checkout.session.completed` webhook. Then E2E needs no interception either, which makes the test closer to the real thing.

### T9 `RATE_LIMIT_*` settings are not forwarded to the compose stack — **Model: Haiku**
Same class of drift as T5, found while fixing it. `backend/app/config.py` declares six `RATE_LIMIT_*` settings; `docker-compose.yml` forwards **zero** of them, so tuning any of them in `.env` has no effect on the dev stack — including `RATE_LIMIT_ENABLED` and `RATE_LIMIT_TRUST_FORWARDED_FOR`, the one you must flip when deploying behind a real proxy.

Fix is the same shape as T5/T6: add them to the `backend` service's `environment:` block with defaults mirroring `config.py`, and document them in the root `.env.example`.

Worth generalizing while you're there: every time a setting is added to `config.py`, compose has to be updated by hand or it silently doesn't apply. A test asserting that every `Settings` field appears in `docker-compose.yml` would close the class of bug rather than this instance of it.

### T1, T5, T6 — ✅ Done
T1 (`a9ae853`): alembic `0002` revision id shortened to fit `varchar(32)`. T5, T6 (`5b24379`): `STRIPE_*` forwarded through docker-compose, duplicate backend env template dropped.

### T2 Ruff's newer rules are not adopted — **Model: Haiku**
CI pins `ruff==0.15.17` with an explicit `select = ["E4","E7","E9","F"]` in `ruff.toml`. Ruff 0.16.1's widened defaults surface ~126 additional findings (`FURB157`, `I001`, …), largely stylistic and mostly in tests. Deliberately not adopted: it was a 126-error cleanup that would have ridden along on unrelated PRs. Worth its own pass — adopt the rules, fix the findings, bump the pin, all in one commit. Mechanical (mostly autofix), but touches every backend file — run alone, not alongside other backend work.

### T3 `admin.spec.ts` "admin dashboard loads" is flaky — **Model: Sonnet**
Failed a `waitForURL` on the sign-in redirect and passed on retry during the Epic 2 run. Touches no payments code, so it predates that work. A retry-masked flake in an auth redirect is worth diagnosing rather than tolerating — it may be a real race in the sign-in flow, not just test timing.

### T4 `frontend-tests` is path-filtered and silently absent — ✅ Documented as intentional (PR #12)
`.github/workflows/frontend-tests.yml` only triggers on `paths: ['frontend/**']` (consistent with `backend-tests.yml` triggering only on `backend/**`). Backend-only PRs show the check as **absent, not skipped** — this is GitHub Actions' expected behavior and saves CI time. Note: if this workflow were ever configured as a **required** status check, PRs where it doesn't run could be blocked; we'd need to remove the path filter or add a stub workflow that reports a neutral/success status.

### T7 Booking timestamps rely on exact-millisecond slot matching — **Model: Sonnet**
`BookingCalendar` matches selections to availability slots with `parseISO(s.start).getTime() === date.getTime()`. Exact equality against a backend-supplied UTC instant is brittle — it holds for Portugal (UTC+0/+1) but breaks for any non-integer-hour offset. Note: the B1 fix (`84b8e86`) touched this area already — verify whether it already replaced the equality check with a range check before picking this up; if so, close it out here instead.

### T11 Promoting a user to admin requires hand-written SQL — **Model: Sonnet**
`README.md`'s only documented path is `docker-compose exec db psql ... INSERT INTO organization_members ...`. It works, but it's error-prone (silently does nothing if the email doesn't match, no feedback, easy to typo the `org_id` subquery) and isn't something you'd hand to anyone but the person who wrote it.

Also worth noting: `POST /auth/register` (`backend/app/routers/auth.py:62-71`) gives every new user their **own** brand-new org (as owner) — not membership in the seeded demo org that actually owns "Espaço Calmo." That's why the SQL exists at all: without it, a freshly registered user is "admin" of an empty org with no spaces. Given the single-main-space scoping decision, a proper tool should default to *the* org rather than asking which one.

- **Given** a management script (e.g. `python -m app.promote_admin <email> [--role=owner|admin]`), **when** run against a user that exists and an org that isn't specified, **then** it adds them as a member of the one seeded org with the given role, and prints a clear success/failure message (unknown email → non-zero exit and a clear error, not a silent no-op).
- **Given** the demo admin credentials (`admin@demo.com` / `admin123`, already seeded — see `README.md` "Demo login"), **when** someone wants to test admin functionality locally, **then** that login already works out of the box; this story is about promoting *additional* users, not replacing the seeded admin.

---

## Epic 1 — Recurring Bookings

Design locked in: `RecurrenceRule` is the source of truth; `Booking` rows get a nullable `recurrence_rule_id` FK (flat expansion, not computed on read).

### 1.1 Create a recurring series — **Model: Opus**
As a member, I want to book a weekly recurring slot in one request instead of booking each occurrence manually.

All-or-nothing conflict handling across N generated occurrences in one transaction is the kind of correctness-under-concurrency work worth the more careful model.

- **Given** `POST /api/v1/recurrences` with `{room_id, start_time, end_time, frequency: "weekly", until_date, notes?}`, **when** every generated occurrence is free, **then** one `RecurrenceRule` row and one `Booking` row per occurrence are created (each `Booking.recurrence_rule_id` set to the rule), and the response is `{"recurrence": {...}, "bookings": [...]}`.
- **Given** the same request, **when** at least one generated occurrence overlaps an existing `pending`/`confirmed` booking, **then** no rows are inserted at all and the response is `409` with `{"conflicts": ["2026-08-10T14:00:00Z", ...]}`.

### 1.2 Cancel one occurrence vs. the whole series — **Model: Sonnet**
As a member, I want to cancel just one date or the rest of the series.

- **Given** a `Booking` with `recurrence_rule_id` set, **when** `DELETE /api/v1/bookings/{id}` is called, **then** only that occurrence is marked `cancelled` and the `RecurrenceRule` stays active.
- **Given** a series owner, **when** `DELETE /api/v1/recurrences/{id}?from_date=YYYY-MM-DD` is called, **then** that booking and all future bookings in the series (`start_time >= from_date`) are marked `cancelled` and `RecurrenceRule.is_active` is set to `False`.

### 1.3 Edit a series — **Model: Opus**
As a member, I want to change the time for all future occurrences at once.

Same all-or-nothing conflict correctness as 1.1, plus the added risk of touching already-created bookings incorrectly (must never cancel past/completed ones).

- **Given** `PUT /api/v1/recurrences/{id}` with `{start_time, end_time, until_date?}`, **when** the new occurrences are all free, **then** the `RecurrenceRule` is updated, not-yet-started bookings in the series are cancelled, and new `Booking` rows are generated at the new times.
- **Given** the same request, **when** any new occurrence conflicts, **then** nothing changes and the response is `409` with the conflicting dates (same all-or-nothing rule as creation). Past/completed bookings are never touched.

### 1.4 Frontend series booking UI — **Model: Sonnet**
As a member, I want to see what I'm about to book before committing to a series.

- **Given** `frontend/components/booking/BookingModal.tsx`, **when** I toggle "repeat weekly" and pick an end date, **then** a preview list of generated dates renders before I submit.
- **Given** I submit and the API returns `409`, **when** the response includes `conflicts`, **then** the modal lists the conflicting dates inline instead of a generic error toast.

---

## Epic 2 — Stripe Payments

`Booking.total_amount` already exists and is `Decimal`-backed; wire Stripe on top of it.

### 2.1, 2.2, 2.3 — ✅ Done (`147f698`)
Checkout for hourly bookings, webhook confirmation, and package purchase checkout all shipped together.

### 2.4 Package redemption at booking time — **Model: Opus**
As a package holder, I want to pay for a booking out of my prepaid hours instead of a new charge.

**Design note:** `PaymentMethod.package` already exists in the schema (`backend/app/models/booking.py:18`) and `create_booking` explicitly rejects it: *"Package redemption has no charge path yet — accepting it here would hand out free bookings"* (`backend/app/routers/bookings.py:56-62`). Wiring it up means, in the same DB transaction as booking creation:
1. Look up the caller's active (`status=active`, `expires_at > now`, `hours_remaining >= booking duration`) `UserPackagePurchase` for the org.
2. Deduct the booked duration from `hours_remaining` (and bump `hours_used`) — this is money-equivalent accounting, so it must be atomic with the booking insert (same transaction, and re-checked under a row lock — two concurrent bookings must not both succeed against hours that only cover one of them).
3. Skip the Stripe Checkout Session entirely — `Booking.status` goes straight to `confirmed` (no payment to wait on), unlike the `hourly` path which stays `pending` until the webhook fires.
4. On booking cancellation, refund the hours back to the purchase (mirrors how a Stripe refund would work, but instant since no gateway is involved).

This is flagged Opus because the spec above is a proposal, not a locked design (unlike Epic 1's `RecurrenceRule`) — the concurrency/atomicity call and the cancellation-refund symmetry need real judgment, and getting the double-spend case wrong is a real-money-equivalent bug.

- **Given** a user with an active package purchase covering ≥2h remaining, **when** they book a 2h slot with `payment_method: "package"`, **then** the booking is created `confirmed` with no `checkout_url`, and the purchase's `hours_remaining` drops by 2.
- **Given** a user with only 1h remaining, **when** they attempt to book 2h with `payment_method: "package"`, **then** the request is rejected (`400`/`409`) and no hours are deducted.
- **Given** a package-paid booking, **when** it's cancelled, **then** the redeemed hours are credited back to `hours_remaining` on the originating purchase.
- **Given** two concurrent requests each trying to redeem the last 1h on the same purchase, **when** both race, **then** exactly one succeeds — never both.

---

## Epic 3 — Seam Smart-Lock Integration

Booking timestamps are already shaped for time-scoped access codes.

### 3.1 Issue access code on confirmation — **Model: Sonnet**
- **Given** a `Booking` transitions to `status: confirmed` (direct create or via Stripe webhook), **when** the Seam integration runs, **then** it requests a time-scoped code from Seam for the room's lock device valid for `[start_time, end_time]`, stores it, and returns it in the booking response.

### 3.2 Revoke code on cancellation — **Model: Sonnet**
- **Given** a confirmed `Booking` with an issued access code, **when** `DELETE /api/v1/bookings/{id}` cancels it, **then** the Seam API is called to revoke the code before the response returns `204`.

### 3.3 Seam is best-effort, not a hard dependency — **Model: Sonnet**
- **Given** the Seam API call fails or times out during booking create/cancel, **when** this happens, **then** the booking operation still succeeds with a 2xx and the failure is logged, not raised as a 500.

---

## Epic 4 — Email Notifications

Must go through a queue, never synchronously in the request (per CLAUDE.md §11).

### 4.1 Queue infrastructure — **Model: Sonnet**
- **Given** a booking is confirmed, **when** the confirmation email needs to be sent, **then** a job is enqueued to a worker (Resend or Postmark, API key from `RESEND_API_KEY`/`POSTMARK_API_KEY` env var — fail loudly if missing, no silent fallback) and the HTTP response returns without waiting on delivery.

### 4.2 Booking confirmation email — **Model: Haiku**
- **Given** a queued confirmation job, **when** the worker processes it, **then** the user receives a Portuguese-language email with space/room name, date/time, and a cancellation link.

### 4.3 Cancellation email — **Model: Haiku**
- **Given** a booking is cancelled (by the user or an admin), **when** the cancellation commits, **then** a cancellation email job is enqueued.

---

## Epic 5 — Pagination

The wrapped response contract already supports adding this without breaking clients.

### 5.1 List endpoints accept paging — **Model: Haiku**
- **Given** `GET /api/v1/admin/bookings?page=2&page_size=20`, **when** called, **then** the response is `{"bookings": [...], "total": N, "page": 2, "page_size": 20}` — extending, not replacing, the existing wrap shape.

### 5.2 Frontend consumes pagination — **Model: Sonnet**
- **Given** `frontend/components/admin/BookingsTable.tsx` and its `lib/api.ts` wrapper, **when** `total > page_size`, **then** pager controls appear and request subsequent pages.

---

## Epic 6 — Row-Level Security (RLS)

Would replace the manual `org_id` filters scattered across every query.

### 6.1 RLS policies enforce tenant isolation — **Model: Opus**
Deferred further by the single-main-space scoping decision above — pick this up once a second org is actually onboarded, not before. Cross-cutting DB security policy with a high cost-of-mistake (a wrong policy either breaks every query or silently stops isolating tenants), hence Opus even though it's low-priority right now.

- **Given** a new Alembic migration, **when** applied, **then** RLS is enabled on `bookings`, `spaces`, `rooms`, `packages`, `user_package_purchases`, each with a policy restricting rows to `current_setting('app.current_org_id')`, and the app sets `SET LOCAL app.current_org_id` per request (e.g. in `get_db` in `backend/app/database.py`).

### 6.2 Regression proof — **Model: Sonnet**
- **Given** RLS is enabled, **when** a query runs against another org's row without `app.current_org_id` set for the current org, **then** it returns zero rows (not an error) — a backend test asserts this explicitly, proving isolation holds even if a route forgets an `org_id` filter.

---

## Epic 7 — Rate Limiting

✅ **Done** (`d8d4c3a`) — two-tier IP rate limiting on auth and public endpoints. Kept below for reference.

### 7.1 Auth endpoint throttling
- **Given** repeated `POST /api/v1/auth/login` or `/auth/register` requests from the same IP, **when** more than 10 requests happen within a 1-minute window, **then** request 11+ returns `429` before Argon2 hashing or a DB query runs.

### 7.2 Public endpoint throttling
- **Given** `GET /api/v1/spaces` and `GET /api/v1/rooms/{id}/availability` are unauthenticated, **when** hit at high frequency from one IP, **then** they are rate-limited under a separate, higher threshold than auth endpoints.

---

## Epic 8 — Audit Log

Who-did-what for booking cancellations, role changes, etc.

### 8.1 Audit table — **Model: Sonnet**
- **Given** a new `AuditLog` model (`org_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `metadata` JSONB, `created_at`) in `backend/app/models/`, **when** a booking is cancelled or a role is changed via an admin endpoint, **then** a row is inserted in the same DB transaction as the mutating action.

### 8.2 Admin view — **Model: Sonnet**
- **Given** `GET /api/v1/admin/audit-log?org_id=`, **when** called by an admin/owner (via `require_admin`), **then** the response is `{"entries": [...]}` ordered by `created_at` descending, and a new `frontend/app/admin/audit/page.tsx` renders it as a table.

---

## Epic 9 — i18n

Copy is hardcoded Portuguese today; extract before going multi-region.

### 9.1 Extract copy to a translation catalog — **Model: Sonnet**
- **Given** hardcoded PT strings across `frontend/components/`, **when** they're moved into a single catalog (e.g. `pt.json`), **then** rendered output is unchanged — a snapshot test confirms no visible diff.

### 9.2 Add a second locale + switcher — **Model: Sonnet**
- **Given** the `pt.json` catalog exists, **when** an `en.json` catalog and a locale switcher are added, **then** toggling language updates rendered copy and the choice persists across sessions (cookie or localStorage).
