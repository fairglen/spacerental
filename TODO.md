# TODO — Delivery backlog

Updated 2026-09-10. Product priorities come from [roadmap.md](roadmap.md).
This replaces the previous epic-first queue; the legacy mapping at the end
preserves its history and outstanding requirements.

## Execution boundary and task states

**Current state (2026-10-05):** Gate 0, C01, C02, C05 and the smoke-findings slice are DONE (archived); the A-, W-, H-, V-, L- and M-series and G01–G06 are on `main`; K01–K03 and B50 are on [PR #69](https://github.com/fairglen/spacerental/pull/69); the Q-series (this assignment) is on PRs #70 and the Part 2 PR. Later outcomes stay HOLD until their entry gates pass.

New work must be recorded before implementation: give it an ID, reproduction or
scope, priority, dependencies, and acceptance/validation. Prioritize P0 for an
immediate critical blocker, P1 for the current customer outcome, P2 for subsequent
outcomes, and P3 for deferred improvements. An unrelated discovery enters the
queue; it does not silently expand the active task. Link already-known gaps to
their existing item instead of duplicating them.

Current queue: the Q-series (P1/P2, IN PROGRESS), K01–K03 + B50 (IN PROGRESS, #69), C03/C04/C08/C99 (P1, QUEUED), B17/B20/B35/B36/B48 (P2, QUEUED), the S-series (P3, TODO), R01's recurrence slice and the R/O tasks (HOLD), D tasks (DEFERRED, archived).

**Earlier assignments (2026-09-17 → 2026-10-05)** — smoke-test findings, the security loop, the single-location simplification, customer payments/photos/help and operator tooling, brand and copy, booking rules and photos, local opening hours and landing parity, admin CRUD/customer credit/brand with its seven review rounds — are recorded with their outcomes in [docs/backlog-archive/2026-09.md](docs/backlog-archive/2026-09.md#execution-boundary-assignment-history) (Q54).

**Stack repair, CI speed and code quality (2026-10-05, after #65 and #67
merged):** by explicit owner assignment, delivered unattended in three
sequential parts the loop publishes and never merges. Part 0 repairs the
stacked PRs: when the loop started, #65–#68 were all merged (#65 and #67 at
08:52 UTC that day), so C+L (K01–K03, B50) sat on `feat/admin-crud-ui` @
`cea4d08` with no PR; they are rebased onto `main` as
`feat/customer-credit-and-brand` (Q40). Part 1
`ci/fast-e2e-and-workflow-hygiene` (Q41–Q49): isolated, parallel Playwright
specs, a production-build e2e stack with an e2e-only rate-limit
configuration, a sharded and cached e2e job, workflow hygiene, security
scanning, `pytest-xdist`, one required check. Part 2
`refactor/admin-routers-headers-docker` (Q50–Q56): admin routers by entity
with an OpenAPI snapshot, frontend decomposition, security headers, hardened
images, backlog archive, small fixes. Recorded as the Q-series near the end
of this file; links C08, O05, S24, S26. Decisions the owner did not give are
taken the conservative way, recorded under the task and tagged `DECISION:`
in the commit body.

States used below:

- **QUEUED:** prioritized work awaiting its dependencies and turn. Recording a
  bug does not start its implementation.
- **HOLD:** future work awaiting its outcome entry gate.
- **IN PROGRESS:** an assigned task with a recorded branch; link its PR when opened.
- **DONE:** merged into main with acceptance evidence, not merely a green branch.
- **DEFERRED:** outside the current product scope.

Update a task's state, PR/commit, checks, and remaining limitations as it moves.
Do not mark a whole outcome done because its foundation PR merged.

## Agent delivery contract

For every assigned task:

1. Read repository guidance, this file, and the roadmap. Verify current main,
   open PRs, and task dependencies before editing; the dated snapshot below is
   a starting point. Reuse existing work and preserve unrelated changes.
2. Use a feature branch in a worktree. Keep one coherent delivery together;
   task IDs are acceptance units, not a requirement for one PR per ID.
3. Stay within the assigned task and its necessary fixes. A newly discovered
   unrelated gap becomes a linked TODO, not an unannounced feature expansion.
4. Preserve tenant scoping, per-org admin checks, wrapped resource responses,
   Decimal money, Portuguese UI, and API extraction in `frontend/lib/api.ts`.
   Every schema change needs model metadata and a reviewed Alembic migration.
5. Each task below specifies its validation. Changed endpoints need real-PG
   happy/failure integration tests; changed constraints need database evidence;
   API wrappers need shape tests; changed customer journeys need Playwright.
   UI tests assert behavior, not snapshots pinning marketing copy.
6. Run the required suites before opening a code PR. External integrations use
   explicit stub/live gateways; tests use no third-party credentials or network.
   Keep `.env.example` and Compose usable on a fresh local checkout.
7. Include exact local reproduction commands and results in the PR. Record any
   unverified checks honestly. A passing CI summary is not a substitute for
   inspecting review findings and testing the integrated behavior.
8. For tasks with an explicit product decision, first record the proposed policy,
   alternatives, and API/state transitions. Resolve material policy questions
   before dependent implementation; do not invent billing or refund promises.
9. Finish by updating this backlog with evidence and any residual work. Follow
   the user's assignment for publishing/merging; task text is not blanket
   authorization to merge unrelated PRs or deploy the application.

### Local validation baseline

Run from the assigned worktree; use a separate Compose project for backend tests.
Do not overwrite an existing `.env` or remove another workstream's volumes.
For the dev stack, first ensure the configured ports are free or configure
isolated ports and matching frontend/backend URLs.

```bash
# Create local configuration only when absent:
if [ ! -e .env ]; then cp .env.example .env; fi

# Full backend suite, isolated PostgreSQL 18:
docker compose -p spacerental-delivery-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-tests

# Install before Compose bind-mounts frontend, avoiding root-owned dependencies:
cd frontend
npm ci
npx playwright install chromium
cd ..

# Full app and seed for browser checks:
docker compose up -d --build
docker compose exec -T backend python -m app.seed

# Frontend checks:
cd frontend
npx tsc --noEmit
npm test
npm run test:e2e
# Preserve existing frontend configuration on reruns:
if [ ! -e .env.local ]; then cp .env.local.example .env.local; fi
npm run build
cd ..
```

Use a unique backend test project name if another run is active. Use the repo's
pinned Ruff version for Python changes. For schema changes, also run the CI
migration round trip (upgrade → check → downgrade → upgrade → check) against a
separate disposable database, never the developer's retained data. A feature PR
must add its specific exercise/recovery commands to this baseline. Docs-only
changes need diff/link/status verification, not application test reruns.

## Gate 0 — Fix and merge the existing PR queue

DONE (#23 merged as `49433c3` on 2026-09-09); the whole section, its review pass and per-PR tasks are archived verbatim in [docs/backlog-archive/2026-09.md](docs/backlog-archive/2026-09.md#gate-0-fix-and-merge-the-existing-pr-queue).

## Outcome 1 — First customer can reliably pay and book

**State: ACTIVE.** Q90 is complete; roadmap implementation resumed 2026-09-10.
Start C01, then C02. Continue in the listed order unless the user's next
assignment explicitly reprioritizes a task. Dependencies below are additional
to that shared entry gate.

### B17 — Dialog descriptions and noisy component test diagnostics

**Priority: P2. State: IN PROGRESS.** Branch: `fix/dialog-accessibility-test-noise`.
Confirmed still open on 2026-09-10: no `DialogDescription` usage found in
`BookingModal.tsx`. Reprioritized ahead of C99 since it is small, independently
scoped, and does not depend on C03–C08. C01's frontend suite passes but reports
missing accessible descriptions in booking/admin dialogs, an unwrapped React
update in the org-switch test, and unsupported jsdom navigation in a package
recovery test. Fixed at the root cause: added a real, specific Portuguese
`DialogDescription` to every `DialogContent` under `frontend/components/booking/`
and the admin/dashboard dialogs (`BookingModal`, `admin/spaces`, `admin/packages`,
`admin/rooms/[id]`, `dashboard` cancel-booking); rewrote the org-switch "no org
selected" assertion in `AdminOrgSwitchCache.test.tsx` to `await waitFor(...)`
instead of a bare assertion after an un-awaited `setTimeout`; and mocked
`next/link` in `frontend/tests/setup.ts` (alongside the existing `next/navigation`
mock) so its click handler prevents default navigation instead of falling through
to a real anchor click, which is what jsdom's "Not implemented: navigation" was
coming from in `PackageBuyButton.test.tsx`'s recovery-flow test. No assertions
removed or weakened. Evidence: `cd frontend && npx vitest run` — 22 files, 127
tests, all passing with zero console warnings/errors (previously 1 act warning +
1 jsdom navigation error); `npx tsc --noEmit` clean.

### B20 — CI health-probe database-name mismatch persists after B16's local fix

**Priority: P2. State: QUEUED.** Discovered 2026-09-10 via automated review on
[PR #36](https://github.com/fairglen/spacerental/pull/36): B16 fixed the
`pg_isready` healthcheck in `docker-compose.test.yml` to target the actual test
database, but `.github/workflows/backend-tests.yml` and
`.github/workflows/migrations.yml` both still run the same unqualified
`pg_isready -U spacerental` against Postgres services configured with
`POSTGRES_DB: spacerental_test` and `POSTGRES_DB: spacerental_migrations`
respectively — the identical mismatch B16 was opened for, still live in CI.
Fix by qualifying each workflow's healthcheck with its own `POSTGRES_DB` value
(mirroring B16's `-d $$POSTGRES_DB` approach). Acceptance: neither workflow's
Postgres service logs a missing-database FATAL during a run; both workflows
still pass. Not implemented now — recorded for a future pass rather than
reopening B16, since B16's own local-stack fix and evidence are correct as far
as they go.

This entry was originally recorded on the `docs/reconcile-todo-status-2026-09-10`
branch as `ccb3189`, but that commit was pushed after
[PR #35](https://github.com/fairglen/spacerental/pull/35) had already merged and
closed, so it never reached main. Restored here on 2026-09-14.

### C03 — Checkout holds, recovery, and late payment

**Depends on:** C02. **Scope:** payment gateway, booking/purchase payment state,
webhooks, local checkout, dashboard, explicit expiry processing and migrations.

**Decision first:** record hold lifetime, checkout reuse/retry, supported payment
completion events, and treatment of money arriving after a hold expires or a
booking is cancelled. Choose how unavoidable late payments are reconciled or
compensated; do not silently discard them. General customer refunds remain O02,
but the recovery necessary for this lifecycle belongs here.

**Acceptance:** abandonment releases inventory after the configured deadline,
including after restart. A customer can resume a valid attempt or retry an
expired one without duplicate reservations/charges. Repeated or out-of-order
webhooks cannot confirm a cancelled/expired slot now owned by another customer.
Invalid signatures cannot mutate state. Paid-but-unfulfilled attempts have a
persisted, visible resolution path. Stub pay/cancel/expiry reproduce the same
transitions. Dashboard distinguishes awaiting payment, expired, and confirmed.

**Validation:** real-PG expiry/webhook races, duplicate events, unauthorized
resumption and late payment; E2E abandon → recover and expire → slot available.
Use controllable clocks/failure injection rather than long wall-clock sleeps.

**Smoke-test evidence (2026-09-17, main `cced0f4`) — abandoned checkout
deadlock:** book a slot for tomorrow, press Cancelar on the stub checkout. The
booking stays `pending` forever and blocks the slot; the dashboard has no way
to pay; and the customer cannot cancel it because `validate_cancellation()` in
`backend/app/booking_cancellation.py` applies the 24h rule to unpaid pending
bookings too. Only an admin can clear it.

**Slice delivered on `fix/smoke-findings` (decision recorded before code, see
"C03 decision" below when present):**

- a) An unpaid `pending` booking can always be cancelled by its owner regardless
  of the 24h window (nothing was paid; no code/credit side effects may fire).
- b) Cancelling on the stub/Stripe checkout page releases the hold immediately.
- c) Dashboard shows pending bookings as "A aguardar pagamento" with a "Pagar
  agora" action that resumes or recreates the checkout session without a second
  booking.
- d) Hold expiry (default 15 minutes, configurable) evaluated at read/conflict
  time so an expired hold stops blocking availability even without a sweeper.
- e) A late `checkout.session.completed` for an expired/cancelled booking must
  not confirm it if the slot is taken; the payment is persisted in a visible
  "paid but unfulfilled" state, refund handling left to O02.

If (d)/(e) grow beyond a contained change, (a)–(c) ship and (d)/(e) stay here
with design notes. Tests: real-PG cancel-pending-inside-24h, expiry with a
controlled clock, late/duplicate webhook; Playwright abandon → pay now →
confirmed and abandon → slot bookable again.

**C03 decision (recorded 2026-09-18 before implementation, on
`fix/smoke-findings`; review and reverse per point):**

1. *Hold lifetime.* An unpaid `pending` hourly booking holds its slot until
   `hold_expires_at`, set at creation to `now + BOOKING_HOLD_MINUTES`
   (new setting, default 15, forwarded by Compose and documented in
   `.env.example`). `hold_expires_at` is NULL for package bookings (confirmed
   at once) and for series occurrences (they await the operator, R02), so
   those never expire. Alternative rejected: deriving expiry from
   `created_at` — it cannot be extended by a retry and leaks the rule into
   every reader.
2. *Expiry is evaluated at read/conflict time; no sweeper yet.* A pending row
   whose `hold_expires_at` has passed does not block availability
   (`GET /rooms/{id}/availability`) or `has_conflicting_booking`. Because the
   `bookings_no_overlap` EXCLUDE constraint still sees it, the write paths
   that acquire a slot (`POST /bookings`, retry below, admin reinstatement)
   first run `expire_stale_holds()`: `UPDATE … SET status='expired' WHERE
   status='pending' AND hold_expires_at <= now AND overlaps`. The row lock
   serialises two customers racing for a released slot; the constraint
   remains the last line and still yields the existing 409. `GET /bookings/me`
   applies the same update to the caller's own stale holds so the dashboard
   shows the real state. Alternative rejected: changing the constraint
   predicate — it cannot reference `now()`.
3. *New statuses* `expired` and `paid_unfulfilled` on `booking_status`
   (Alembic `0003_booking_holds`; the downgrade maps `expired → cancelled`
   and `paid_unfulfilled → confirmed` before recreating the enum, and is
   exercised by the CI round trip). Neither holds a slot (the EXCLUDE
   predicate is unchanged: `confirmed`/`pending` only).
4. *Owner cancellation of an unpaid checkout hold* (`pending` **with** a
   `hold_expires_at`) is always allowed: the 24h rule applies to paid
   (`confirmed`) bookings and to pending series occurrences (no deadline;
   the operator has reserved them — `test_bulk_changes_cannot_bypass_24_hour_window`
   pins that). Nothing was paid, no hours are credited (holds never carry
   `package_purchase_id`), the lock revoke is a no-op. The cancellation email
   is still sent (existing behaviour; unchanged). *Refined during
   implementation from "any pending row".*
5. *Stub checkout "Cancelar"* fast-forwards the hold: `hold_expires_at := now`
   and `status := expired`, releasing the slot immediately while keeping the
   same state machine as live Stripe, where the cancel URL is a plain
   redirect and the hold lapses at (1). Live therefore relies on (1) + (4).
6. *Resume/retry* — `POST /bookings/{id}/checkout` (owner only). A live
   `pending` hold whose session is still open at the provider gets **that**
   session back (`PaymentGateway.get_checkout_url`; idempotent for a
   double submit, refined again after the third review). Otherwise — lapsed
   hold, or no open session — the row gets a **fresh** Checkout Session
   after the previous one is expired at the gateway
   (`PaymentGateway.expire_checkout_session`: Stripe `sessions.expire`, stub
   drops it), so a superseded session can never be paid late. A live hold
   also gets a fresh `hold_expires_at`. An `expired` booking whose slot is
   free becomes `pending` again; if the slot is taken → 409 and it stays
   `expired`. No second booking row is ever created. *Simplified during
   implementation from "return the existing URL": one path, no
   `get_checkout_url`, and the stub survives a backend restart because its
   session id derives from the booking id.* Dashboard: `pending` hourly rows
   show "A aguardar pagamento" + "Pagar agora" + the deadline; `expired`
   shows "Expirada" + "Tentar pagar de novo".
7. *Late or duplicate `checkout.session.completed`.* Matched by
   `stripe_checkout_session_id`. `pending` → `confirmed` (unchanged).
   `expired`/`cancelled` with the slot still free → `confirmed` (the money
   arrived and the customer clicked pay; the row re-enters the EXCLUDE
   predicate, which is what proves the slot is free). Slot taken →
   `paid_unfulfilled`: the payment is persisted on the booking, visible to
   the customer ("Pagamento recebido, mas o horário já não está disponível")
   and to the operator in the admin table; the refund itself is O02. A
   duplicate event for a `confirmed` booking is a no-op. Package purchases
   are unchanged in this slice.
8. *Out of scope here:* a background sweeper, Stripe `checkout.session.expired`
   webhooks, live-mode cancel-URL handling, refunds.

State transitions: `pending —pay→ confirmed`; `pending —owner cancel→
cancelled`; `pending —deadline (lazy)→ expired`; `pending —stub cancel→
expired`; `expired —retry, slot free→ pending`; `expired —retry, slot
taken→ 409`; `expired|cancelled —late pay, slot free→ confirmed`;
`expired|cancelled —late pay, slot taken→ paid_unfulfilled`.

**Slice state: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46), 2026-09-18 —
(a)–(e) all delivered.** Evidence: migration `0003_booking_holds`
(`hold_expires_at`, enum values) passed upgrade → check → downgrade → upgrade
→ check → downgrade base → upgrade → seed on a throwaway database; full
backend suite 270 passed (`tests/test_checkout_holds.py`: cancel-pending-
inside-24h, paid-inside-24h still refused, expiry with a pinned clock
releasing the slot to another customer and flipping the row past the
EXCLUDE constraint, `/bookings/me` lazy expiry, series/package rows never
expire, pay-now resume/retry/conflict/403/404/409, late payment confirming a
free slot, late payment for a taken slot → `paid_unfulfilled`, duplicate
completion no-op, stub cancel → `expired` + retry). The stub-cancel test in
`test_checkout_stub.py` that asserted the old "stays pending" was updated.
Frontend: `bookingsApi.checkout` shape test, eligibility/label unit tests,
4 dashboard component tests (Pagar agora → checkout URL, Expirada + retry,
paid_unfulfilled note, series occurrence not payable, failed retry message);
Vitest 203 passed. Playwright booking spec 11 passed including "an abandoned
checkout can be paid later from the dashboard" and "cancelling on the
checkout page frees the slot immediately". `BOOKING_HOLD_MINUTES` documented
in `.env.example`, Compose and README. Remaining C03 scope: sweeper, Stripe
`checkout.session.expired` webhook, live cancel-URL handling, refunds (O02).
**Review fixes (2026-09-18, Copilot on PR #46):** the webhook confirm and
the stub cancel now lock the booking row (`SELECT … FOR UPDATE`), so
concurrent duplicate deliveries confirm once (new real-PG test fires three
at once: one handled, one email) and a stale stub tab cannot expire a paid
row; `StripeGateway.expire_checkout_session` retrieves the session first
and raises `CheckoutSessionCompletedError` for a paid one, which the resume
route turns into 409 "Payment already received" while keeping the session
id so the webhook still matches (test with a fake gateway); the downgrade
folds `paid_unfulfilled` into `cancelled` instead of `confirmed`, proven on
the throwaway DB with an overlapping paid_unfulfilled row next to a
confirmed one (downgrade → both statuses valid, constraint recreated →
upgrade → check clean); the dashboard success notice no longer asserts a
reservation is confirmed (pack purchases return to the same URL and a live
webhook may still be in flight). Known stub limitation left as is: the stub
derives session ids from the booking id so a retry reuses the same id and a
stale stub page can still pay it — same row, same amount, no charge; live
Stripe ids are unique and the superseded session is really expired.

**Third review batch (2026-09-18, Copilot on PR #46):** `BOOKING_HOLD_MINUTES`
rejects zero/negative at settings load; an admin `PUT status=pending` only
assigns a deadline when a payable hourly one-off *enters* `pending` (an
already-pending hold keeps its deadline, package rows stay deadline-free);
"Pagar agora" on a live hold returns the session that is still open
(`get_checkout_url`) instead of expiring it, so a double submit cannot send
one tab to a dead session (lapsed holds still get a fresh session);
`Pricing` shares the landing page's `['spaces']` query; `API_SPEC.md` states
where `hold_expires_at` is retained. Four tests, all failing before.

**Second review batch (2026-09-18, Copilot on PR #46):** the admin
status-transition path now runs `expire_stale_holds` before its conflict
check and keeps the hold marker consistent (a one-off revived as `pending`
gets a fresh deadline, a series occurrence stays deadline-less, any other
status clears it); the webhook's late-payment branch is deadline-aware
(`pending` past its deadline takes the conflict-checked path) and limited
to unpaid holds, so a duplicate completion cannot resurrect a cancelled
paid booking (confirmation clears the deadline); migration 0003 backfills
pre-existing pending one-off hourly rows with `created_at + 15 min`
(evidence on the throwaway DB: legacy one-off → 08:15 deadline, series
occurrence → NULL, `alembic check` clean); `safeInternalPath` accepts a
same-origin absolute URL (NextAuth's middleware callback) and still rejects
other origins; the dashboard packs summary counts only active, unexpired
purchases with hours left and shows a fallback when `/packages/me` fails;
the "não concluído" notice no longer promises a reservation is waiting to be
paid; `Pricing` treats a rooms-request failure as a pricing failure with a
retry that refetches it; `API_SPEC.md` documents the two statuses,
`hold_expires_at` and `POST /bookings/:id/checkout`. Tests: four real-PG
cases in `TestSecondReview`, five frontend cases; all failed before the
changes.

Note for the suite: the full Playwright run sits close to the public rate
limit (120/min); the two C03 journeys therefore create their holds through
the authenticated `POST /bookings` (the calendar UI path is covered by the
earlier booking tests) and assert the dashboard, stub checkout and
availability outcomes. A fresh-stack full run (27 tests) passes with no
429s; with the calendar-driven versions the last spec was throttled.

### C04 — Patch dependencies and validate a production build

**Intake evidence (2026-09-10):** C01's pinned `npm ci` reported 24 audit findings
(1 low, 5 moderate, 14 high, 4 critical), plus the known Next.js deprecation/
security notice. This is linked to existing C04 rather than a duplicate task.
Inspect current advisories and reachability when assigned; no dependency changes
or production deployment are included in C01.

**Depends on:** C03. **Scope:** manifests/lockfiles, affected compatibility code,
Docker/build configuration, CI and dependency documentation.

**Acceptance:** inspect current official advisories and select patched compatible
releases (including the currently pinned Next.js 14.2.5); record the findings
addressed and any remaining exposure. Align framework/tooling dependencies and
pins. Avoid an unrelated framework rewrite or blind forced audit fix. Production
build/start and auth, public browsing, checkout, and admin protection work.

**Validation:** full required suites, dependency audit with assessed findings,
production build and smoke checks against a production-mode server.

**Smoke-test evidence (2026-09-17):** `next@14.2.5` is flagged by `npm audit`.
Slice on `fix/smoke-findings` (last in its tier, own commit): upgrade to the
latest patched 14.2.x (no major bump), align `eslint-config-next`, run
`npm audit` and record what remains and why; verify build, Vitest, and the auth
+ booking E2E.

**Slice merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46)
on 2026-09-18 (state: PARTIAL — the residual needs a decision).** `next` and `eslint-config-next`
pinned to 14.2.35, the last 14.2.x release. `npm audit`: 24 → 21 findings
(1 low, 5 moderate, 11 high, 4 critical). Resolved by the bump (15
advisories): 12 in `next` — GHSA-3h52-269p-cp9r dev-server origin,
GHSA-4342-x723-ch2f middleware SSRF, GHSA-5j59-xgg2-r9c4 and
GHSA-mwv6-3258-q52c RSC DoS, GHSA-7gfc-8cq8-jh5f and GHSA-f82v-jwr5-mffw
middleware authorization bypass, GHSA-7m27-7ghc-44w9 Server Actions DoS,
GHSA-g5qg-72qw-gw5v image cache-key confusion, GHSA-g77x-44xx-532m image
optimisation DoS, GHSA-gp8f-8m3g-qvj9 and GHSA-qpjv-v59x-3qc4 cache
poisoning, GHSA-xv57-4mr9-wg8v image content injection — and 3 `minimatch`
ReDoS advisories pulled in by `eslint-config-next`.

**What remains and why:**

- `next` (critical) — 23 advisories whose patched ranges start at 15.0.8,
  15.5.10–15.5.24 (e.g. GHSA-p293-qw3h-jr36 and GHSA-2xp9-vwfh-vxw4,
  unauthenticated RCE on Windows hosts / AVIF image optimisation;
  GHSA-ggv3-7p47-pfv8 request smuggling in rewrites; several RSC cache
  poisoning and DoS entries). No 14.x release carries these fixes: the 14
  line is no longer receiving security patches. **Needs the user's
  decision: a major bump to Next 15 (or 16) is outside this loop's "stay on
  14" rule.** Recommendation: schedule the Next 15.5.x upgrade as the next
  dependency task; the App Router code here uses no removed 15 APIs that
  `tsc` would not flag, but `next-auth` v4 compatibility and the
  `useSearchParams` Suspense requirement must be verified on a branch.
- `next-auth` (critical, 4.24.14 → fix in 4.24.15+): three Auth.js
  advisories (email normaliser homoglyph bypass, `getToken()` uncaught
  exception on malformed Bearer headers, OAuth check cookies not bound to
  the provider). Only the credentials provider is used, so the OAuth entry
  does not apply; the other two do. A non-major bump — recommended as the
  first follow-up, kept out of this commit to keep it revertible.
- `axios` (high, 1.x → fix in 1.18.0): prototype-pollution and form
  serialiser advisories; the browser client only sends JSON bodies to our
  own API. Non-major bump recommended alongside `next-auth`.
- `postcss` (high, 8.5.15 via next/tailwind → fix ≥ 8.5.23) and
  `postcss-selector-parser` (low): build-time only; the fix path npm offers
  is `next@16`. Revisit with the Next upgrade.
- `vitest` / `@vitest/ui` / `vite` / `vite-node` / `esbuild` /
  `@vitest/mocker` (critical/high/moderate): all fixed only in `vitest@5`
  (major). Test tooling, never shipped; the "arbitrary file read" entries
  require the Vitest UI server to be listening, which CI and the local
  runner never start.
- `eslint-config-next` / `@next/eslint-plugin-next` / `glob` (high):
  `glob` CLI command injection via `-c`; the CLI is not invoked. Fix only in
  `eslint-config-next@16`.
- `browserslist`, `baseline-browser-mapping`, `brace-expansion`,
  `form-data`, `js-yaml`, `nanoid`, `uuid`: transitive, non-major fixes
  available (`npm audit fix` without `--force`); left out of this commit on
  purpose and recommended as one follow-up dependency PR after review.

**Verification on 14.2.35:** `tsc --noEmit` clean; Vitest 210 passed;
`next build` compiled; the frontend container was recreated with renewed
anonymous volumes (`docker compose up -d -V frontend`, otherwise the old
`node_modules` volume keeps 14.2.5 — noted in README) and reports
`next@14.2.35`; Playwright auth + booking specs 16 passed against it.
`package.json` changes only the two version strings; the lockfile is npm's.

### C08 — Reliable diagnostics and current setup documentation

**Depends on:** C07; reuse Q25/Q31/Q90 work. **Scope:** Playwright fixtures and
reporters, CI artifact paths, auth error mapping, README, architecture guidance.

**Acceptance:** browser traces/reports and backend logs survive failed CI runs;
setup fails clearly when services are unready. Auth-rate-limit responses are
understandable instead of masquerading as a bad password. Inspect the shared
Next.js egress identity when assessing throttling; preserve a trusted client
boundary and meaningful rate-limit tests. Document actual implemented/stub/live
behavior and required settings. Verify supported Compose configuration forwarding
without requiring every internal setting to be exposed. Keep explicit required
check behavior for workflows skipped by path filters.
**2026-10-05 (Q49, PR #70):** the required-check note is closed — `checks.yml`
calls every area workflow only where its paths changed and ends in one
`required-checks` status that passes when each area succeeded or was skipped,
so branch protection requires that single check (README "CI"). Diagnostics
also moved on: the e2e job uploads one merged HTML report on every run and
stack logs + traces on failure (Q44). What remains of C08 is the auth
error mapping and the README walkthrough.

**Validation:** verify artifacts on a controlled failing local/CI exercise when
assigned, auth failure tests, full E2E on a fresh stack, and a walkthrough of the
README commands. Do not disable tests or globally weaken throttling for a pass.

### Smoke-test findings — 2026-09-17

Observed in a real browser against main `cced0f4` (Postgres, migrated and seeded
backend in stub mode, production Next build, Playwright as a fresh customer and
as `admin@demo.com`). Backend (251) and frontend (127) suites were green, so
every item is a coverage gap, not a regression. Items marked *code-confirmed*
were verified by reading the code rather than in the browser. All are P1 unless
stated; they are delivered on `fix/smoke-findings`, one commit per item.

### B35 — BookingCalendar fights touch scrolling on mobile

**Priority: P3. State: QUEUED (not yet verified in a browser).** The calendar is
a 600px react-big-calendar with drag-to-select, which competes with touch
scrolling. Proposal: a tap-friendly slot list below the `md` breakpoint that
reuses the same availability data and `resolveSelection`. Verify on a mobile
viewport before implementing; do not restyle the desktop calendar.

### B36 — Surfaces not yet smoke-tested

**Priority: P2. State: QUEUED.** Follow-up test task, not a bug report. Not yet
exercised in a browser: admin actions (confirm/cancel booking, edit
room/availability, create space/package), recurring series UI, locale
switcher, mobile viewports, wrong-password message on sign-in, and
`flowspace-site`. The admin bookings table's ACTIONS column looked empty for a
pending booking — unverified whether that is icon-only buttons or a gap.
**Acceptance:** each surface has a Playwright or component test asserting
behaviour, and any defect found is recorded as its own item first.

### Single-location simplification — 2026-09-19

Owner assignment recorded above. One branch,
`feat/location-single-space-simple-booking`, one commit per task, in the order
C09 → C10 → C11 → C12. Out of scope for all four: anything recurrence-related
(build, extend, fix or delete), half-day/full-day/multi-date/monthly booking,
new booking endpoints or modes, batch checkout, and the R01 wall-clock rework.
No pricing, discount or refund policy is decided here.

**Integrated verification (2026-09-19, final branch state, stub mode, no
credentials):** backend pytest 427 passed (392 on main + 35 new; the 43
untouched recurrence tests included); `alembic upgrade head` → `check` →
downgrade → upgrade → `check` clean on an empty PostgreSQL 16; `tsc --noEmit`
clean; Vitest 338 passed (217 on main); `next build` OK; full Playwright on a
freshly migrated and seeded stack 33 passed, with no 429 and no 5xx in the
backend log for the run. An earlier full run failed `packages.spec.ts` on the
shared public request budget — measured, explained and recorded as B48.

### B48 — C11/C12 spend more of the shared public request budget

**Priority: P2. State: QUEUED.** Found while delivering C11/C12, measured on
2026-09-19. Two costs against the shared 120-a-minute public budget per client
address (customers on the venue's own Wi-Fi share one): (1) `BookingCalendar`
asks `GET /rooms/{id}/availability?date=` once per day, so the week view — now
the desktop default — costs seven reads per mount and per week navigated;
(2) since C11 every FULL page load reads `GET /spaces` once, because the navbar
label depends on the mode (in-app navigation reuses the 60 s cache). In the
browser suite that was ~25 extra reads a minute: the booking → locale →
packages sequence reached exactly 120 and the packages spec's own `GET /spaces`
came back 429. No limit was changed; `packages.spec.ts` and the two new spec
files wait out one window each (the B18 rule).

**(2) fixed on the same branch, 2026-09-20.** `useSingleSpace()` now carries its
answer across full page loads in `sessionStorage` for the 60 s it is fresh
anyway (read after mount, so server and first client render still match;
ignored when stale, malformed, future-dated or storage is unavailable; a
failure is never remembered). Measured on the full browser suite in CI's
configuration (recurrence flag on): worst 60 s window of public reads 116 → 89
of 120, total 251 → 208, no 429. The E2E room-picking helper also stopped
mounting every room's calendar to find one. **(1) remains open** — the ranged
availability read below.

**Found by CI on PR #54, fixed 2026-09-20:** the contact note (C12) made the
confirm dialog taller, and `DialogContent` could not scroll, so with the weekly
options and a conflict list showing, the footer buttons sat outside a 720 px
viewport (`element is outside of the viewport` in the untouched weekly-series
spec, which only runs its full body when CI enables the flag). A short phone
with the pack choice and an error showing could hit the same. `DialogContent`
is now capped to the viewport and scrolls inside; `week-view.spec.ts` opens the
dialog on a 390×520 screen and requires the buttons to be reachable. Lesson
recorded: run the browser suite with `RECURRING_BOOKINGS_ENABLED=true` too,
because CI does. **Proposal:** a ranged availability read
(`?from=&to=`, bounded to 7 days, same wrapped `{slots}` shape) with the
`lib/api.ts` wrapper and shape test. It is a backend change on a public
endpoint, so it was not made under C12. **Acceptance:** one request per week
shown; real-PG tests for range bounds and the rate tier; week-view E2E green.

### Customer payments, photos and help — 2026-09-22 (PR 1)

Owner assignment recorded above; branch `feat/customer-mixed-pay-photos-help`,
one commit per task, in the order C13 → C14 → C15 → C16 → C17 → C18 → C19.

**Integrated verification (2026-09-22, final branch state `2718b05`, stub
mode, no credentials, isolated stack rebuilt from an empty database):** backend
pytest 516 passed (427 on main); `alembic upgrade head` → `check` → downgrade →
upgrade → `downgrade base` (no tables or enum types left) → `upgrade head` →
`check` clean through `0007_support_requests`; `tsc` clean; Vitest 434 (346 on
main); `next build` OK; full Playwright 40 passed with the recurrence flag off
AND 40 passed with it on (CI's configuration); `npm audit` unchanged at 21.

### C99 — Outcome 1 acceptance

**Depends on:** C01–C08. **Scope:** integrated validation and evidence only.

**Acceptance:** the outcome-1 criteria in `roadmap.md` all pass on one integrated
revision: fresh enrollment, hourly payment, package purchase/redemption, conflict
handling, abandoned checkout recovery, accurate pricing and cancellation feedback.
Record exact commands, results and commit. Full required suites and production
build pass without third-party credentials. No later outcome starts while this
outcome remains incomplete unless the user explicitly changes priorities.

## Outcome 2 — Regular customers can manage their schedule

**R01: HOLD.** Entry gate: C99 complete and assigned roadmap work. **R02, R03 and
R99: DEFERRED** — parked by owner 2026-09-19 to simplify; customers rebook each week; weekly series code stays in the repo, flag off.
Merged #26/#27 are gated foundations; do not reimplement their accepted behavior,
and do not build on, fix or delete them while the outcome is parked.

### R01 — Preserve Lisbon wall time for availability and recurrence

**Priority: P1 (opening-hours slice). State: IN PROGRESS** — the
opening-hours slice assigned by the owner on 2026-09-23 as Section 1 of
`fix/local-opening-hours`, merged as [PR #61](https://github.com/fairglen/spacerental/pull/61)
(`2a56655`). The owner's full Section 1 text arrived after the merge; the
lines it adds beyond #61 are the **follow-up slice** on
`fix/local-opening-hours-dst` (recorded 2026-09-23, before implementation):
(a) the DST overlap policy — the assignment says a 25-hour day yields one
more slot and a 23-hour day one fewer, so the fall-back hour must be served
TWICE (both occurrences, `fold=0` and `fold=1`), not once as #61 decided;
(b) the acceptance dates as written: a July date (07:00Z) and a January date
(08:00Z), 21:00–22:00 Lisbon accepted in summer AND winter, 22:00–23:00
refused in both; (c) Playwright: "Onde estamos" reads "Todos os dias
08:00–22:00" and the customer calendar's first bookable row is 08:00 (in a
Lisbon-zoned browser); (d) the stale "evaluated in UTC" comment on
`visibleRange` in `BookingCalendar.tsx`; (e) a screenshot of the calendar on
25 Oct 2026 with 08:00 first, in the PR draft. **One acceptance line cannot
hold as written:** "25 Oct 2026 yields 15 slots for 08–22 and 29 Mar 2026
yields 13" — Lisbon changes its clocks at 01:00 UTC (01:00→02:00 in March
and 02:00→01:00 in October on the door), outside an 08–22 window, so 08–22 yields 14 on
both days; the one-more/one-fewer rule is asserted on a window that spans
the change (00–05: 6 slots on 25 Oct, 4 on 29 Mar). Nothing else in the
follow-up is a gap: the admin availability endpoints only store rules, there
is no availability-summary code, and no other place turns a rule into an
instant (`local_hourly_slots` is the single conversion). The recurrence
slice stays parked with R02/R03 (code untouched, flag off). **Follow-up
evidence (2026-09-23, commit `6ca47d9` on `fix/local-opening-hours-dst`):**
`local_hourly_slots` yields both occurrences of the fall-back hour (fold 0,
then fold 1) as distinct, contiguous UTC instants; 12 real-PG tests in
`test_local_opening_hours.py` — 15 January opens at 08:00Z and 15 July at
07:00Z (14 slots each); 21:00–22:00 Lisbon accepted and 22:00–23:00 refused
in July and in January; a 00–05 window yields 4 slots on 29 March (nothing at
01:00) and 6 on 25 October (01:00 twice: 00:00Z and 01:00Z), while 08–22
yields 14 on both days; the H01 horizon's local last day; the UTC fixture
space unchanged; the gap booking; the `timezone` field; the seed. Playwright
`single-space.spec.ts`: the hours line reads exactly "Todos os dias
08:00–22:00" and, in a Europe/Lisbon-zoned browser, the customer calendar's
first bookable row is 08:00 and the last 21:00 (14 tinted rows). Full run at
`6ca47d9`: backend 662, migration round trip clean at `0012` with `alembic
check`, Vitest 545, tsc, `next build`, Playwright 47/47 on the rebuilt loop
stack, static smoke 26 (site untouched). Screenshot of the week of 25 Oct
2026 in the PR draft (`pr-screenshots/pr1-calendar-25-oct-2026.png`, taken
with a 60-day window so the week is reachable): 08:00 first on every day,
including Sat 24 and Sun 25. **Evidence (#61, 2026-09-23, commit
`9892851`):** 10 real-PG tests in
`tests/test_local_opening_hours.py` on a Europe/Lisbon space — a winter and
a summer day both have 14 slots reading 08:00–21:00 on the Lisbon clock
(08:00Z vs 07:00Z); every slot of a day belongs to that local date; the
spring-forward day (2026-03-29) offers 00:00, 02:00, 03:00, 04:00 and no
01:00 for a 00–05 rule; the fall-back day (2026-10-25) offers each wall-clock
hour once, 01:00 as its first occurrence (00:00Z, not 01:00Z); the H01
horizon's last served day is the space's date of that instant (a window
ending 23:30Z on 31 July is served on 1 August in Lisbon, refused on the
2nd); the UTC fixture space behaves exactly as before; `POST /bookings` accepts 08:00
Lisbon in summer (07:00Z), refuses 07:00 Lisbon and 22:00 Lisbon, accepts the
day's last hour; a block across the gap is two real hours; `timezone` is
public, defaults to Europe/Lisbon on create, is refused for an unknown name
(422) and accepted for `Atlantic/Azores`; the seed places the demo space in
Lisbon and restores it on a re-seed. S19 allowlist gains `timezone`.
Migration `0012_space_timezone` round trip clean on an empty database (the
column is a server default: no rule row and no booking instant is touched).
Full backend 660 (650 on main). Frontend: the hours line reads the rules as
the wall clock they are (10 unit tests, the summer case inverted from
"09:00–23:00" to "08:00–22:00"); `Space.timezone` typed; Vitest 545; tsc
clean; `next build` OK; Playwright 46/46 against the rebuilt loop stack,
which serves the seed's 08:00–22:00 as 07:00Z–21:00Z in September; static
site untouched (smoke 26/26). **DECISIONS:** (1) the conftest fixture space is zoned `UTC`,
so the ~650 tests that pin UTC instants against its 08–20 rules keep their
meaning, and Lisbon-clock behaviour has its own tests — alternative: convert
every pinned expectation; (2) the timezone lives on the space, not the room
(one door, one clock; the recurrence slice will need the same column);
(3) the migration's server default puts every existing space in Lisbon — the
pilot's rules were always written as Lisbon numbers, so this is the first
time they are read as intended, and nothing is rewritten; a UTC-meaning
operator would set `UTC` in the admin; (4) the seed re-asserts Lisbon on the
demo space like it re-asserts the address (W04/C10 rule). **Slice scope:** `spaces.timezone` (IANA name,
`Europe/Lisbon` default, migration `0012`), validated on the admin space
endpoints and returned publicly; `AvailabilityRule.open_time/close_time` are
the space's WALL CLOCK: `is_within_open_hours` and `GET
/rooms/{id}/availability` build each local day's windows in the space's zone
and convert to UTC instants (stored bookings stay UTC; the `date` query
parameter is the space's local date); the seed's 08:00–22:00 therefore reads
08:00–22:00 in Lisbon all year, and existing rules keep their numbers (they
were always meant as Lisbon — the migration moves no row and no booking);
"Onde estamos" and the hours line stop converting UTC→Lisbon and show the
rules as they are. **DST policy (decided in #61, amended by the owner's
Section 1 text on the follow-up branch):** a local hour that does not exist
(the spring-forward gap) yields no slot — nothing can start in an hour that
does not happen, so a window across the change has one slot fewer; a local
hour that happens twice (the fall-back fold) yields two slots, one per
occurrence (`fold=0`, then `fold=1`), because both are real, bookable hours,
so a window across the change has one slot more. (#61 had served the
repeated hour once; the owner's rule "a 25-hour day yields one more slot"
replaces that.) **Validation:** real-PG tests around both
Lisbon transitions (last Sunday of March and of October 2026) for
availability and for `POST /bookings`; a UTC-zoned space keeps today's
behaviour (the fixture space is UTC so the existing suite stays meaningful —
DECISION recorded on the commit); migration round trip; the S19 allowlist;
frontend unit tests for the hours line; the public shape test.

**Depends on:** C99; disposition of Q26/Q27. **Scope (original):** room/space timezone
metadata, migration, availability and recurrence expansion, frontend preview.

**Acceptance:** establish an explicit location timezone (Europe/Lisbon for the
pilot), keep stored instants UTC, and preserve a weekly 09:00 appointment through
both DST transitions. Preview and backend expansion agree, including end-date
boundaries and duration. Define ambiguous/nonexistent local-time behavior and a
safe migration strategy for existing opening hours/series; do not silently move
paid appointments. Preserve the existing occurrence cap and reject invalid ranges.

**Validation:** unit expansion tests around both transitions and ambiguous/gap
cases; real-PG API/migration tests; browser preview matches stored dates.

**Smoke-test evidence (2026-09-17, main `cced0f4`):** `AvailabilityRule`
open/close times are naive and `spaces.py`/`booking_validity.py` evaluate them
as UTC, so the seeded 08:00–20:00 is really 09:00–21:00 Lisbon during DST.
`BookingCalendar` hard-codes `min`/`max` 08:00–20:00 in the browser's zone, so
the 20:00–21:00 Lisbon slot can never be selected and 08:00 looks closed. The
calendar-range slice is B34; the timezone column, wall-clock rules and
DST-stable recurrence remain here and are not started by `fix/smoke-findings`.

**Note (2026-09-19, C10):** `Space` gained `postal_code`, `latitude` and
`longitude` but deliberately no timezone column. `Space` will need one
(Europe/Lisbon for the pilot) when this task is picked up. R01 is not parked
with the rest of this outcome: opening hours are still evaluated as UTC.

## Outcome 3 — The location can operate reliably

**All tasks: HOLD.** Entry gate: R99 complete and assigned roadmap work.
R99 is DEFERRED as of 2026-09-19, so this gate can no longer be met as written;
the owner restates it when Outcome 3 is assigned. No task here starts meanwhile.
Implement in the order below. Reuse payment and transition primitives already
introduced; avoid separate competing cancellation or accounting implementations.

### O01 — Durable notifications with recovery

**Depends on:** R99. **Scope:** `email.py`, transactional job/outbox persistence,
worker, gateways, Compose configuration, operator failure visibility and docs.

**Acceptance:** enqueue notification intent in the same DB transaction as a
committed booking transition; rollback sends nothing. Persist jobs across restart,
retry transient failures with bounded backoff, and expose exhausted failures and
controlled replay to authorized operators. Preserve Portuguese date/room/cancel
content and process every single/package/series transition. Use stable delivery
IDs and provider idempotency where supported; document ambiguous-delivery limits
rather than claiming impossible exactly-once delivery over an external network.

**Validation:** restart, rollback, crash-after-send, duplicate-job and retry tests;
real-PG worker claiming with concurrent workers; local failure/replay walkthrough
using stub or credential-free mail capture. Feature PR includes migrations and
worker/startup commands in README.

### O02 — Consistent cancellations and refunds

**Note (2026-10-01, K01):** cancellation refunds are superseded by the hour
credit — a cancelled paid booking's money share goes to the customer's hour
bank (`source = cancellation_credit`), never back as money. What remains of
O02 is cash refunds outside cancellation (goodwill, disputes), the durable
refund ledger and the provider round trip; still deferred.

**Depends on:** O01. **Scope:** payment/refund persistence, gateway operations,
webhooks, user/admin views and all booking/package/series cancellation paths.

**Decision first:** specify refund eligibility, amounts, fees, partial package
usage, expired credits, series changes, and admin overrides. Document policy for
historical bookings and C03/R03 reconciliation obligations. Do not infer a refund
policy solely from existing marketing copy.

**Acceptance:** cancellation records its financial disposition durably; retry or
duplicate requests cannot refund twice or both refund cash and restore equivalent
credits. Provider failure remains visible/retryable. Customers and admins see
requested/pending/succeeded/failed refund states accurately. Limit every action
to its owner/authorized org and retain an inspectable history of attempts.

**Validation:** Decimal unit tests for amounts, real-PG concurrent refund/cancel
and duplicate webhook cases, wrong-role/org failures, browser status updates,
and credential-free stub failure → restart → retry walkthrough.

### O03 — Reconcile revenue and package balances

**Depends on:** O02. **Scope:** admin statistics/reporting, payment/refund and
package records, API wrappers, admin UI.

**Acceptance:** distinguish money collected/refunded from booking face value and
remaining package credits. Include package sales once; redemption is not another
cash sale. Pending, failed, cancelled and refunded transactions are treated by
documented rules, including partial refunds and admin confirmation without payment.
Show scoped totals for an explicit date basis/period; reconcile them to underlying
records with Decimal arithmetic and no cross-org leakage.

**Validation:** a known fixture ledger including hourly and package sales,
redemption, restoration, partial refund and unpaid admin-confirmed bookings;
real-route totals/denial tests, wrapper shape tests, and operator walkthrough.

**Smoke-test evidence (2026-09-17, main `cced0f4`):** admin "Receita Total"
showed 22,00 € when 122,00 € had been collected — a 100 € pack sale is not
counted. State unchanged (HOLD); recorded only.

### O04 — Durable and recoverable room access

**Depends on:** O03 and disposition of Q28. **Scope:** `locks.py`, persisted device
mapping/code identifiers and lifecycle, jobs/recovery, dashboard/admin access UI.

**Acceptance:** persist issued-code identifiers and room/device mappings with
migrations; restart does not lose read or revoke capability. Never discard an
identifier before successful revocation. Retry failed issuance/revocation with
visible status and idempotent reconciliation of uncertain provider outcomes.
Codes are time-scoped and only visible to the customer and authorized operator;
never expose them through public availability or logs. Cover hourly webhook,
stub checkout, package/admin confirmation, single/series cancellation and edits.
A lock outage does not turn a booking operation into a misleading rollback or
lose recovery work; provide an operator-visible manual-access contingency.

**Validation:** real-PG restart and transition tests, duplicate/concurrent events,
failed revoke retained/retried, wrong-user/org code access denial, and local
stub customer-code → cancel → revoke walkthrough including series changes.

### O05 — Tenant-scoped audit history (residual scope)

**State: QUEUED.** The minimal mandatory scope — `admin_actions` written in
the same transaction as every admin mutation route, system actors
distinguished, secrets never snapshotted, the admin-only tenant-scoped
listing and `/history` routes, the `/admin/audit` page — is DONE (G01,
PR #65; archived verbatim in
[2026-10.md](docs/backlog-archive/2026-10.md#o05-tenant-scoped-audit-history)).
What that entry names beyond it is still open and stays here (review on
#71, round 3: Q54 had archived the whole task): **series changes, refund
operations and role changes as first-class audited transitions**, each with
the actor, organisation, action, target, timestamp and non-sensitive change
metadata, written in the same transaction and absent after a rollback; and
the O04 dependency (lock issuance/revocation outcomes as audited system
actions). **Depends on:** O04 for the access-code transitions; O02 for refund
operations. **Validation:** the `tests/test_audit.py` scenario table extended
to each new transition (committed, rolled back, wrong role/org denied).

### O99 — Outcome 3 acceptance

**Depends on:** O01–O05. **Scope:** integrated operational recovery exercise.

**Acceptance:** `roadmap.md` outcome-3 criteria pass on one revision. Restart the
local worker/backend around queued email, refund and access operations; inject
provider failures; recover without duplicate financial effects or lost revoke
capability. Demonstrate accurate operator statuses, revenue reconciliation and
audit history. Record unavoidable external-delivery limits and manual recovery
procedures. Required suites and migration checks pass without external credentials.

## Security hardening (S-series)

**State: ACTIVE (user assignment 2026-09-18).** A recurring audit-and-harden
loop works through the repository unit by unit: authorization and tenant
isolation, authentication, payments, input validation, rate limits,
configuration, data exposure, frontend, supply chain, containers,
`flowspace-site/`, then a bug hunt and a hardening backlog. Every finding is
proven with a failing test before it is fixed. Every hardening change names the
threat it mitigates and ships a test for the property. Security items use `S`
IDs; ordinary bugs continue the `B` series. Decisions that are the user's
(auth and session model, limits that change what a customer can do, dependency
majors, production infrastructure) are recorded with options and a
recommendation and held. This repository is public, so an unfixed finding is
described here only in general terms until its fix merges.

### S03 — Login does uneven work for known and unknown emails

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, authentication audit), severity Low: login answers an
unknown email and a wrong password with the same status and body, but it does
not do the same work for both. Registration already tells a caller whether an
address is registered, by design, and both routes share the auth rate tier, so
this is a quieter channel for the same fact rather than new information.
**Scope:** `backend/app/routers/auth.py`, `backend/app/auth.py`, tests.
**Acceptance:** login performs exactly one password verification whether or
not the account exists or has a password, proven by a test that counts
verifications for both cases. Responses, rate limits and the password policy
do not change.

### S04 — Token validation: malformed subject and missing expiry

**Priority: P3. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, authentication audit), severity Low, defence in depth:
two correctly signed but abnormal tokens are not answered with 401. Neither
can be produced without the signing key, and the application itself never
issues them. **Scope:** `backend/app/auth.py`, tests. **Acceptance:** any
signed token that is not a well-formed, expiring token for an existing user
is answered with 401, never a server error and never success; the S02 control
token still passes.

### B37 — Email addresses are case-sensitive at login and registration

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, authentication audit): the local part of an email is compared
exactly, so a customer who registered as `Ana@…` cannot sign in as `ana@…`,
and one mailbox can hold two accounts that differ only by case. There is no
account recovery flow, so the first case is a lockout from the customer's
point of view. **Scope:** `backend/app/routers/auth.py`,
`backend/app/schemas/user.py`, tests; a unique index on the lowercased address
is a separate migration step and must fail loudly on existing collisions
rather than merge accounts. **Acceptance:** login and the duplicate check
ignore case; new accounts store the normalised address; an existing
mixed-case account keeps working; both behaviours have a failing-first test.

### S06 — A door code must follow its booking out of `confirmed`

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, payments audit), severity Low today because live locks are
gated behind O04, Medium once they ship: not every operator status change away
from `confirmed` withdraws the booking's access code. API responses already
hide the code unless the booking is confirmed. **Scope:**
`backend/app/routers/admin.py`, tests. **Acceptance:** whenever a booking
leaves `confirmed`, by any route and to any status, its code is revoked; one
test per status, asserting against the stub lock gateway.

### S07 — No cap on unpaid checkout holds per customer

**Priority: P2. State: HOLD: needs decision (limits that change what a customer
can do are the owner's call).** Finding (2026-09-18, payments audit), severity
Medium: `POST /bookings` places a time-limited hold without payment, pay-now
renews a lapsed one, and nothing bounds how many holds, how many held hours or
how many renewals one customer may have. Signup is open. **Options:** (a) cap
concurrent unpaid holds per customer and organization; (b) cap total held
hours; (c) cap renewals per booking; (d) a rate tier on `POST /bookings`; (e) a
shorter hold. **Recommendation:** (a) at 3 and (c) at 2. Neither changes a
documented journey, and both are one query each under the row locks the
handlers already take. **Reversal:** both caps would be settings; raising them
restores today's behaviour. **Exposure while held:** inventory can be denied
at no cost. **Validation when decided:** a failing-first test per cap, plus the
existing hold and pay-now suites.

### S08 — Session and account model decisions

**Priority: P2. State: HOLD: needs decision (the auth and session model is the
owner's call).** Recorded by the authentication audit (2026-09-18); none is a
defect in the code as designed.

1. **Registration tells a caller whether an email is registered.** Options:
   keep / a neutral answer plus an email verification flow. Recommendation:
   keep for the POC and revisit with verification, which needs O01's durable
   email first. Exposure: account enumeration at the auth rate tier.
2. **The NextAuth session outlives the API token inside it** (30 days against
   24 hours). Options: align `session.maxAge` with
   `ACCESS_TOKEN_EXPIRE_MINUTES` / add a refresh flow / keep. Recommendation:
   align `maxAge`; it ends no working session, because after 24 hours every
   API call already fails. Reversal: one line.
3. **No revocation, lockout or MFA, and the bearer token is readable by client
   JavaScript.** Options: shorter token plus refresh / a server-side denylist
   or session store / keep the token server-side behind a Next.js proxy.
   Recommendation: ship CSP and security headers in the hardening phase now,
   which changes no model; the proxy is the long-term direction. Exposure: any
   script injection is a full account for up to 24 hours, and the only kill
   switches are deleting the user or rotating `SECRET_KEY`.
4. **No email verification and no password reset.** Options: build both /
   reset only / neither. Recommendation: reset first, on top of O01. Exposure:
   an address can be registered by someone who does not own it, and a
   forgotten password is a permanent lockout (see also B37).

### B38 — A payment that succeeds later is never confirmed

**Priority: P1. State: TODO (first in the fix phase's bug queue).** Bug
(2026-09-18, payments audit): delayed payment methods complete the checkout
session unpaid and report the money afterwards with
`checkout.session.async_payment_succeeded`, which the webhook ignores. The
live gateway does not restrict payment methods, so the Stripe account decides
whether this path exists. When it does, the customer pays, the booking or
purchase is never confirmed and the hold lapses. Which methods to offer is a
product decision and is not part of this item. **Scope:**
`backend/app/routers/webhooks.py`, tests; API_SPEC.md if it lists event types.
**Acceptance:** a paid async-success event confirms a booking or activates a
purchase exactly like a paid completion, idempotently and with the same
late-payment rules; an async failure changes nothing. Failing-first test
through the signed stub webhook. Live Stripe cannot be exercised locally.

### B39 — The webhook answers 500 to some malformed input

**Priority: P3. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, payments audit), severity Low: a correctly signed event with
an unexpected shape, and in stub mode a malformed signature header, produce a
server error where 400 is meant. Nothing is written either way. **Scope:**
`backend/app/payments.py`, tests. **Acceptance:** both answer 400 with no state
change; failing-first tests for each shape.

### B40 — Pay-now can leave a renewed hold expired

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, payments audit): "Pagar agora" on a hold whose deadline has
passed but whose row was not yet reconciled (expiry is lazy, so a dashboard
left open past the deadline is enough) answers with a checkout link while the
booking stays `expired`. Nothing holds the slot while the customer pays, so a
lost race ends in `paid_unfulfilled`, and refunds are O02. Listing bookings
first reconciles the row, which is why the common path works. **Scope:**
`backend/app/routers/bookings.py`, tests. **Acceptance:** after pay-now the row
is `pending` with a live deadline and blocks the slot for everyone else;
failing-first test with the clock pinned past the deadline.

### S10 — The cancellation email does not escape operator-controlled names

**Priority: P3. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, input-validation audit), severity Low: one of the two
transactional emails builds its HTML body without escaping text that an
operator typed, while the other escapes it. Mail clients run no script, so the
effect is limited to injected markup in a message sent from the platform's own
address. **Scope:** `backend/app/email.py`, unit tests. **Acceptance:** both
builders escape every interpolated value; a failing-first unit test with
hostile markup, and the existing builder stays covered as the control.

### S11 — The `callbackUrl` check can be bypassed

**Priority: P1. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, input-validation audit), severity Medium: the same-origin
check added for B28 can be bypassed, so a crafted sign-in or sign-up link can
send a customer to another site after they authenticate. No token travels with
the redirect. **Scope:** `frontend/lib/navigation.ts`, Vitest, one Playwright
case. **Acceptance:** every candidate is resolved against the current origin
and refused unless the origin is ours; values carrying characters that URL
parsers remove or reinterpret are refused outright; failing-first unit tests,
and a browser case proving the customer stays on the site.

### S12 — The forwarded-address option trusts the wrong entry

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, rate-limit audit), severity Medium, only with the
non-default `RATE_LIMIT_TRUST_FORWARDED_FOR=true`: the limiter's choice of
address is safe behind a proxy that overwrites the header and unsafe behind one
that appends to it, which is the common default. **Scope:**
`backend/app/ratelimit.py`, `backend/app/config.py`, tests, README.
**Acceptance:** the address is taken a configurable number of trusted hops from
the right (default 1); a failing-first test with a two-entry header; the
documentation says which proxy configurations are safe.

### S13 — Password hashing runs on the event loop

**Priority: P1. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, rate-limit audit), severity Medium: Argon2 is deliberately
expensive, and it runs inline in the async login and registration handlers, so
every other request waits while one password is hashed. The auth rate tier
bounds this per address only. **Scope:** `backend/app/routers/auth.py`,
`backend/app/auth.py`, tests. **Acceptance:** hashing runs off the event loop
behind a small concurrency cap (each hash holds 64 MB), proven by a
failing-first test in which another request completes while a login is
verifying. Parameters, limits and responses do not change.

### S14 — Every sign-in through the UI shares one rate-limit budget

**Priority: P2. State: HOLD: needs a small design decision (links to C08).**
Finding (2026-09-18, rate-limit audit), severity Medium for availability:
NextAuth signs customers in from the Next.js server, so the API sees one
address for all of them and they share the auth tier's budget. **Options:** (a)
`authorize()` forwards the caller's address and the API trusts it only together
with a shared internal secret; (b) throttle sign-in per caller in the Next.js
layer and exempt the Next.js server at the API; (c) throttle per account, which
is lockout and therefore the owner's call. **Recommendation:** (a), the
smallest change that keeps one limiter; it adds a setting whose development
default the production interlock must refuse. **Exposure while held:** a few
failed sign-ins by anyone can lock every customer out of signing in, and C08
notes that the form then reports a wrong password.

### S15 — No request body limit

**Priority: P3. State: TODO (hardening phase, request bounds).** Finding
(2026-09-18, rate-limit audit), severity Low: nothing bounds the size of a
request body, including on anonymous routes and the webhook. The limiter
rejects throttled callers before the body is read, so the cost applies to
allowed requests only. **Acceptance:** an ASGI-level limit refuses an oversized
body by declared and by streamed size with 413, with a failing-first test;
production proxies should cap too.

### S16 — The rate limiter never forgets an address

**Priority: P3. State: TODO (hardening phase).** Finding (2026-09-18, rate-limit
audit), severity Low: hits age out of the limiter's table but its keys do not,
so memory grows with every address ever seen. **Acceptance:** a key is dropped
when its window empties; failing-first unit test.

### S17 — Nothing distinguishes production from a laptop

**Priority: P1 before any deployment. State: TODO (hardening phase, production
interlock).** Recorded by the configuration audit (2026-09-18): the development
defaults all work silently. They include a published signing key and NextAuth
secret, stub payment, email and lock gateways (the stub checkout confirms
without payment and its webhook secret is public), development database
credentials, localhost CORS and return URLs, a seed script that creates an
owner with a published password, and frontend API URLs that fall back to
localhost. The repository and its history contain no real secret. The
application has no deployment today. **Acceptance:** an explicit `ENVIRONMENT`
setting, `development` by default; in `production` the backend refuses to start
on any of the defaults above and `seed.py` refuses to run, and the frontend
refuses a missing API URL and the development NextAuth secret; one test per
refusal; development and CI behaviour unchanged.

### S18 — Settings that fail open are accepted at startup

**Priority: P3. State: TODO (hardening phase).** Finding (2026-09-18,
configuration audit), severity Low: several numeric settings accept values
that silently switch a protection off or break the application, where
`BOOKING_HOLD_MINUTES` already refuses them. **Acceptance:** positive bounds on
the rate-limit numbers, the token lifetime and the lock timeout, with a
failing-first test per setting; `.gitignore` also covers environment files
named for a deployment stage.

### S20 — The public space detail shows rooms an operator deactivated

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Finding (2026-09-18, raised by the review of the S19 tests and confirmed),
severity Low: `GET /spaces/{id}` filters its room list to active rooms, but
the same response nests the space's full room relation, so a deactivated
room's name, description and rate stay public. **Scope:**
`backend/app/routers/spaces.py`, tests. **Acceptance:** no public response
carries an inactive room, nested or not; failing-first test; the nested list
is either filtered or left out of the public detail, without breaking
`frontend/lib/api.ts`.

### B41 — Availability is still served for a room whose space is deactivated

**Priority: P3. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, data-exposure audit), severity Low: deactivating a space hides
its detail page and makes its rooms unbookable, but the public availability
route checks only the room, so the calendar stays readable by room id and
advertises slots that `POST /bookings` then refuses. **Scope:**
`backend/app/routers/spaces.py`, tests. **Acceptance:** availability answers
404 for a room whose space is inactive, exactly as for an inactive room;
failing-first test.

### S21 — Frontend dependency patch and minor bumps

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Recorded by the frontend audit (2026-09-18): `npm audit` reports 21 advisories.
Non-major fixes exist for `next-auth`, `axios` and eight transitive packages.
The `next-auth` advisory that applies here lets a malformed bearer header make
the route middleware throw, which fails that one request; its critical-rated
one is in a provider this app does not use. **Scope:**
`frontend/package.json`, `package-lock.json`. **Acceptance:** `npm audit`
before and after, `tsc`, Vitest, the production build and the full Playwright
run against a rebuilt container (`docker compose up -d --build -V frontend`).
The majors (`next`, `vitest`, `eslint-config-next`) stay the owner's decision
under C04.

### S22 — The image optimizer still trusts two remote hosts nobody uses

**Priority: P2. State: TODO (hardening phase).** Recorded by the frontend audit
(2026-09-18), severity Low: the app renders no image, yet `next.config.js`
whitelists two remote hosts for the image optimizer, which keeps that endpoint
able to fetch and transcode remote files. Several unpatched advisories on the
Next 14 line need exactly that, so this is a real mitigation available without
the major upgrade. **Acceptance:** the hosts are removed (or optimisation is
switched off) and a test proves the optimizer refuses a remote URL.

### S23 — Backend dependency patch and minor bumps

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Recorded by the supply-chain audit (2026-09-18): `pip-audit` reports 19 unique
advisories in five packages. Almost all sit in form or multipart parsing, JWE
or asymmetric-key verification, none of which this app uses (JSON bodies,
HS256 with a pinned algorithm). Non-major fixes exist for `python-jose` and
`python-multipart`; most `starlette` fixes mean moving FastAPI; `ecdsa`, pulled
in by `python-jose`, has no fix. **Scope:** `backend/requirements*.txt`.
**Acceptance:** `pip-audit` before and after, the full backend suite and the
migration round trip. Replacing `python-jose`, a hashed lock file and the
`pytest` major are the owner's decisions and are recorded in the loop's report.

### S24 — Workflows without a `permissions:` block

**Priority: P3. State: TODO (hardening phase).** Recorded by the supply-chain
audit (2026-09-18), severity Low: six of seven workflows leave the token's
scope to the repository default. The Pages deploy already declares least
privilege. No workflow uses `pull_request_target`, a secret, or event data in
a shell. **Acceptance:** every workflow declares `contents: read` unless it
needs more.

### S25 — Compose publishes the development database on every interface

**Priority: P3. State: TODO (hardening phase).** Recorded by the container
audit (2026-09-18), severity Low, development stacks only: the database port
is published without a host address, so it is reachable from the local network
with the default credentials. **Acceptance:** the database port is bound to
127.0.0.1; every documented journey and CI keep working unchanged. Binding
the web ports too would stop testing from another device, so that is left to
the owner.

### S26 — Container hardening

**Priority: P3. State: TODO (hardening phase).** Recorded by the container audit
(2026-09-18), severity Low: both images run as root and carry only development
commands, the backend has no `.dockerignore`, the frontend image installs with
`npm install` rather than `npm ci`, and base images are pinned by tag.
**Acceptance:** non-root users, `npm ci`, a backend `.dockerignore` that
excludes environment files, a documented production command, and a
fresh-clone bring-up that still works in one step. Production Compose files,
proxies and TLS are the owner's decisions.

### B42 — A control character in the contact form gets the neutral message

**Priority: P3. State: TODO (queued).** Bug (2026-09-18, flowspace-site audit),
severity Low: `Code.gs` answers `invalid_characters`, which the page has no
message for, so the visitor is told the send could not be confirmed and may
retry in vain. `Code.gs` already carries a TODO for it. **Acceptance:** a
Portuguese message for that code and a smoke-spec case.

### B43 — Operator actions fail silently

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, bug hunt): no mutation on the operator pages reports a failure.
A refused booking confirmation or a failed package creation leaves the row or
the filled form exactly as it was, with no message. **Scope:**
`frontend/app/admin/**`. **Acceptance:** every operator mutation shows a
Portuguese error in a `role="alert"` when it is rejected, with a component test
per page; `dashboard/page.tsx` is the pattern.

### B44 — Pages render blank when a query fails

**Priority: P2. State: TODO (queued for the fix phase of the security loop).**
Bug (2026-09-18, bug hunt): the public spaces list and detail, the landing
space cards, the customer's packages page, the admin lists and the rooms page
for an unknown space have no error state, so an API failure looks like "there
is nothing here". **Acceptance:** each shows an error state distinct from its
empty state, with a component test; `Pricing.tsx` and `BookingModal.tsx` are
the pattern.

### B45 — Sign-in failure is not announced; two admin forms have unlabelled inputs

**Priority: P3. State: TODO (queued).** Bug (2026-09-18, bug hunt), accessibility:
the sign-in error is a plain paragraph rather than an alert, and the labels on
the admin rooms and packages forms are not associated with their inputs.
**Acceptance:** `role="alert"` on the message, `htmlFor` and `id` pairs on both
forms, component tests by accessible name.

### B46 — A confirmed booking has no operator action (question)

**Priority: P3. State: HOLD: needs a product answer.** Recorded 2026-09-18: the
operator's bookings table offers confirm and cancel for pending rows only. The
API lets an operator cancel a confirmed booking and credits package hours back;
a card payment would need a refund, which is O02. Deliberate until refunds
exist, or a gap? If deliberate, the UI should say so.

### B47 — The admin area never redirects a user who has no membership

**Priority: P3. State: TODO (queued).** Bug (2026-09-18, bug hunt), severity Low:
the admin layout redirects a non-operator only when at least one membership
exists, so an account with none sees "A redirecionar…" indefinitely.
**Acceptance:** such a user is sent to the dashboard; failing-first component
test.

## Non-roadmap deliverable — flowspace-site marketing page

### F01 — Build and deploy the flowspace-site static marketing page
Priority: P2 (independent of the active C-series queue). State: QUEUED.
Scope: flowspace-site/**, .github/workflows/deploy-flowspace-site.yml. No
changes to frontend/ or backend/.
Acceptance: all real flowspace.pt content present verbatim; contact form
sends to geral@flowspace.pt via a deployed Apps Script Web App with
honeypot + timestamp + enum validation + CacheService rate-limiting;
palette matches frontend/tailwind.config.ts; manual checklist in
flowspace-site/README.md passes; GitHub Pages deploy workflow succeeds.
Explicitly out of scope now: Google Sheets submission logging (future
follow-up, not half-built).
Copy revision of the published page (hero, "O espaço", audience, brand line)
is W01 below; the deploy workflow publishes it on the merge to main.

### B49 — The flowspace-site smoke suite is stale since the real Apps Script URL landed

**Priority: P2. State: IN PROGRESS** on `feat/flowspace-brand-copy` (found as
the W-series baseline, 2026-09-22). **Evidence (B50, 2026-10-01, Part L):** the
static site's header and footer carry the new lockup, the brand favicons
replace `assets/img/favicon.svg`, `og:image`/`theme-color` are set, the
deploy allowlist (`assets/**`) ships `assets/img/brand/`, and the standalone
smoke suite (35) asserts the header logo, its size and colour, the footer
lockup and every `<link rel="icon">`. **Evidence:** `0fc2c10` — the rewrite matches
`const APPS_SCRIPT_URL = '…';` whatever it holds; the placeholder test serves the
placeholder explicitly; a new test pins that a script without the constant still
throws. 22 passed on the committed file (3/21 before). `flowspace-site/tests/smoke.spec.ts`
rewrites the served `contact-form.js` by replacing the literal
`const APPS_SCRIPT_URL = 'PASTE_DEPLOYED_URL_HERE';`. #43 (`cced0f4`)
committed the deployed `/exec` URL in its place, so `replaceOnce` throws
"contact-form.js no longer contains …" and 18 of the 21 tests fail before
the page loads (only the hero, maps-link and one guard test pass). Not a
product bug: the site and the form are fine; the suite is a manual pre-ship
check that no CI runs (README "Optional smoke test"). **Fix:** match the
declaration whatever URL it holds (a pattern on `const APPS_SCRIPT_URL =
'…';`), still failing loudly when the constant is absent, so the suite is
independent of which URL is committed. Test-only; no production file changes.
**Acceptance:** 22/22 on the committed file (the 21 existing tests plus the
new needle test), and the needle still throws on a
file without the constant.

### B51 — Brand mark as the hero illustration (desktop) and watermark (mobile); wordmark header — both sites

**Priority: P2. State: DONE 2026-10-05** on `feat/hero-logo` (from `main`
`20ca568`; no open chain — #74–#76 merged on 2026-10-05); the implementation
commit follows the docs commit `108d035`. Owner assignment
2026-10-05: one visual change on BOTH the static site (F01, `flowspace-site/`)
and the app landing (`frontend/`), pixel-equivalent, no copy change, no new
dependency, the static-vs-app parity tests (`copy-parity.test.mjs`,
`brandParity.test.ts`) kept green. Builds on the brand set from B50.

**Scope (measurements from the approved render):**
- Hero ≥ 1024px: a two-column grid `minmax(0, 48rem) 1fr`, gap 2rem,
  `align-items: center`; the text column unchanged; the right column
  (`min-height: 420px`) centres the brand mark (`logo-mark.svg`, inline,
  `fill: currentColor`, `--color-primary`, `width: min(100%, 400px)`,
  explicit width/height, `aria-hidden`) over a soft disc (a 460×460 px
  pseudo-element, `radial-gradient(circle at 30% 30%, rgba(168,213,186,.55),
  rgba(232,244,240,0) 70%)`, `pointer-events: none`). `.hero-glow` stays.
- Hero < 1024px: single column, the right column hidden; a watermark — the
  same mark, `position: absolute; right: -7rem; bottom: -3rem; width: 440px;
  opacity: var(--hero-watermark-opacity, .08); pointer-events: none;
  aria-hidden` — bleeding off the bottom-right behind the buttons and
  benefits inside the hero's `position: relative; overflow: hidden` box;
  text contrast over it ≥ 4.5:1 (asserted). Nothing animates; CLS 0.
- Header (both sites): the lockup gives way to `wordmark.svg` alone, inline,
  22px tall, `--color-primary`, inside the existing link to "/" with
  `aria-label="FlowSpace"`. The mark alone never appears below 36px. Footer
  unchanged (white lockup, B50).
- Static site: the SVGs are emitted by `scripts/render-static.py` inside
  `brand-*` generated fences (no JavaScript); `site.css` gains `.hero-grid`,
  `.hero-mark`, `.hero-mark::before`, `.hero-watermark` and the 1024px media
  query next to the `.hero*` rules, in the "the app's …" comment style.
- App: `BrandMark` / `BrandWordmark` components rendering the same inline
  SVG from the brand files (no loader dependency); `Hero.tsx` with the
  Tailwind equivalents (`lg:grid lg:grid-cols-[minmax(0,48rem)_1fr] lg:gap-8
  lg:items-center`, `hidden lg:flex`, `lg:hidden absolute -right-28 -bottom-12
  w-[440px] opacity-[var(--hero-watermark-opacity)] pointer-events-none`);
  the Navbar uses `BrandWordmark`. No i18n change.

**Acceptance:** static smoke — at 1440 the mark is in the right column and no
watermark is displayed; at 390 the watermark is present and the right column
is not; the header link has `aria-label="FlowSpace"` and contains an svg; no
horizontal scroll at 390; text contrast over the watermark ≥ 4.5:1; CLS 0.
App — Hero component test for both branches, Navbar test for the wordmark
link, Playwright at 1440 and 390 with the same assertions, CLS 0, parity
tests green. Evidence: before/after screenshots of both heroes at 1920,
1440, 1024, 768 and 390 (`.pr-evidence/hero/`), and a side-by-side sheet
(static vs app at 1920 and 390).

**Evidence (2026-10-05):** static smoke 45/45 (+5: wordmark header, hero at
1440, watermark at 390 with no sideways scroll and the words above it,
contrast, CLS 0 at both widths); stdlib suite 26 (+2: the symbols are the
brand files' drawings, the three uses and their sizes); node tests 44;
app Vitest 708 (+7: Brand 4, Hero 3; Navbar's lockup test became the
wordmark test); Playwright `hero-logo.spec.ts` 5 on the rebuilt e2e stack;
tsc/eslint clean; `brandParity` and `copy-parity` untouched and green.
Screenshots before/after at 1920/1440/1024/768/390 for both sites and the
side-by-side sheet in `.pr-evidence/hero/`.
**DECISION (loop, B51):** the mark and the wordmark are inlined once per page
as `<symbol>`s (static: the `brand-symbols` fence after `<body>`, from the
brand files; app: `<BrandSymbols>` in the root layout from a generated path
module) and drawn with `<use href="#brand-…">` in the header, the hero and
the watermark — inline SVG with no request and `currentColor`, but the
27 KB mark path once instead of three times, and in the app nothing of it
in the client bundle (the landing JS budget stays at 209 KB). The symbol
host is `width/height 0, position:absolute`, not `hidden`: WebKit does not
draw a `<use>` whose symbol sits in a `display:none` svg. Alternative: the
path inline at every use. Reverse: emit `svg_parts()` inline in
`use_svg()` / inline the paths in `BrandMark`/`BrandWordmark`.
**DECISION (loop, B51):** the app reads the SVGs through
`scripts/brand-paths.mjs` → two generated modules (`npm run brand:paths`,
`--check` in `Brand.test.tsx`): `brandPaths.generated.ts` (the path data,
imported only by the server component `BrandSymbols`) and
`brandBoxes.generated.ts` (viewBox and size, 0.5 KB, for the client-side
`BrandMark`/`BrandWordmark`, whose ids live in `brandIds.ts`) — the project
had no raw-SVG import path and a loader would be a new dependency. The split
is what keeps the path data out of the browser bundle: the first version had
the drawers import the paths module and CI's `perf-web` caught the landing's
JS before load at 222.2 KB against the 220 KB budget (209 on `main`); a test
pins the drawers' imports. Reverse: delete the generated modules and read
the files at build time once a loader exists.
**DECISION (loop, B51):** the contrast assertion. The assignment asks for
≥ 4.5:1 over the watermark; measured at 390 (worst case: the gradient's
darkest stop composited with the mark at opacity .08): h1 14.39, filled
button 5.07, lede/support/benefits **4.08 → 3.72**, outline button **4.27 →
3.90**. The three muted elements and the outline button are under AA
*without* the watermark — the owner's palette on the hero gradient, the
Lighthouse `color-contrast` finding reported in S1 — so a literal ≥ 4.5
assertion cannot pass without changing colours the assignment keeps. The
test asserts the strongest true statement: h1 and the filled button ≥ 4.5
over the watermark; no element loses ≥ 0.5; nothing that clears AA without
the watermark falls under it; and prints every value. Recorded as B52.
Reverse: once B52 is decided, assert ≥ 4.5 for every element.

### B52 — Hero text contrast under AA on the gradient (pre-existing)

**Priority: P3. State: QUEUED — owner decision.** Measured in B51 (static
smoke "at 390 the text over the watermark keeps its contrast"): the muted
grey `#6B7280` (lede, support line, benefits) over the hero gradient's
darkest stop is **4.08:1** and the outline button's primary text **4.27:1** —
both under WCAG AA's 4.5:1 before any watermark; Lighthouse reports it as
`color-contrast` on both sites. Fix options (design): a darker muted
(`#5B6270` ≈ 4.9:1) for hero text only, a lighter gradient end, or AA-large
sizing. Not changed here (B51 keeps the palette); when decided, tighten the
B51 contrast assertion to ≥ 4.5 for every element.

### B53 — Photo carousel: the counter follows intermediate scroll events during a programmatic move

**Priority: P2. State: QUEUED** (found by B51's CI, 2026-10-06). In
`frontend/components/spaces/PhotoCarousel.tsx`, `goTo()` sets the index and
starts a smooth `scrollTo`; `onScroll` then recomputes the index from the
live `scrollLeft`, so the first scroll event of the animation (near 0) sets
it back and the counter/dots flicker 2 → 1 → 2 on every "Fotografia
seguinte". On a starved CI runner the smooth scroll can stall after that
first event and the counter stays at the old number: `photos.spec.ts:48`
("the room being booked shows its photos … and a gallery") failed on two
#90 runs (each with a retry) while passing 6/6 locally on the same code —
the page is untouched by B51. **Fix:** make the programmatic move
authoritative — keep the target in a ref while the scroll is in flight,
have `onScroll` ignore positions until it lands (±2px), and clear the ref on
`pointerdown`/`wheel` so a swipe takes over; then the test is deterministic
without being weakened. Not done in B51 (three CI rounds spent; the change is
to a component outside the assignment).

## Brand and copy revision (W-series) — owner assignment 2026-09-22

Delivered and archived (see the index); the assignment text and decisions are in [docs/backlog-archive/2026-09.md](docs/backlog-archive/2026-09.md#brand-and-copy-revision-w-series-owner-assignment-2026-09-22). Still open here: W06/W07.

### W06 — Per-room pricing (business)

**Priority: P3. State: QUEUED — owner decision.** The source copy lists prices
per room as an open item. Not touched here: no price changes in W01–W05.

### W07 — Price review (business)

**Priority: P3. State: QUEUED — owner decision.** The source copy asks for a
review of the price list. Not touched here.

## Booking rules, hour bank, admin fix (H-series) — owner assignment 2026-09-22 (PR 1)

Delivered and archived (see the index); the assignment text and decisions are in [docs/backlog-archive/2026-09.md](docs/backlog-archive/2026-09.md#booking-rules-hour-bank-admin-fix-h-series-owner-assignment-2026-09-22-pr-1). Still open here: Q-H04.

### Q-H04 — Price mismatch: the static site says 12/15/18 €/h, the app 11 €/h

**Priority: P3. State: QUEUED — owner decision.** `flowspace-site/index.html`
prices the rooms at 12€, 15€ and 18€ per hour (and "12–18€/hora" in the
pricing block); the app's seed and the landing price every room at 11,00 €/h.
Recorded by the H/V assignment; nothing changed. Links W06/W07.

## Photos, room copy, map and contacts (V-series) — owner assignment 2026-09-22 (PR 2)

Delivered and archived (see the index); the assignment text and decisions are in [docs/backlog-archive/2026-09.md](docs/backlog-archive/2026-09.md#photos-room-copy-map-and-contacts-v-series-owner-assignment-2026-09-22-pr-2). Still open here: Q-V08.

### Q-V08 — Replace the illustrations with real room photos

**Priority: P3. State: QUEUED — owner.** The four illustrated scenes are
stand-ins used on both sites for every room. When real photos exist: the app
takes them through the admin photo manager (C15) per room; the static site
takes them as a `manifest.json` edit plus the files (V02). No code change
expected.

## Admin CRUD, customer credit and brand (G/K/B series) — owner assignment 2026-09-30

One assignment in FOUR sequential parts, each on its own branch stacked on
the previous one and published as its own PR by the loop (never merged by
it): **Part A1** `feat/admin-crud-backend` (from main `8ec27cd`, #64) — G01
audit log, G02 deletion policy, G03 password reset flow, G04 the missing
admin endpoints; **Part A2** `feat/admin-crud-ui` — G05 the shared admin
CRUD kit and G06 every entity page; **Part C**
`feat/customer-credit-pack-upsell-notifications` — K01 cancellation credit
in hours, K02 pack upsell when the bank cannot cover a booking, K03 support
notifications both ways; **Part L** `feat/brand-logo` — B50 the new logo on
both sites. **Part A1 is [PR #65](https://github.com/fairglen/spacerental/pull/65); Part A2 is [PR #66](https://github.com/fairglen/spacerental/pull/66) (base `feat/admin-crud-backend`, retargets to `main` when #65 merges).** Links: A01–A07 (operator tooling this completes), O05 (G01 is
its minimal mandatory scope), O02 (K01 supersedes cash refunds for
cancellations), H02 (the hour bank K01 credits into), C13 (mixed payment),
C07 (cancellation eligibility), C15–C19 (photos, help requests, inbox),
F01 (the static site B50 changes). Binding: tenant lookup BEFORE any other
validation (403/404 before any detail leaks), `require_admin` per org,
wrapped responses, Decimal money, formal register, `frontend/lib/api.ts`
only, an Alembic migration for every schema change, tests with every
change, nothing weakened, no new dependencies. Out of scope everywhere:
money refunds (O02 stays deferred), recurring bookings (code stays, flag
off), prices, multi-org UX beyond what exists, RLS, bulk edits (follow-up),
new dependencies.

**Decisions taken by the owner (recorded, not re-opened):** admins can BOTH
set a user's password directly AND send the self-service reset link (the
reset flow did not exist; G03 builds it). A booking price override with a
required reason is allowed; no money moves. A user is never hard-deleted
while anything references them; "delete" is anonymisation. Cancelling a PAID
booking never refunds money; the paid hours are credited to the customer's
hour bank (K01). When the bank cannot cover a booking the customer is
offered a new pack as well as paying the remainder (K02). Every support
request emails the requester a copy and the support inbox
`geral+support@flowspace.pt` (K03). Credit is in HOURS, not euros (K01
records the caveat).

**Decisions the loop took (each tagged `DECISION:` in its commit; the
alternative is one commit away):** see each task. The brand task is **B50**:
the owner asked for "series B for brand", and the B-series here is the bug
series (B14–B49), so the brand item continues its numbering rather than
colliding with it.

### K01 — Cancellation credit: paid hours go to the hour bank

**Priority: P1. State: DONE (Part C, 2026-10-01, PR #67).** Today cancelling a money-paid
booking just loses the money. **Scope:** `UserPackagePurchase` gains
`source` (`purchase | complimentary | cancellation_credit`; backfill:
`amount_paid` 0 and no Stripe session → complimentary, else purchase) and
`source_booking_id` (nullable FK, UNIQUE — one credit per booking, ever);
one migration. Amount: `credit_hours = booking.total_amount /
room.hourly_rate` rounded to 0.01; the credit row stores `amount_paid =
booking.total_amount` so money reports still add up; `mixed`: the pack
share is restored to its own purchases as today, ONLY the money share
becomes a credit; `package_id` nullable if allowed, else a hidden system
package "Crédito" (record which); `hours_total = hours_remaining =
credit_hours`. Expiry `CANCELLATION_CREDIT_VALIDITY_DAYS` (default 365) in
config, Compose, `.env.example`. Triggers: customer cancel (24 h rule
unchanged), admin cancel (default ON; the admin cancel form gets "Creditar
as horas ao cliente" and a required reason when unticked; audited), admin
status → `cancelled` through the generic update. Never for
pending-unpaid, expired or `package` bookings; `manual` DOES credit.
Reversal: reinstating a cancelled booking cancels the credit if whole; if
any credited hour was spent → 409 "o crédito já foi usado; crie uma nova
reserva"; no partial reversal. **DECISION to record:** hours rather than a
euro wallet (reuses the bank, mixed payment, adjust, expiry); caveat:
hours from one room's rate may be spent in another room if rates diverge;
alternative: a euro wallet at checkout. Email: the cancellation email gains
"As <N> horas pagas ficam no seu banco de horas até <data>." when a credit
was created. Customer UI: the cancel dialog for hourly/mixed says "Ao
cancelar, as <N>h pagas ficam no seu banco de horas (válidas até
<data>)." (computed client-side), "Precisa de outra solução? Fale
connosco" stays muted; the bank card labels credit rows "Crédito —
cancelamento de <d MMM>" with expiry; totals and soonest-expiry include
them. Admin: purchases list/detail show `source`; the booking detail shows
"Crédito criado: <N>h" with a link. O02 gains the note "cancellation
refunds superseded by hour credit". **Validation (real PG, controlled
clock):** hourly cancel → one credit with the right hours/amount/expiry;
mixed → pack restored + money-share credit only; no second credit; manual
credits; pending/expired/package do not; admin cancel unticked → none +
audited reason; reinstate whole → credit cancelled; reinstate after spend →
409; credited hours spendable via mixed; expired credit excluded. Component
tests for the dialog copy and bank labels. Playwright: pay → cancel → the
bank shows the hours → rebook with them, no checkout.

**Delivered (2026-10-01):** migration `0016_cancellation_credit` (enum
`purchase_source`, backfill, `source_booking_id` UNIQUE FK SET NULL,
`package_id` nullable); `app/cancellation_credit.py` (`create_credit`,
`reverse_credit`, `CreditSpentError`) wired into `booking_cancellation.
apply_cancellation` (customer and series cancels) and the admin status
change; `BookingStatusUpdate.credit_hours` (default true, reason required
when false); `GET /admin/bookings/{id}.cancellation_credit`; the email
line; `CANCELLATION_CREDIT_VALIDITY_DAYS` in config/Compose/`.env.example`
mirrored as `NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS`
(`lib/cancellationCredit.ts`); customer dialog line + "Precisa de outra
solução? Fale connosco"; bank card and `/dashboard/packages` label
"Crédito — cancelamento de <d MMM>"; admin cancel dialog checkbox
"Creditar as horas ao cliente (<N>h)", success toast with the hours, booking
detail "Crédito criado: <N>h" linking the purchase, purchases list/detail
"Origem". Evidence: `backend/tests/test_cancellation_credit.py` (16, real
PG, pinned clock) covering every validation bullet above; `tests/
test_mixed_payment.py`'s lapsed-hold test cancels with `credit_hours:
false` so its 8h hold still lapses (the credit would otherwise cover it —
by design); migration round trip 0016 up → check → base → up → check on a
throwaway PG 16; Vitest `DashboardPage` +7, `AdminEntityPages` +2 (+1
reworked), `api.test` +1, `adminBookingErrors` +1; Playwright
`tests/e2e/cancellation-credit.spec.ts` (pay → cancel → bank → rebook, no
checkout).

**DECISION (loop, K01):** `package_id` is nullable — a credit belongs to no
pack — rather than a hidden system package "Crédito". Alternatives: a hidden
inactive package per org (keeps NOT NULL, but every package list/count and
the hour-bank maths would have to special-case it). Reverse: add the system
package in a migration, backfill credit rows to it, restore NOT NULL.
**DECISION (loop, K01):** a booking cancelled → reinstated → cancelled again
reactivates its one credit row (fresh expiry, unspent by construction)
instead of refusing a second credit, so the customer is never short the
hours they paid for; the UNIQUE `source_booking_id` still holds. Reverse:
return None in `create_credit` when a row exists in any state.
**DECISION (loop, K01):** the "Precisa de outra solução? Fale connosco"
line keeps the `payment` help category and stays muted below the buttons,
exactly where the old "Questões sobre o valor pago?" was.
**DECISION (loop, K01):** `is_creditable` treats an operator-confirmed
booking as paid (status `confirmed`/`completed`, method hourly/mixed/manual,
amount > 0): the operator asserted the payment when confirming. The
alternative — only Stripe-paid rows — would leave cash/MB WAY customers
without their hours.

### K02 — Offer a new pack when the bank cannot cover the booking

**Priority: P1. State: DONE (Part C, 2026-10-01, PR #67).** **Scope:** backend `POST
/packages/{id}/purchase` accepts optional `return_to` (a relative path:
starts with "/", no scheme/host/"//", ≤ 512 chars; else 422); when present
the checkout success URL is `<FRONTEND_URL><return_to>` + `pagamento=
sucesso` (cancel: `pagamento=cancelado`); the stub checkout honours it.
Frontend: the space/booking page accepts `?room=&start=&end=` (ISO
instants, whole hours): selects the room, opens the calendar at that day
and, once availability loads, reopens the `BookingModal` for the range if
still free, else the existing "já está reservada" notice; `?pagamento=` is
handled here with the dashboard's notice component, then the params are
stripped. `BookingModal` when the plan is `none` or `partial`: a third
choice "Comprar um pack" expanding an inline list of active packages (name,
hours, price, "válido N dias") with "Comprar" → purchase with `return_to` =
this page + `?room=&start=&end=` → follow the checkout URL; the slot is NOT
held (one muted line says so). Order: bank empty AND never bought a pack →
"Comprar um pack" first, then "Pagar agora"; otherwise "Usar as horas e
pagar o resto", "Pagar tudo agora", "Comprar um pack". After return: the
balance is refetched, the breakdown updated, confirm as usual.
**Validation:** backend as above incl. the rejections; component tests for
plan states and option order; Playwright: empty bank → slot → "Comprar um
pack" → stub checkout → back on the same slot with the modal open and the
pack preselected → confirm with no second checkout; and the taken-meanwhile
case (booked via the API as another user during the detour → notice, no
modal).

**Delivered (2026-10-01):** `PackagePurchaseBody.return_to` with
`validate_return_to` (422 for anything but a relative path);
`PaymentGateway.create_checkout_session(success_url=, cancel_url=)` on both
implementations, the stub page redirecting to the session's own URLs;
`packagesApi.purchase(…, returnTo)`; `lib/bookingDeepLink.ts`
(`parseSlotParams`, `slotReturnPath`); `components/booking/PaymentNotice.tsx`
(the dashboard's notice, now shared, with a `booking` context);
`BookingCalendar` `initialDate`/`reopen`/`onReopenDone` (free → modal, taken
→ the existing "já está reservada" notice, gone → "já não está
disponível"); `SpaceRoomsView` reads `?start=&end=&pagamento=` once and
strips them (keeping `?room=`); `paymentOptions()` in `lib/paymentSplit.ts`
gives the order; `BookingModal` lists "Comprar um pack" with the inline
packs (name, hours, price, "válido N dias"), the "O horário não fica
reservado…" line, "Comprar" → purchase with `return_to` → Checkout, and
disables "Confirmar Reserva" while buying. Evidence: backend
`tests/test_packages.py::TestReturnTo` (3 + 8 rejections); Vitest
`BookingModal` +5 (+6 reworked for the new empty-bank options),
`BookingCalendar` +3, `SpaceRoomDeepLink` +6, `bookingDeepLink` +14,
`PaymentNotice` +3, `api.test` +1; Playwright `tests/e2e/pack-upsell.spec.ts`
(empty bank → buy → back on the slot with the pack preselected → confirmed,
no second checkout; taken meanwhile → notice, no modal, the pack in the
bank all the same).

**DECISION (loop, K02):** with an empty bank the hourly option stays
preselected even when "Comprar um pack" is listed first (the order changes,
the default — confirm → Checkout — keeps today's behaviour). Alternative:
preselect the pack for a first-time customer. Reverse: default `choice` to
`'buy'` when `options[0] === 'buy'`.
**DECISION (loop, K02):** "bought a pack before" = any row in `/packages/me`
(active, spent, expired, cancelled, or a cancellation credit). Alternative:
only `source = purchase` rows.
**DECISION (loop, K02):** the packs on sale are fetched only once the bank
is known to fall short (no request for a customer whose hours cover the
block).
**DECISION (loop, K02):** `?start=&end=` must be whole hours, in order, at
most a day apart; anything else is ignored like a bad `?room=` is (no
error on a page that works without it).
**DECISION (loop, K02, review on #69):** back with `pagamento=sucesso` the
purchase may still be `pending` (Stripe activates it from its webhook, which
can land after the customer does). The slot is reopened at once but the modal
holds it in a processing state — "A confirmar o pagamento do seu pack…", no
payment choice, confirm disabled — polling `/packages/me` every 2 s for up
to 20 s (`lib/packSettle.ts`); the pack is preselected the moment it shows.
Past the bound the modal says the pack is not confirmed yet, offers
"Verificar de novo" and hands the choice back (paying by the hour is then
an informed decision; the pack stays in the account). Alternative, as the
reviewer put it: do not reopen the slot until the purchase is active —
same guarantee, but the customer stares at the calendar instead of at the
slot they came back for. The stub activates before redirecting, so the wait
is covered by component tests, not e2e. Reverse: drop `awaitingPurchase`.

### K03 — Support request notifications, both directions

**Priority: P1. State: DONE (Part C, 2026-10-01, PR #67).** **Scope:** config
`SUPPORT_INBOX_EMAIL` default `geral+support@flowspace.pt` (the
notification destination; `SUPPORT_EMAIL` was only that target, so it is
renamed — Compose, `.env.example`, README); the customer-facing contact
address stays `geral@flowspace.pt`. Requester copy: template
`support_request_received_email(to, reference, category, message,
booking_summary | None)` — subject "[FlowSpace] Recebemos o seu pedido
#<short id>"; body: thanks, category and the message quoted verbatim but
ESCAPED, a booking line when linked, "Respondemos por email para
<address>", Reply-To = the support inbox. Inbox copy: the existing
template; Reply-To = the requester; subject "[Ajuda] <categoria> — #<short
id>"; link to `/admin/support/<id>`. Both via `enqueue_email`; a failed
send is logged, the request stored. Dialog success adds "Enviámos uma cópia
para <email>". **Validation:** the stub records exactly two emails with the
right recipients/subjects/Reply-To; `<script>` in the message arrives
escaped in both; the honeypot sends nothing; component test for the copy;
Playwright: submit → the hook shows both.

**Delivered (2026-10-01):** `SUPPORT_INBOX_EMAIL` (config, Compose,
`.env.example`, README, API_SPEC) replaces `SUPPORT_EMAIL`; `email.
support_request_received_email` (subject "[FlowSpace] Recebemos o seu
pedido #<ref>", category, booking date/hours when linked, the message
escaped, "Respondemos por email para <address>", Reply-To the inbox); the
inbox template gains "Abrir no painel" → `/admin/support/<id>`; both sent
through `enqueue_email` after the row exists; the dialog's success line
"Enviámos uma cópia para <email>; respondemos por email para o mesmo
endereço."; `GET /__test__/emails` also lists `reply_to`. Evidence:
`tests/test_support.py` (two emails with the right recipients/subjects/
Reply-To, the escaped `<script>`-style payload in both, the booking line,
the honeypot still sends nothing, a mail failure still keeps the request);
`test_password_reset.py` hook shape; Vitest `HelpDialog` +1 (+1 reworked);
Playwright `help.spec.ts` reads both emails from the stub mailbox.

**DECISION (loop, K03):** the requester copy names a linked booking by its
Lisbon date and hours only (no room name, which would need a second query
on a public, throttled endpoint). Alternative: load the room for the
summary.

### B50 — New logo on both sites (brand set `flowspace-site/assets/img/brand/`)

**Priority: P2. State: DONE (Part L, 2026-10-01, PR #68).** The cleaned brand set (16 files:
`logo-full.svg`, `logo-mark.svg`, `wordmark.svg`, `spiral-mark.svg`,
`favicon.svg`, favicon-16/32/48/192/512.png, `apple-touch-icon.png`,
`logo-email.png`, `logo-email-white-bg.png`, `logo-full-white.png`,
`og-image.png`, `README.md`) is committed in Part L. **Scope:** build
`logo-horizontal.svg` (currentColor; mark left, wordmark right,
baseline-aligned, gap ≈ 0.35× the mark height, tight viewBox) into the
same folder. App: the folder copied to `frontend/public/brand/` with a
Vitest checksum-parity test so the two cannot drift; Navbar: the Building2
icon + text wordmark replaced by `logo-horizontal.svg` (28 px tall, `alt=
"FlowSpace"`, `color: var(--primary)`, link to "/"); Footer (dark): the
lockup in white, 24 px; admin sidebar and the sign-in/sign-up/reset pages:
mark + wordmark or the lockup, same colour rules; `app/layout.tsx`
metadata `icons`, `openGraph.images` = `/brand/og-image.png` (1200×630), a
`manifest` with the 192/512 icons and theme colour #3D7A5E; email
templates' header uses `<FRONTEND_URL>/brand/logo-email.png` (absolute,
200 px wide, alt "FlowSpace"), stub emails still render. Static site: the
same lockup in header and footer, `assets/img/favicon.svg` replaced, PNG
icons + apple-touch-icon added, `<link rel="icon">`s, `og:image` at the
deployed absolute URL, `theme-color`. Both: no layout shift (explicit
width/height), the header stays 64 px, legible at 390 px (`logo-mark.svg`
alone below 400 px if the lockup exceeds 60% of the header width); old
icon/wordmark code removed and the unused `brand.name` render dropped (the
key stays for `<title>` and alt text). **Validation:** component tests for
Navbar/Footer (img with alt "FlowSpace", link to "/"), the checksum parity
test, static smoke asserts the header logo and the favicon links;
screenshots of both headers (light) and both footers (dark) at 1280 px and
390 px, and the favicon in a tab.

**Delivered (2026-10-01):** the 16 files committed plus `logo-horizontal.svg`
(built from `logo-mark.svg` + `wordmark.svg`: wordmark cap height = half
the mark height, baseline on the mark's floor, gap 0.35× the mark height,
viewBox 3058×749, `id="lockup"`, `currentColor`); `frontend/public/brand/`
= a byte-for-byte copy guarded by `tests/lib/brandParity.test.ts`;
`components/layout/BrandLogo.tsx` (`<svg><use href="/brand/
logo-horizontal.svg#lockup">`, explicit width/height from the viewBox,
`role="img"` `aria-label="FlowSpace"`) in the Navbar (28 px, `text-primary`,
link to "/"), the Footer (24 px, white), the admin sidebar (24 px) and the
four auth pages (32 px); Building2 + text wordmark removed everywhere
(`brand.name` stays for `<title>`, aria-labels and the copyright line);
`app/layout.tsx` icons (svg/32/16/apple), `openGraph.images` =
`/brand/og-image.png` 1200×630, `manifest` → `public/manifest.webmanifest`
(192/512, theme #3D7A5E), `viewport.themeColor`, `metadataBase` from
`NEXTAUTH_URL`; every HTML email opens with `<FRONTEND_URL>/brand/
logo-email.png` (200 px, alt FlowSpace; `_branded()` in `app/email.py`).
Static site: the lockup in the header (`.wordmark`, 114×28, primary) and
footer (98×24, white) of `index.html`, the header of `privacidade.html`;
`assets/img/favicon.svg` removed in favour of `assets/img/brand/`
(svg/32/16 `<link rel="icon">`s, apple-touch-icon, `theme-color`,
`og:*` with the absolute `https://flowspace.pt/assets/img/brand/
og-image.png`). No layout shift: explicit width/height everywhere, the
header stays 64 px; at 390 px the lockup is 114 px (< 30 % of the header),
so the mark-only fallback is not needed. Evidence: Vitest `brandParity`
2, `Navbar` +1, `Footer` reworked (631 total); backend `test_email` +1
(header on every template) and `test_support` escaping test adjusted;
static smoke +2 (35 total); screenshots in `.pr-evidence/l/` (both headers
at 1280/390, both footers at 1280/390, sign-in, admin sidebar, favicon
sizes).

**DECISION (loop, B50):** the lockup is referenced through `<use>` rather
than an `<img>`: an `<img>` cannot take the CSS colour, and inlining 42 KB
of path data twice per page or shipping a white duplicate were the
alternatives. `<use>` with a same-origin file works in every current
browser. Reverse: swap `BrandLogo` for `<img src="/brand/logo-horizontal.
svg">` plus a white copy for the footer.
**DECISION (loop, B50):** the wordmark in the lockup is scaled so its cap
height is half the mark's height (ratio 4.08:1), which reads at 28 px;
alternative: the owner's `logo-full.svg` proportions (wordmark narrower
than the mark). Reverse: rebuild with `s = 0.45 * mark_height / cap`.
**DECISION (loop, B50):** `metadataBase` = `NEXTAUTH_URL` when set (every
Compose/deploy sets it), else Next's own fallback; Next 14 ignores it in
`next dev` anyway.

## Stack repair, CI speed and code quality (Q-series, Q40–Q56) — owner assignment 2026-10-05

One assignment in THREE sequential parts, each published as its own PR by
the loop and never merged by it. **Part 0** (Q40) repairs the stacked PRs
#65 → #68 so each PR shows only its own work; **Part 1**
`ci/fast-e2e-and-workflow-hygiene` (Q41–Q49), branched from Part 0's head,
takes the e2e job under 6 minutes on GitHub runners and hardens every
workflow; **Part 2** `refactor/admin-routers-headers-docker` (Q50–Q56),
branched from Part 1's head, is behaviour-preserving: routers by entity,
component decomposition, security headers, hardened images, backlog hygiene.
Links: C08 (its "required check behaviour for path-filtered workflows" note
is closed by Q49; its artifact/diagnostics acceptance is kept by Q44), O05
(G01's `admin_audit` router moves into the admin package in Q50 with its
tests), S24 (Q45 closes it), S26 (Q53 closes most of it), B18/B48 (the
public request budget the parallel suite must not exhaust: Q42 raises the
limits for the e2e stack only, the limiter tests stay). Binding: tenant
scoping, wrapped responses, Decimal money, formal register, `lib/api.ts`,
Alembic for every schema change, never work on main, every change ships
with tests, **never weaken, skip or delete a test or a rate limit to get
green** (an e2e-only configuration is allowed by the owner and must be
labelled as such). Decisions the owner did not give are taken the
conservative way, recorded under the task and tagged `DECISION:` in the
commit body; three failed attempts on an item → blocked and recorded.

### Q40 — Part 0: repair the PR stack (#65 → #68)

**Priority: P1. State: IN PROGRESS** on `feat/customer-credit-and-brand` —
[PR #69](https://github.com/fairglen/spacerental/pull/69) (→ `main`; four Copilot
rounds, nine threads, all fixed and resolved). **Found:** the assignment describes #65–#68 as open and mis-stacked; when
the loop started (2026-10-05 09:00 UTC) all four were MERGED — #66 into
`feat/admin-crud-backend` (squash `7f49c8d`, 2026-10-01), #68 into
`feat/customer-credit-pack-upsell-notifications` (`3f9e689`, 2026-10-01),
#65 into `main` (`3b668d0`, 2026-10-05 08:52) and #67 into
`feat/admin-crud-ui` (`cea4d08`, 2026-10-05 08:52). `main` therefore holds
A1+A2 (G01–G06 and the seven review rounds), while C+L (K01–K03, B50) sit on
`feat/admin-crud-ui` with no open PR. **DECISION:** the one C+L squash is
rebased onto `main` (`git rebase --onto origin/main dda5b70`; three
conflicts — TODO.md, `admin/bookings/[id]/page.tsx`,
`AdminEntityPages.test.tsx` — resolved to the C side, which already carried
main's fixes) on a fresh branch `feat/customer-credit-and-brand` and opened
as ONE PR to `main`; the resulting tree is byte-identical to `cea4d08`
(`git diff cea4d08 HEAD` is empty) and its diff against `main` touches 116
files, every one in #67 ∪ #68's file set (the 28 files of those PRs that are
absent are the review fixes already on `main`). Alternative rejected:
force-pushing the rebased result to `feat/admin-crud-ui` and opening the PR
from there — the branch name no longer describes its content and the owner
merged into it. The chain is now `main ← Part 0 ← Part 1 ← Part 2`.
**Acceptance:** the PR's diff is C+L only; backend, Vitest, build, static
smoke and Playwright are green on the branch; no unanswered review thread.
**Validation:** the file-set comparison above, the full local suites and CI.
Opened as [PR #69](https://github.com/fairglen/spacerental/pull/69) on
2026-10-05; local suites on `31dde69`: pytest 860, Vitest 649, build, static
smoke 35 + 44, Playwright 59/59. Review round 1 (Copilot, 2026-10-05), all
three valid and fixed in one commit: a cancellation credit above 999.99 h
(only an operator's price override can produce one; the ledger is
`Numeric(5, 2)`) is a handled 409 on both cancel paths instead of a numeric
overflow turned 500; complimentary grants are stored with `source =
complimentary` (they defaulted to `purchase`, so "Origem" called them a
sale); the booking modal forgets a "Comprar um pack" choice when the slot
changes (it reopened the pack list, or fell through to paying again once
the bank covered the new block).
Round 2 (2026-10-05): `reverse_credit` refuses a reinstatement whenever any
of the credit was spent, even after an operator cancelled the credit's
purchase row (`PUT /admin/purchases`) — the cancelled status used to read as
"already reversed" and let the booking come back while its hour was in
another booking.
Round 3 (2026-10-05): reinstating a `mixed` booking re-debits its pack
share before the credit is reversed, and the soonest-expiring walk could
draw it from the booking's own cancellation credit (a pack that outlives
the credit), which then read as spent; the re-debit walk now leaves that
credit out (`not_for_booking`), so the pack pays and the credit is reversed.
Round 4 (2026-10-05): the credit stays in the lock-ordered bank walk (locked
in its turn, never drawn) so the ledger's one lock order holds; and `PUT
/admin/purchases/:id` refuses to reactivate a cancellation credit whose
booking is no longer cancelled (the customer would hold both).
Round 5 (2026-10-05, from the review summary rather than threads): the
oversized-credit 409 has its own Portuguese line on the customer's cancel
dialog and on the operator's error mapper (a retry cannot fix it; the
amount must change), and the booking modal keeps its radios and "Confirmar
Reserva" disabled while a pack purchase is in flight, so a customer cannot
leave with a pending purchase and a hold at once.

### Q41 — Isolated, parallel Playwright specs

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); implemented on
`ci/fast-e2e-and-workflow-hygiene` (Part 1 PR, below). **Evidence:**
`frontend/tests/e2e/fixtures.ts` (`createCustomer`, `loginAs`, `createRoom`
/ `removeRoom`, `createBooking` + `payStubCheckout`, `adminBooking`,
`buyPack`, `grantHours`, `createBlock`, `freshDay` + `at`, `seededRoom`,
`contextAs`, and a `test` extended with `api`/`admin`/`room`/`customer`); all
21 spec files moved onto it — every booking spec on a room of its own, every
customer a fresh one, the seeded rooms read-only and by name; the wholesale
side effects (cancelling other users' bookings, deleting all blocks,
deactivating a seeded room, editing a seeded package) and the ten 60-second
pacing sleeps are gone. `fullyParallel`, 4 workers in CI, 1 retry in CI,
10 s expect / 60 s test timeouts, blob + github reporters in CI. Local, 4
workers, against the e2e stack: the whole suite in **~30 s** (59 tests; the
serial dev-server baseline was **10.7 min**); see the Part 1 PR body for the
three timed runs. Two assertions changed shape, not meaning: single-space's
"no choose-a-space step" now asserts the multi-space CTA is absent (the
landing's "all rooms" link to `/spaces` is the rooms view in this mode and
appears legitimately past six rooms), and photos' carousel test runs on the
rooms view, which lists every room, instead of the landing's six-room
preview. **Scope (as assigned):**
`frontend/tests/e2e/fixtures.ts` with API-level helpers that give each test
its own data — `createCustomer()` (register + enrol, unique email),
`loginAs(user)` → storageState, `createBooking(...)`, `buyPack(...)` through
the stub checkout, `createBlock(...)`, `freshDay(offset)` so no two tests
contend for one slot; UI-driven setup in existing specs replaced by them
while the UI steps under test stay; admin specs that mutate shared seed rows
(rooms, packages, the seeded booking) create their own room/package through
the admin API first; nothing asserts on another spec's side effects.
`playwright.config.ts`: `fullyParallel: true`, `workers: CI ? 4 : undefined`,
`retries: CI ? 1 : 0`, trace on first retry, `expect.timeout` 10 s, test
`timeout` 60 s, `blob` reporter in CI (for Q44's shards), `html` locally.
The B18/B48 pacing sleeps (`waitOutPublicRateWindow`) become unnecessary
under Q42's e2e stack and go. **Acceptance:** the whole suite passes three
times in a row locally with 4 workers, zero flakes, every spec independent of
ordering. **Validation:** the three runs' wall times in the PR body;
`npx playwright test --workers 4` green; no test removed or weakened.

### Q42 — e2e stack: production build and e2e-only rate limits

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); implemented on
`ci/fast-e2e-and-workflow-hygiene`. **Evidence:** `docker-compose.e2e.yml`
(overlay: `frontend/Dockerfile` target `runner` — multi-stage, `npm ci`,
non-root, `HEALTHCHECK`, `NEXT_PUBLIC_*` as build args; backend without
`--reload`; `RECURRING_BOOKINGS_ENABLED=true`; the four rate-limit tiers at
100 000 — labelled "e2e stack only" in the file and in README); the dev
Compose file only gains `target: dev`. README documents the commands.
`tests/test_ratelimit.py` untouched. **Scope (as assigned):** `docker-compose.e2e.yml`
(an overlay on `docker-compose.yml`, used by CI and documented for the native
path) in which the frontend runs a PRODUCTION build (`next build` + `next
start`), the backend runs without `--reload`, and
`RATE_LIMIT_AUTH_MAX_REQUESTS` / `RATE_LIMIT_PUBLIC_MAX_REQUESTS` (and the
support/upload tiers the specs hit) are set to values a 4-worker suite cannot
reach — **labelled "e2e stack only"** in the file and in README. The limiter
unit/integration tests are untouched and still prove the real defaults; no
browser spec asserts a 429 today, so none needs a dedicated stack.
**Acceptance:** `docker compose -f docker-compose.yml -f docker-compose.e2e.yml
up -d --build` brings up the stack a fresh clone can run the suite against;
the dev stack (`docker compose up`) is unchanged. **Validation:** the suite
under Q41 passes against it locally and in CI; `tests/test_ratelimit*.py`
unchanged and green.

### Q43 — Review the three `test.skip` occurrences

**Priority: P2. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); reviewed on
`ci/fast-e2e-and-workflow-hygiene`; all three stay, each for a reason the
fixtures cannot remove: (1) `booking.spec.ts` "24h window" — on a Sunday
before 08:00 UTC no open hour starts within the next 24 h in any room (the
rooms open 08–22), so there is nothing to book inside the window; (2)
`photos.spec.ts` carousel test and (3) `single-space.spec.ts` (every test)
— they describe single-space mode and skip when the stack has more than one
public space; the seeded stack has one, so they run in CI, and the guard is
what keeps them honest on a multi-space stack. No unexplained skip remains.
`booking.spec.ts:536` (no open hour
within 24 h on a Sunday before 08:00 UTC), `photos.spec.ts:12` and
`single-space.spec.ts:17` (both: the stack must have exactly one public
space). **Acceptance:** each is either re-enabled (because Q41's fixtures
remove the condition) or kept with its reason recorded here as its own
line; no unexplained skip remains. **Validation:** `grep -n 'test.skip'`
output matches this record.

### Q44 — The e2e job itself under 6 minutes

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); implemented on
`ci/fast-e2e-and-workflow-hygiene` (`.github/workflows/e2e.yml`, called by
`checks.yml`): two shards × 4 workers, `docker buildx bake` with the Actions
layer cache (`type=gha`, one scope per image), Chromium cached on the
Playwright version, 60 s caps on the backend and frontend waits, seed via
`compose exec`, blob reports merged by `merge-reports`, logs/traces on
failure. The measured job times are in the Part 1 PR body. Baseline (GitHub runners, last
green runs of #65/#67, 2026-10-05): job wall **14m13s–16m44s**; the `Run E2E`
step alone 14m32s; `docker compose up --build` 1m02s; Playwright install 51 s.
**Scope:** the e2e stack of Q42; Docker layer cache for both images
(`docker/setup-buildx-action` + `docker/bake-action` or `compose build`
with `cache-from/cache-to: type=gha`); `actions/cache` for
`~/.cache/ms-playwright` keyed on the Playwright version in
`package-lock.json`; `strategy.matrix.shard: [1, 2]` with
`--shard=${{ matrix.shard }}/2`, `fail-fast: false`, and a `merge-reports`
job that uploads one HTML report; a path filter that skips e2e when only
`docs/**`, `*.md` or `flowspace-site/**` change (Q49 keeps the required
check satisfied); the backend wait uses `/health` with a hard 60 s cap;
seeding via `docker compose exec`; stack logs uploaded on failure (as
today). **Acceptance:** the e2e job (each shard) finishes under 6 minutes
wall on this PR with the full suite; no test removed. **Validation:** the
before/after table in the PR body (three CI runs).

### Q45 — Workflow hygiene: permissions, concurrency, timeouts, pins, Dependabot

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); implemented on
`ci/fast-e2e-and-workflow-hygiene`: every workflow has `permissions:
contents: read` at the top (Pages deploy keeps `pages`/`id-token` on its
job; CodeQL `security-events: write` on its job), `concurrency` per
workflow and ref with cancel-in-progress on PRs, `timeout-minutes` on
every job, every `uses:` pinned to a full SHA with the version in a comment,
`.github/dependabot.yml` (actions / npm / pip weekly, grouped). actionlint
1.7.12 passes. **Closes S24 when merged.** **Scope:** every
workflow declares `permissions: contents: read` at the top and grants more
only in the job that needs it (deploy: `pages: write`, `id-token: write`;
docs-sync: nothing more — it only reads); `concurrency: { group:
${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{
github.event_name == 'pull_request' }} }`; `timeout-minutes` on every job
(lint 10, unit 15, migrations 15, e2e 30, deploy 10); every `uses:` pinned
to a full commit SHA with the version in a trailing comment;
`.github/dependabot.yml` (github-actions weekly; npm weekly grouped
minor/patch; pip weekly grouped). **Acceptance:** `actionlint` passes; every
workflow runs green on the PR. **Validation:** `npx -y @rhysd/actionlint` (or
the action) output in the PR body.

### Q46 — Security scanning workflow

**Priority: P2. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); `.github/workflows/security.yml` on
`ci/fast-e2e-and-workflow-hygiene`: CodeQL (python, javascript-typescript)
on push to main and weekly (Monday 05:23 UTC); `pip-audit` and `npm audit
--audit-level=high` on PRs with `continue-on-error` until **2026-10-19**
(the date is in the file; flip = delete two lines). **Scope:**
`.github/workflows/security.yml`: CodeQL (`python`,
`javascript-typescript`) on push to `main` and weekly; `pip-audit -r
backend/requirements.txt` and `npm audit --audit-level=high` on pull
requests — both REPORTING, not blocking, for the first two weeks, with the
date to flip them to blocking in a comment in the file. **Acceptance:** the
workflow runs green on the PR and its findings are visible in the run log
and the Security tab. **Validation:** the run on this PR; the flip date
recorded here.

### Q47 — Lint job: formatting, ESLint and the type check

**Priority: P2. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); `lint.yml` on
`ci/fast-e2e-and-workflow-hygiene` runs `ruff check` + `ruff format
--check` and, for the frontend, `npx eslint .` (new
`frontend/.eslintrc.json`: `next/core-web-vitals`) + `npx tsc --noEmit`
(moved from frontend-tests). Findings fixed: two unescaped quotes in the
admin calendar legend, the e2e helper `useDayView` renamed `selectDayView`
(the hooks rule read it as a hook); `ruff format` touched two files. **Scope:** the lint workflow adds
`ruff format --check backend`, `npx eslint .` for the frontend (what `next
build` lints, made explicit and fast) and `npx tsc --noEmit`, which moves
here from frontend-tests so a type error fails in the cheapest job; the
lint path filter widens to the frontend accordingly. If `ruff format` would
reformat untouched files, the formatting commit is separate and
mechanical. **Acceptance:** lint green on the PR; a deliberate type error
on a scratch branch fails lint, not frontend-tests. **Validation:** the
workflow run.

### Q48 — Backend tests in parallel (`pytest-xdist`, one database per worker)

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); on `ci/fast-e2e-and-workflow-hygiene`:
`pytest-xdist==3.6.1`, `conftest.py` derives `spacerental_test_<worker>`
from `PYTEST_XDIST_WORKER` before importing the app and a session fixture
creates/drops it (WITH FORCE) from the maintenance connection;
`docker-compose.test.yml` and `backend-tests.yml` run `-n auto`. Local:
**862 passed in 1:33** (`-n auto`, Docker test stack) vs **7:10** serial on
the same machine. Baseline: the CI `Run tests` step
takes **11m26s** (848–858 tests). **Scope:** `pytest-xdist` in
`requirements-dev.txt`, `pytest -n auto`; `tests/conftest.py` gives each
worker its own database `spacerental_test_<worker id>`, created and dropped
by a session-scoped fixture (the single-process run keeps the plain name);
`docker-compose.test.yml` and the loop's helpers keep working. **Acceptance:**
the whole suite passes with `-n auto` locally and in CI; no test changed
to make it pass. **Validation:** before/after times in the PR body.

### Q49 — One required check, CODEOWNERS and the README note (closes C08's note)

**Priority: P1. State: IN PROGRESS** — [PR #70](https://github.com/fairglen/spacerental/pull/70) (→ `feat/customer-credit-and-brand`, retargets to `main` when #69 merges); `.github/workflows/checks.yml` on
`ci/fast-e2e-and-workflow-hygiene`: a `changes` job classifies the diff
against the base (no third-party action), the area workflows are called as
reusable workflows only where their paths changed, and `required-checks`
passes when every one succeeded or was skipped. README "CI" says to require
that one status. `.github/CODEOWNERS` names the owner for `.github/**`,
`backend/app/auth*`, `backend/app/payments.py`, `backend/alembic/**`.
DECISION: reusable workflows rather than a `workflow_run` aggregator — a
path-filtered workflow that never runs produces no run to aggregate. **Scope:** `checks.yml` with one
`required-checks` job that depends on every other workflow's result (via
`workflow_run` or a reusable-workflow call) and passes when each is
success OR skipped by its path filter — the single check to require in
branch protection; README documents how to set it as required (the
frontend-tests/deploy "required check" comments and T4 point here).
`CODEOWNERS` naming the owner for `.github/**`, `backend/app/auth*`,
`backend/app/payments.py`, `backend/alembic/**`. **Acceptance:** on this PR
`required-checks` is green while a path-filtered workflow is skipped.
**Validation:** the check list in the PR body; branch protection itself is
the owner's click.

### Q50 — Admin routers by entity, with an OpenAPI snapshot

**Priority: P1. State: IN PROGRESS** — [PR #71](https://github.com/fairglen/spacerental/pull/71) (→ `ci/fast-e2e-and-workflow-hygiene`, retargets when #70 merges); on `refactor/admin-routers-headers-docker`
(Part 2 PR): `backend/app/routers/admin/` with `_common.py`, `dashboard.py`,
`spaces.py`, `rooms.py`, `blocks.py`, `bookings.py`, `users.py`,
`purchases.py`, `packages.py`, `organization.py`, `audit.py`, `support.py`,
assembled by `__init__.py` under one `/admin` prefix; `admin.py` (1,782
lines), `admin_users.py` (1,053), `admin_audit.py`, `room_blocks.py` and the
admin half of `support.py` are gone. `tests/test_openapi_stable.py` pins the
95 (method, path, operation id) rows against a committed snapshot taken
before the move; the full OpenAPI schema (tags included) is byte-identical
before and after (`.pr-evidence/p2/openapi-diff.txt`). Backend suite
866 passed. DECISION: `blocks.py` is mounted from the package root, not
inside `rooms.router` — a nested include would prepend the rooms tag. `backend/app/routers/admin.py`
(1,743 lines) and `admin_users.py` (1,053) become the package
`backend/app/routers/admin/`: `_common.py` (require_admin/owner, locked
loaders, `_room_in_org`, error helpers), `dashboard.py`, `spaces.py`,
`rooms.py` (incl. availability and blocks mounting), `bookings.py`,
`users.py`, `packages.py`, `purchases.py`, `support.py`, `audit.py`,
`organization.py`; one `router = APIRouter(prefix="/admin")` assembled in
`__init__.py` with the SAME paths and operation ids. **Acceptance:** the
OpenAPI schema before and after differs only in operation tags;
`tests/test_openapi_stable.py` asserts the path+method set against a
committed snapshot. **Validation:** the schema diff in the PR body, the new
test, the full backend suite.

### Q51 — Frontend decomposition

**Priority: P2. State: IN PROGRESS (first slice on [PR #71](https://github.com/fairglen/spacerental/pull/71))** —
`BookingModal.tsx` (483 lines) is now a shell (324) over
`useBookingPlan.ts` (the bank, the plan, the choices, the method, the pack
purchase; 95), `PaymentPlan.tsx` (the summary box; 87) and `PackUpsell.tsx`
("Comprar um pack"; 74), by moving the exact blocks; the 36 modal component
tests pass unchanged (imports untouched) and the full e2e suite is green on
the production build. **Remaining slice (QUEUED):** the admin `rooms/[id]`
(278 lines) and `users/[id]` (379) pages into section components under
`components/admin/<entity>/`, with `AdminEntityPages.test.tsx` passing on
import moves only. `BookingModal.tsx` → shell +
`PaymentPlan.tsx` (breakdown) + `PackUpsell.tsx` + `useBookingPlan.ts`; the
admin `rooms/[id]` and `users/[id]` pages → section components under
`components/admin/<entity>/`. **Acceptance:** no visual change; the existing
component tests pass with import moves only; Playwright proves the
journeys. **Validation:** Vitest, Playwright, the file-size table in the PR
body.

### Q52 — Security headers (Next and API), CSP report-only

**Priority: P1. State: IN PROGRESS** — [PR #71](https://github.com/fairglen/spacerental/pull/71) (→ `ci/fast-e2e-and-workflow-hygiene`, retargets when #70 merges); on `refactor/admin-routers-headers-docker`:
`frontend/lib/securityHeaders.js` (used by `next.config.js`), `/api/csp-report`
(logs every violation, both report formats; 30 reports a minute, charged per
report, per client only behind a trusted proxy — `CSP_REPORT_TRUSTED_PROXIES`,
the same opt-in as the API's limiter), `backend/app/security_headers.py`
(outermost middleware; the media mount's own `nosniff` is now its). Tests at
each level (backend integration, Vitest, Playwright `security-headers.spec`).
**Observed report:** the full e2e run (62 tests, production build) under the
report-only policy logged **zero** real violations (`.pr-evidence/p2/csp-report.txt`
— only the spec's own synthetic report). The policy still carries
`'unsafe-inline'` for scripts and styles (Next.js hydration) and `'unsafe-eval'`
outside production; Q56 owns the flip. **Scope:** `headers()` in
`next.config.js` for all routes — `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
on every page (review round 6 widened it from `/admin` and `/dashboard`: the
policy's `frame-ancestors 'none'` is report-only, so the header is what keeps
the public sign-in and reset forms out of a frame) plus `frame-ancestors 'none'`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`, HSTS only
when `NODE_ENV=production` behind TLS (documented), and a
`Content-Security-Policy-Report-Only` allowing self, the API origin, the
media origin, openstreetmap.org frames and fonts; every violation seen
during the e2e run is recorded and the policy tightened; NOT enforcing in
this PR (the flip is Q56). Backend: the same static headers on `/media` and
API responses via one middleware. **Acceptance:** header tests at the right
level (Next: a request-level test; backend: integration); e2e green with
the report-only policy. **Validation:** the CSP report summary in the PR
body.

### Q53 — Hardened container images (closes most of S26)

**Priority: P2. State: IN PROGRESS** — [PR #71](https://github.com/fairglen/spacerental/pull/71) (→ `ci/fast-e2e-and-workflow-hygiene`, retargets when #70 merges); on `refactor/admin-routers-headers-docker`:
both Dockerfiles pinned by digest, multi-stage, non-root (`app`), with a
`HEALTHCHECK`; `.dockerignore` for both; `Dockerfile.test` and the Compose
Postgres images pinned. The e2e stack ran healthy as uid 999 (backend) and
uid 100 (frontend) with the whole suite green. One-time step on an existing
dev stack whose media volume a root-running image created: fix its ownership
in place, keeping the database — `docker compose run --rm --user root backend
chown -R app:app /var/lib/spacerental/media` (review round 5: an earlier
version of this line said `down -v`, which also drops `pgdata`). **Scope:** both Dockerfiles pin
their base image to a digest (tag in a comment), create and switch to a
non-root user, declare a `HEALTHCHECK`, drop build tooling from the runtime
stage (multi-stage), and get a `.dockerignore`; the frontend gets a
production image used by the e2e stack (if Q42 did not add it). The Compose
dev flow is unchanged. **Acceptance:** `docker compose up -d --build` on a
fresh clone still works in one step; the e2e stack uses the production
image. **Validation:** the e2e run in CI; `docker inspect` user/healthcheck
in the PR body.

### Q54 — Backlog hygiene: archive DONE/DEFERRED tasks

**Priority: P2. State: IN PROGRESS** — [PR #71](https://github.com/fairglen/spacerental/pull/71) (→ `ci/fast-e2e-and-workflow-hygiene`, retargets when #70 merges); on `refactor/admin-routers-headers-docker`:
83 blocks moved verbatim to `docs/backlog-archive/2026-09.md` and
`2026-10.md` (plus Gate 0, the Deferred-scope and Legacy-IDs tables, the
boundary's assignment history and the W/H/V intros); the index at the end
of this file links every one (88 links checked). TODO.md went from 5,631 to
2,075 lines. **Residual:** the 1,200-line target is not met — what remains
is open work (S-series ≈ 390 lines, C03/C04/R01 ≈ 420, K01–K03/B50 ≈ 265
until #69 merges, this Q-series ≈ 350) and this task does not shorten open
acceptance text. Levers: archive K01–K03/B50 when #69 lands; the owner's
triage of the S-series TODO items; splitting C03/R01's done slices out as
their own archived tasks (a judgement call left to the owner). **Scope:** every DONE/DEFERRED task
block moves out of TODO.md into `docs/backlog-archive/<yyyy-mm>.md` (one
file per month of completion, verbatim, with its evidence); TODO.md keeps
the contract, the execution boundary, open/queued/blocked tasks and a
one-line index of archived IDs with links; CLAUDE.md (and its AGENTS.md
copy) say where history lives. **Acceptance:** TODO.md ends under 1,200
lines; every archived ID resolves from the index. **Validation:** `wc -l
TODO.md`; a link check over the index.

### Q55 — Small fixes found during the audit

**Priority: P2. State: IN PROGRESS** — [PR #71](https://github.com/fairglen/spacerental/pull/71) (→ `ci/fast-e2e-and-workflow-hygiene`, retargets when #70 merges); on `refactor/admin-routers-headers-docker`:
CORS `allow_methods` is the explicit list (asserted on a preflight); the
limiter is documented as single-replica in `config.py` and README; of the
eleven `eslint-disable` lines found (the assignment estimated eight), one was
dead and is removed, the other ten still fire (probed one by one) and stay;
every `test.skip` is linked (Q43). `CORS allow_methods=["*"]` → the
explicit list the frontend uses; the in-process rate limiter documented as
single-replica only in README and `config.py`; the `eslint-disable` lines no
longer needed (8 today) removed; every `test.skip` left from Q43 has a
linked task. **Acceptance:** behaviour unchanged, suites green.
**Validation:** backend CORS test, `npx eslint .`, the grep in Q43.

### Q56 — Flip the Content-Security-Policy from report-only to enforcing

**Priority: P3. State: QUEUED (after Part 2).** Recorded by Q52 with the
observed report: the violations seen during the e2e run under the
report-only policy, and the directives tightened in response. **Acceptance:**
the policy enforces with zero violations on the full e2e run and a manual
pass over the admin and dashboard pages. Not part of this assignment.

## Performance (P-series, P1.1–P2.4) — owner assignment 2026-10-05

Goal: make the app measurably faster, with every claim backed by a number
from the harness in P1.1 taken before and after. Two stacked branches, two
PRs, published by the loop and never merged by it: **Part 1**
`perf/frontend-first-paint` (P1.1–P1.5), branched from the top of the open
chain (#71's `refactor/admin-routers-headers-docker`, `b57f30c`) and
targeting it, retargeting to `main` as the chain merges; **Part 2**
`perf/api-caching-and-payloads` (P2.1–P2.4), branched from Part 1's head.
Owner's baseline on `main` (DevTools, local stack): landing FCP ~560 ms with
a 3-deep API waterfall whose last call lands at ~1.0 s, `/spaces/{id}`
requested twice, ~770 KB of JavaScript; the week view issues 7 availability
requests and the admin calendar 6; `GET /bookings/me` is 80 KB for 34 rows
and issues an UPDATE; the API sends no compression; photos carry an ETag but
no `Cache-Control`. Binding: everything in the Q-series header (tenant
scoping, wrapped responses, Decimal money, formal register, `lib/api.ts`,
Alembic, never on main, every change ships with tests, never weaken a test
or a rate limit), plus: **orjson is the only new runtime dependency**
(`@next/bundle-analyzer` is a dev dependency of the harness); no new
endpoint without its `lib/api.ts` wrapper and shape test; decisions the
owner did not give are taken the conservative way and tagged `DECISION:`.
**DECISION:** the chain is still open, so Part 1 branches from #71's head
rather than `main`; the PR body says so and the retarget order is
#69 → #70 → #71 → Part 1 → Part 2.

### P1.1 — Measurement harness (Playwright `perf`, pytest `perf`, bundle sizes)

**Priority: P1. State: QUEUED.** **Metric:** the harness itself — it must
exist before any optimisation so every later number has a "before".
**Target:** (a) Playwright project `perf` (`frontend/tests/perf/vitals.spec.ts`,
run with `--project perf` against the e2e stack, never part of the default
run) reporting per page — `/`, `/spaces`, `/spaces/{id}`, `/dashboard`,
`/admin/calendar` — TTFB, FCP, LCP, DOMContentLoaded, requests by type, JS
and total bytes on the wire (encoded), the API waterfall (every call with
its start offset and duration, depth, time of the last call), and writing
`frontend/perf-results/<page>.json` plus one markdown table; budgets read
from `frontend/perf-budget.json` when present (P2.4 fills it). (b) pytest
marker `perf` (`backend/tests/perf/`, excluded from the default run by
`-m "not perf"`) with a 10 000-booking fixture (one org, a few rooms, many
customers, bulk-inserted), a per-request SQL statement counter (engine
event) and `EXPLAIN (FORMAT JSON)` assertions on the key queries
(`/bookings/me`, admin bookings list, availability). (c)
`@next/bundle-analyzer` behind `ANALYZE=1 npm run build`. (d)
`npm run perf:sizes` printing gzipped First Load JS per route from the build
manifests (what the owner's "~770 KB" is compared against) and writing
`frontend/perf-results/sizes.json`. **Acceptance:** runs on a laptop
against `docker-compose.e2e.yml` with no credentials; the baseline for every
later task is in the PR body, taken on `b57f30c`'s production build.

### P1.2 — Landing page data on the server

**Priority: P1. State: DONE 2026-10-05** on `perf/frontend-first-paint`:
`app/page.tsx` is a server component (`force-dynamic`) that loads
`GET /spaces` and one composite `GET /spaces/{id}?include=packages`
(`backend/app/routers/spaces.py`, documented in API_SPEC.md, three
integration tests) through `INTERNAL_API_URL` (`lib/landing.ts`) and hydrates
React Query (`lib/landingState.ts`, `HydrationBoundary`) at the keys the
components read (`lib/queryKeys.ts`, shared by `useSingleSpace`, `SpaceCards`,
`Pricing`, `SpaceRoomsView`); `Pricing` reads the rooms from the same
`['space', id]` key as the cards, so the second `/spaces/{id}` request is
gone; `<link rel="preconnect">` to the API origin in the root layout.
**Measured (harness, production build):** the landing's client API calls
**4 (3 deep, last at 164 ms) → 0**, LCP 108 → 60 ms, total bytes on the
wire 979 → 800 KB; the HTML carries the rooms and the packs (22 KB gzipped,
was 6 KB). **DECISION:** no cross-request cache by default
(`LANDING_CACHE_SECONDS=0`): an operator's price change must be on the page
at once — `admin.spec.ts` (C06) pins it, and the API cannot invalidate a cache
here yet (P1.6) — so each render costs two internal API calls instead of the
browser's four; `LANDING_CACHE_SECONDS=60` is the knob the owner asked for,
documented in `.env.example`, for real traffic once P1.6 exists. The server's
reads count against the public rate limit of the frontend's address; past it
the page logs and renders without data (the browser fetches as before).
Vitest `landing.test.ts` (4), `landingState.test.ts` (3), `api.test.ts` (+2);
Playwright `landing-ssr.spec.ts` (2: the HTML names the seeded rooms and
packs; a cold load makes no catalog request). **Metric:** landing LCP (desktop, local
stack, cold cache, median of 5 from P1.1) and the client API waterfall on
`/`. **Target:** LCP ≤ 2.5 s; **zero** client-side API calls before first
paint for what the page shows (the space, its rooms, the packages) and
`/spaces/{id}` requested **once** — the data is fetched on the server through
`INTERNAL_API_URL` with `fetch(..., { next: { revalidate: 60 } })` and handed
to React Query through `HydrationBoundary`, so `Pricing`/`SpaceCards` keep
their hooks and tests; one composite read (`GET /spaces/{id}?include=packages`
or `GET /spaces/{id}/landing`, wrapped, with its `lib/api.ts` wrapper and shape
test) replaces the three-deep chain; `<link rel="preconnect">` to the API
origin for what the browser still fetches. **Acceptance:** P1.1 before/after
in the PR; the landing Vitest and e2e specs unchanged or extended, never
weakened.

### P1.3 — Bundle diet

**Priority: P1. State: DONE 2026-10-05** on `perf/frontend-first-paint`.
What the analyzer showed in the landing's first load (gzipped): Next 130 KB,
framer-motion 34.5 KB (the hero's one fade-up), the Radix select 16 KB (the
navbar's organisation switcher, shown only to members of several
organisations), date-fns 12 KB (the help dialog, mounted closed on every
page), and on `/spaces/[id]` react-big-calendar + lodash + react-overlays
+ its localizer ≈ 62 KB before a room is even picked. Done: the hero's
animation is CSS (`tailwindcss-animate`, `motion-reduce` honoured) and
framer-motion is out of `package.json`; `OrgSwitcher` is its own module
loaded with `next/dynamic` only when the session has two memberships;
`HelpDialog` loads on the first "Ajuda" (then stays mounted); the booking
calendar loads with `next/dynamic` once a room is picked; the "Onde
estamos" map embed (294 KB of third-party script, more than the whole app)
renders after the page's own `load` event — still with no click (L04) —
because `loading="lazy"` did not keep it off the first paint at desktop
width. **Measured:** `perf:sizes` `/` **249.5 → 187.4 KB gzipped** (795 →
610 KB raw), `/spaces/[id]` 277 → 201 KB, `/spaces` 278 → 202 KB,
`/dashboard` 210 → 192 KB; harness: landing JavaScript before `load`
**208 KB** (all of it was before: 639 KB), total on the wire 979 → 690 KB,
requests 56 → 50; dashboard JavaScript 369 → 264 KB; e2e 64/64 on the
rebuilt image, Vitest 685. **DECISION:** `Hero`, `ValueProps`, `HowItWorks`
stay client components — their copy goes through `useT()`, whose locale is
chosen in the browser (localStorage); a server component would freeze them
in Portuguese. date-fns stays imported per name from `date-fns` (v3 is
tree-shaken; the submodule form changes nothing in the output, checked with
the analyzer). The ≤ 300 KB gzipped target was already met by Next's own
count on the baseline; the number that moved is the real one. Side effect
for P1.4: on a deep-linked room the availability calls now start after the
calendar chunk arrives (last call 282 → 472 ms) — the chunk is to be warmed
right after the rooms paint. **Metric:** JavaScript bytes on the wire
for `/` (gzipped, from P1.1 and `perf:sizes`). **Target:** ≤ 300 KB gzipped
on `/`; `react-big-calendar` (and its CSS) loaded with `next/dynamic` only
where a calendar renders; `framer-motion` replaced by CSS transitions and
removed from `package.json`; `date-fns` imported per submodule everywhere;
`'use client'` audit — landing sections that only render copy become server
components, with the interactive leaves (locale switcher, the hero's CTA
state) as the client islands. **Acceptance:** `perf:sizes` before/after per
route in the PR; the landing component tests still pass.

### P1.4 — Fewer requests on the calendar pages

**Priority: P1. State: DONE 2026-10-05** on `perf/frontend-first-paint`.
`GET /rooms/{id}/availability?from&to` (inclusive, ≤ 14 days, 400 beyond,
backwards or mixed with `date`; the `date` form unchanged; one rules read
for the weekdays asked, one bookings and one blocks read for the whole
range) — `BookingCalendar` makes one request per view
(`lib/availabilitySpan.ts`, `placeholderData: keepPreviousData`) and
`SpaceRoomsView` prefetches it under the same key the moment a room is
picked, so it no longer waits for the calendar's on-demand module;
`GET /admin/calendar?org_id&from&to[&space_id]` (`routers/admin/calendar.py`,
≤ 14 days) answers the operator calendar's bookings and blocks in one read,
the page filters by room and status as before; `OrgContext` asks
`/auth/memberships` only when the session has not exactly one membership
(names are needed for the switcher only); `refetchOnWindowFocus: false` is
the React Query default (the operator calendar keeps its own `true`).
**Measured (harness):** week view **9 → 3 API calls** (7 availability
requests → 1; last call ends at 203 ms, was 282 ms on the baseline and 472
ms after P1.3 alone), admin calendar **6 → 2** (preflights 6 → 2), dashboard
4 → 3; e2e 64/64, Vitest 688. Tests: `test_spaces.py` (+3: a range equals
the days asked one by one, a booking and a block mark their slots across
days, the bounds), `test_admin_calendar.py` (5: both rooms and every status,
nothing from another org, space filter, outside the range, member 403,
bounds), OpenAPI snapshot refreshed on purpose for the one new operation;
Vitest `api.test.ts` (+2), `OrgContextSingle.test.tsx`, the 41 calendar
tests on the range mock. **Metric:** API requests per page view
(P1.1) on `/spaces/{id}` week view and `/admin/calendar`. **Target:** week
view 7 → **1** availability request through
`GET /rooms/{id}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, at
most 14 days, 400 beyond; the single-`date` form stays); admin calendar
6 → **≤ 2** through one composite endpoint for the day's bookings, blocks and
rooms; `OrgContext` derived from the session when it already carries the
organisation (no `/auth/memberships` round trip on every page); React Query
`placeholderData: keepPreviousData` on navigation between days/weeks and
`refetchOnWindowFocus: false` for the queries where a focus refetch is pure
cost. **Acceptance:** integration tests for the range endpoint (happy path,
14-day cap, tenant isolation) and the composite; the calendar component and
e2e specs pass unchanged; P1.1 before/after request counts in the PR.

### P1.5 — Photos and the static site

**Priority: P2. State: DONE 2026-10-05** on `perf/frontend-first-paint`.
`PhotoMosaic` and `PhotoCarousel` images carry `srcset` with the two sizes
the API keeps (480 px thumbnail, 1600 px original) and `sizes` matched to the
slot (big tile 50vw, small tiles 25vw; a card a third / a half / the full
width; the gallery 100vw); `loading` was already eager for the first and lazy
for the rest. `flowspace-site` serves Inter from `assets/fonts/` — Google's
own variable-font slices for Latin and Latin-extended (OFL, licence file
alongside), `@font-face` in `site.css`, the Latin file preloaded — and the
Google Fonts stylesheet and both preconnects are gone from `index.html` and
`privacidade.html`. **Measured:** room page images **106 → 64 KB** on the
week view and **106 → 48 KB** on a phone (media requests 16 → 13 / 12); the
landing unchanged (its cards already used thumbnails). Lighthouse on the
static site (mobile, simulated, `.pr-evidence/p1/lighthouse-site-*.json`):
**0.67 → 0.99**, FCP 3.9 → 1.4 s, LCP 4.1 → 2.0 s, CLS 0.209 → 0 (the shift
was the hero re-flowing when Google's font arrived; the preloaded file is
there before the first paint); the site's own 35 Playwright + 44 Node tests
pass. The photo component tests assert `srcset` and `sizes`. **Metric:** image bytes transferred on
`/spaces/{id}` and the landing; Lighthouse performance score of
`flowspace-site/`. **Target:** room and space photos rendered with
`srcset`/`sizes` matched to the layout and `loading="lazy"` below the fold
(the mosaic's first tile eager); `flowspace-site` self-hosts Inter (no
Google Fonts round trip, `font-display: swap`), with Lighthouse before/after
recorded in `.pr-evidence/p1/`. **Acceptance:** the photo component tests
assert the attributes; the static site's existing checks pass.

### P1.6 — Landing cache invalidation from admin mutations

**Priority: P3. State: QUEUED (found by P1.2).** **Metric:** internal API
calls per landing render. **Target:** the landing's server-side data cached
across requests (`LANDING_CACHE_SECONDS=60`, `unstable_cache` with a tag) and
invalidated when it changes — a Next route handler (`POST /api/revalidate`,
shared secret) called by the API after a space, room, package or public
contact mutation, or a short poll of a catalog `updated_at` — so a price
change still reaches the page at once (C06, `admin.spec.ts`) while a
landing render costs zero API calls between changes. **Acceptance:** the
C06 spec passes with the cache on; an integration test proves the API calls
the revalidation hook after each mutation class.

### P2.1 — Compression and cache headers

**Priority: P1. State: DONE 2026-10-05** on `perf/api-caching-and-payloads`.
`GZipMiddleware(minimum_size=1024)` on the API; `app/cache_headers.py`, one
middleware setting `Cache-Control` on every response that has none —
`/media/**` immutable for a year (names are content-addressed), the
anonymous catalog (`/spaces`, `/spaces/{id}`, `/packages`) `public,
max-age=60, stale-while-revalidate=300`, availability `no-cache`, and
`no-store` for anything with `Authorization`, any write, any error and
`/health`; the Next app serves `/brand/**` immutable (`lib/cacheHeaders.js`,
copied into the runner image). API_SPEC.md has the table. **Measured:**
`GET /bookings/me` (50 rows) **117 KB → 4.3 KB on the wire**, the admin
list (100 rows) 253 KB → 10 KB, availability 1.5 KB → 0.2 KB (`pytest -m
perf`, `wire_bytes`); harness totals on the wire: dashboard 456 → 366 KB,
admin calendar 664 → 552 KB, room page 1,265 → 1,040 KB. Tests:
`test_cache_headers.py` (7: every class, a photo immutable and a missing one
not, gzip above a kilobyte with `Vary`, plain below it and for a client that
refuses it), Vitest `cacheHeaders.test.ts`, Playwright `cache-headers.spec.ts`
(2); e2e 66/66. **DECISION:** availability is `no-cache` rather than the
minute the catalog gets — it changes with every booking and a stale copy
would only produce a 409 the customer did nothing to earn. **DECISION:**
`/brand/**` is immutable as the owner asked although its names are not
hashed: a changed brand asset must get a new name (the parity test is where
that shows). **Metric:** bytes on the wire for
`GET /bookings/me`, `GET /spaces/{id}` and `GET /admin/bookings` (P1.1); the
repeat-view request count for media. **Target:** `GZipMiddleware(minimum_size=1024)`
on the API (compressed responses for JSON above 1 KiB, small ones untouched);
`Cache-Control` by class — `no-store` for authenticated JSON, `public,
max-age=60, stale-while-revalidate=300` for the public catalog
(`/spaces`, `/spaces/{id}`, availability), `public, max-age=31536000,
immutable` for `/media/**` (names are content-addressed) and for the
frontend's `/brand/**`; the security headers are unchanged. **Acceptance:**
integration tests per class (a `Content-Encoding: gzip` response, an
uncompressed small one, each `Cache-Control` value), and the e2e suite green.

### P2.2 — Leaner payloads, the sweep off the read path

**Priority: P1. State: DONE 2026-10-05** on `perf/api-caching-and-payloads`.
`RoomSummary` (`id`, `space_id`, `name`, `hourly_rate`) is what a booking
row carries in every list (`GET /bookings/me`, `/admin/bookings`,
`/admin/calendar`, a customer's bookings on `/admin/users/{id}`), through
`BookingListOut` / `AdminBookingListOut`; list rows also omit their null
optionals (`access_code` stays, its null means "no code") and `updated_at`
(nothing reads it); the single-booking routes
keep `BookingOut` with the full room. `app/holds.py`: a lifespan task
(`HOLD_SWEEP_INTERVAL_SECONDS`, default 60, 0 off) reconciles every lapsed
unpaid hold; `_expire_lapsed_holds` reads first and only writes when a hold
really lapsed, so the reads write nothing in the steady state. API_SPEC.md
documents both. **Measured (`pytest -m perf`):** `GET /bookings/me`
**2,340 → 587 B/row**, writes **1 → 0**, 2.3 KB on the wire for 50 rows;
`GET /admin/bookings` 2,530 → 771 B/row. Tests: `test_booking_lists.py`
(4: the summary and the omitted fields on every list, a set optional kept, a
single booking whole), `test_hold_sweep.py` (5: one sweep flips exactly the
lapsed holds and the second finds nothing, the loop runs on its interval and
stops when cancelled, a failed sweep does not stop it, a read with nothing
lapsed writes nothing, a read still reconciles a hold the sweeper has not
reached); the 333 tests around bookings, holds, packs and the admin pass
unchanged. **DECISION:** the read-time reconciliation stays, made write-free
in the common case (a SELECT first), rather than removed: the C03/C13 suites
pin that a lapsed hold is `expired` the moment it is read, and a customer
who reads within the sweeper's minute should not see a stale hold.
**DECISION:** no `photo` in the summary although the assignment listed one —
no list renders a cover and it was 290 bytes a row; the detail routes carry
the photos. **Metric:** bytes per row in
`GET /bookings/me` (owner's baseline ≈ 2.4 KB/row: 80 KB for 34 rows);
statements issued by that GET (P1.1 counter). **Target:** ≤ **600 B/row**
uncompressed, with `RoomSummary` (`id`, `space_id`, `name`, `hourly_rate`,
`photo`) in booking lists instead of the full `RoomOut`, the other list
endpoints trimmed the same way (detail endpoints keep the full shapes);
`expire_user_holds` leaves `GET /bookings/me` for a 60 s asyncio task started
by the FastAPI lifespan (single-replica like the limiter; documented), so the
GET issues **zero** writes — `expire_stale_holds` on booking creation stays,
it is correctness. **Acceptance:** the perf fixture asserts the row size and
the statement count; dashboard Vitest/e2e specs pass with the summary shape;
`lib/api.ts` and `types/` updated with the shape test.

### P2.3 — Server configuration: ORJSON, workers, pool, index, lean JWT lookup

**Priority: P1. State: DONE 2026-10-05** on `perf/api-caching-and-payloads`.
`ORJSONResponse` is the app's default response class (orjson 3.12.0, the
one new runtime dependency; the wire format is pinned by
`test_json_encoding.py`: money a two-decimal string, ids strings, instants
as before — `Z` on the rows, `+00:00` on the slots — the stub checkout page
still HTML, errors still JSON); `pool_pre_ping=True` and the pool arithmetic
in `database.py` and `.env.example`; `ix_bookings_org_id_start_time` in
`Booking.__table_args__` with migration `0017` (upgrade → `alembic check`
clean → downgrade → upgrade on a fresh database); the list routes join the
room (and, for the operator, the customer) into the one query instead of a
second query per list; the production image's command is
`uvicorn --workers ${WEB_CONCURRENCY:-1} --proxy-headers
--timeout-keep-alive 15`. **Measured (`pytest -m perf`):** `GET /bookings/me`
statements **4 → 3**; `GET /admin/bookings` statements **7 → 5**, plan
**Limit → Sort → Seq Scan → Limit → Incremental Sort → Index Scan using
ix_bookings_org_id_start_time**, p50 52 → 48 ms in-process on 10 000 rows.
**DECISION:** `WEB_CONCURRENCY` defaults to **1**, not the 2 the assignment
named: the rate limiter and the hold sweeper live in each process, so a
second worker would silently double every rate limit — "never weaken a rate
limit" wins; the knob and the arithmetic are documented for the day the
limiter is shared. **DECISION:** the JWT lookup stays one `SELECT` of the
user row (eight columns, relationships never loaded); `load_only` would turn
a later touch of a deferred column into a lazy load that an async session
cannot run — the statement count the assignment cared about came down by
joining the lists' rooms instead. **Metric:** p50 of
`GET /bookings/me` and `GET /admin/bookings` with 10 000 rows (P1.1 fixture,
timed in-process); `EXPLAIN` on the admin list; statements per authenticated
request. **Target:** `ORJSONResponse` as the default response class (orjson,
the one new runtime dependency; Decimal and UUID encoded as today — asserted);
the production image's CMD runs
`uvicorn --workers ${WEB_CONCURRENCY:-2} --proxy-headers --timeout-keep-alive 15`
(Compose dev keeps `--reload`); `pool_pre_ping=True` and the pool arithmetic
documented in `database.py` and `.env.example`
(`workers × (pool_size + max_overflow)` under Postgres `max_connections`);
`ix_bookings_org_id_start_time` in `__table_args__` with its Alembic
migration and an `EXPLAIN` test proving the admin list uses it;
`get_current_user` loads only the columns the request needs (no relationship
loads). **Acceptance:** migrations workflow green; the perf tests assert the
plan and the statement count; the OpenAPI snapshot unchanged.

### P2.4 — Performance in CI, budgets, README

**Priority: P2. State: DONE 2026-10-05** on `perf/api-caching-and-payloads`.
`frontend/perf-budget.json` — per page LCP (the owner's 2.5 s ceiling),
JavaScript before `load`, requests and API calls, each the number measured
after P1–P2.2 with ~5 % of headroom — asserted by the Playwright `perf`
project; the backend `BUDGET` pinned to the measured bytes per row,
statements and writes. `.github/workflows/perf.yml` (`perf-api`: `pytest -m
perf` on a service Postgres; `perf-web`: the e2e stack from the e2e job's
layer cache, `npm run perf:web`, then `perf:sizes` on the image's build),
called by `checks.yml` whenever backend or frontend files change, both
uploading their measurements as artifacts; **not** in `required-checks`
(informational until stable). README: budgets, the CI jobs, the cache
classes, the sweeper, the production server. **Metric:** the budgets
themselves. **Target:** `frontend/perf-budget.json` — landing LCP ≤ 2.5 s,
landing JS ≤ 300 KB gzipped, requests per page (`/` ≤ 12, `/spaces/{id}`
week view ≤ 10, `/admin/calendar` ≤ 8), `/bookings/me` ≤ 600 B/row,
statements per request for the three key reads — asserted by the P1.1
harness; CI jobs `perf-web` (the Playwright `perf` project against the e2e
stack, after the e2e job) and `perf-api` (`pytest -m perf`), informational
first (not in `required-checks`) and promoted once they are stable; a
"Performance" section in README.md with how to measure locally.
**Acceptance:** both jobs green on the PR; the budgets equal the numbers
measured, not aspirations.

**DECISION (loop, P2.4, CI follow-up):** the web harness measures with
`prefers-reduced-motion: reduce` emulated. Chromium stops reporting LCP at
the first compositor-driven scroll, and the `?room=` pages scroll themselves
smoothly to the calendar on mount; on the shared runner that scroll landed
before the first paint's LCP entry was presented, so `space-day` had no LCP
in any CI run (and `space-week`'s equalled its FCP). Under reduced motion the
scroll is instant and programmatic, which LCP survives; the budgets and
everything on the wire are unchanged, and the room pages' LCP now includes
their photo (~250 ms locally). Residual, a product call: field LCP for
`?room=` deep links is cut short the same way by the smooth auto-scroll.
Alternative: scroll instantly on load. Reverse: drop `reducedMotion` from
`measureOnce`.

## Discoverability (S1/S2 series) — owner assignment 2026-10-05

Goal: make flowspace.pt findable and quotable — by search engines and by AI
assistants/agents — and stop the app and the site competing for the same
queries. Mostly static-site and metadata work; no visual redesign. Two
branches, two PRs, published by the loop and never merged by it: **S1**
`seo/static-site-discoverability` (S1.1–S1.6), branched from the top of the
open chain — `chore/land-stack-70-73` (`9f40508`: the four squash commits of
#70–#73 cherry-picked onto `main` `d67efc6`, which had only received #69; see
PROGRESS.md) — and targeting it, retargeting to `main` when it merges; **S2**
`seo/app-noindex-canonical` (S2.1), branched from S1's head. The IDs here
(S1.1…, S2.1, S3) are the assignment's and are distinct from the security
hardening S01–S27 above.

Decisions already taken by the owner (recorded, not re-opened):
- flowspace.pt (static) is the ONLY indexable surface. The app is
  `noindex, follow` everywhere; its landing canonicalises to
  https://flowspace.pt/.
- Portuguese only is indexed. No hreflang (no real EN pages exist).
- AI crawlers are ALLOWED in robots.txt; we want to be found and cited.
- No reviews, ratings or `aggregateRating` in structured data until real
  ones exist. No new marketing pages in this branch.
- The hero copy stays exactly as it is (owner's text). Title/description
  and new sections may be written for search intent.

Canonical facts (single source — `flowspace-site/assets/data/business.json`;
every rendered place agrees with it and a test asserts it): name "FlowSpace ·
Gabinetes profissionais"; Rua 12 de Julho de 1997 5, Loja 1, 2745-841 Queluz
(Massamã, Sintra), Portugal, lat 38.755723 / lng -9.279799; every day
08:00–22:00; geral@flowspace.pt, no phone; prices and packs as published on
the site (the 12€/11€ mismatch with the app's seed stays open — W06/W07);
booking URL = the app's public URL from `FRONTEND_URL`/site config; audience
"profissionais de saúde e bem-estar"; area served Queluz, Massamã, Sintra,
Lisboa (Área Metropolitana).

Baseline (2026-10-05, `9f40508`, Lighthouse 13.5 desktop preset on
`python3 -m http.server 8080`): SEO **1.00**, Best Practices **1.00**,
Accessibility **0.96** (`color-contrast`, `landmark-one-main`). No
structured data, no robots.txt, no sitemap, no llms.txt, no canonical;
`og:*` present (B50). Saved as `.pr-evidence/seo/baseline.json`.

### S0 — Owner actions (outside the repo)

**Priority: P1. State: QUEUED — owner.** Nothing here can be done from the
repository; each needs the business's accounts.
- Create/claim the **Google Business Profile** with exactly this NAP: name
  "FlowSpace · Gabinetes profissionais"; address "Rua 12 de Julho de 1997 5,
  Loja 1, 2745-841 Queluz"; no phone; website https://flowspace.pt/; hours
  every day 08:00–22:00; email geral@flowspace.pt; category "Coworking
  space" (secondary as Google offers them).
- **Bing Places** with the same NAP.
- **Google Search Console**: add the property `https://flowspace.pt/`, take
  the HTML-tag token, put it in `flowspace-site/site.env.json`
  (`SEARCH_CONSOLE_TOKEN`), run `python3 flowspace-site/scripts/render-static.py`,
  commit the regenerated `index.html` (S1.6); then submit
  `https://flowspace.pt/sitemap.xml`.
- **Bing Webmaster Tools**: the same flow with `BING_TOKEN` (`msvalidate.01`).
- Choose the social profiles for `sameAs` (none today → omitted from the
  JSON-LD); add them to `business.json` → `sameAs` when they exist.
- Set the app's public URL in `business.json` → `booking.url` once the app is
  deployed (until then the booking entry point is the site's contact form —
  see the S1.1 decision).

### S1.1 — Facts file and progressive enhancement

**Priority: P1. State: DONE 2026-10-05** (`9ef83e3`; evidence below under S1.5). `assets/data/business.json` holds the
canonical facts (name, address parts, geo, hours, email, prices, packs, rooms
with capacity/equipment/price, booking URL, logo and OG image paths).
Everything that renders facts reads from it: for a no-build site that means
`scripts/render-static.py` (stdlib only) regenerates the generated blocks of
`index.html`, `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt`
between `<!-- generated:<name> -->` fences, and a test runs the script and
fails if the committed files differ (facts can never drift). Room photos: the
first photo of each room is a real `<img>` in the HTML (src, width, height,
alt "Sala Calma — gabinete com poltronas", lazy except the first) and
`room-gallery.js` enhances it into the carousel. **Acceptance:** drift test
green; a raw-HTML test finds ≥ 3 `<img>` with alt; smoke suite green; README
documents the generator.

### S1.2 — Head, titles and sharing

**Priority: P1. State: DONE 2026-10-05** (`9ef83e3`: title 59 chars, description 151; the brand set had no manifest link — `site.webmanifest` added, generated). `<title>` ≤ 60 chars with intent + place +
brand; description ≤ 155 chars (audience, à hora, Queluz/Massamã, sem
contratos, reserva online); H1 unchanged; canonical on both pages,
`noindex` on `privacidade.html`; Open Graph + Twitter card complete
(`og:locale pt_PT`, absolute 1200×630 image with width/height/alt);
`<meta name="robots" content="index, follow, max-image-preview:large">`;
favicons/apple-touch/manifest links verified to resolve. **Acceptance:** a
no-JS test checks each tag and its length; linkinator resolves every head
link.

### S1.3 — Structured data (JSON-LD, one generated `<script>`)

**Priority: P1. State: DONE 2026-10-05** (`9ef83e3`; `tests/validate-structured-data.mjs` runs structured-data-testing-tool per node — it does not unpack `@graph`; output in the PR). One `@graph`: `Organization`,
`LocalBusiness` (address, geo, hasMap, openingHoursSpecification Mo–Su
08:00–22:00, email, priceRange "€€", areaServed, amenityFeature from the room
tags, makesOffer — "Sala à hora" per room in EUR/HUR and one Offer per pack —
potentialAction ReserveAction → the booking URL), `FAQPage` (S1.4 text,
verbatim), `BreadcrumbList`, `WebSite` (inLanguage pt-PT). No ratings.
**Acceptance:** a stdlib Python test parses the block, checks required
properties and that prices/hours/address equal `business.json`; a dev-only
validator (`structured-data-testing-tool`, in `tests/`) output attached to
the PR.

### S1.4 — Content for search intent

**Priority: P1. State: DONE 2026-10-05** (`9ef83e3`: ten Q&As in `assets/data/faq.json`, facts interpolated; the owner edits wording there). Room cards get a facts line ("Até N pessoas
· tags · preço/hora", no prose); a "Perguntas frequentes" section (`#faq`,
after Preços, before Onde estamos) with 8–10 `<details>/<summary>` Q&As in
formal Portuguese, 1–3 sentences each (for whom; how to book; "à hora" and
the 1-hour minimum; packs and validity; cancellation — até 24h antes, with
the credit to the hour bank since K01 is on `main`; access — only what is
true today; what is included; recurring needs — fale connosco, 4+ h/semana;
how to get there — transport specifics only as verifiable from OpenStreetMap;
invoices only if true). Semantic markup: one `<h1>`, `<section>`+`<h2>`,
`<address>`, `<time>`, `<nav aria-label>`, skip link, `<main>`; nav and
footer gain "FAQ". Design unchanged. **Acceptance:** FAQ text present in
raw HTML and equal to the JSON-LD `FAQPage`; smoke suite green (nav anchors
include `#faq`).

### S1.5 — Crawl files and the AI-facing card

**Priority: P1. State: DONE 2026-10-05** (site `9ef83e3`, backend `efbcb25`). `robots.txt` (allow all, explicit allows for
GPTBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended,
Applebot-Extended, CCBot; disallow only `/tests/`; Sitemap line),
`sitemap.xml` (`/`, `/privacidade.html`, lastmod from git, image entries for
the room photos), `llms.txt` and `llms-full.txt` (generated from
`business.json` + the FAQ source), `.well-known/security.txt` (Contact
mailto:geral@flowspace.pt, Expires one year out); the deploy workflow's
`OPTIONAL_PATHS` gains `llms.txt llms-full.txt .well-known`. Backend:
`GET /openapi-public.json` — only the unauthenticated read endpoints (spaces,
space detail, availability, packages) with one-line descriptions and
local-date semantics for availability, `Cache-Control: public, max-age=3600`;
linked from llms.txt as "Machine-readable availability". **Acceptance:**
robots/sitemap/llms parse; a backend test pins the public operation set and
the header; the workflow's allowlist publishes the new files.

### S1.6 — Verification and measurement hooks

**Priority: P1. State: DONE 2026-10-05** (the commit after `efbcb25`: `flowspace-site-checks.yml`, `seo-budget.json`, `tests/lighthouse-budget.mjs`, README). Verification tokens rendered into the HTML
by the generator from `flowspace-site/site.env.json` (gitignored;
`site.env.example.json` committed; `SEARCH_CONSOLE_TOKEN`, `BING_TOKEN`) —
no JS injection. CI: a new `flowspace-site-checks.yml` (path-filtered) runs
the node tests, the Python facts/JSON-LD tests, the Playwright smoke suite,
Lighthouse (mobile preset; SEO ≥ 95, Best Practices ≥ 90 from
`seo-budget.json`) and `linkinator` against a local server. **Acceptance:**
the workflow is green on the PR; the README documents the owner flow.

**Evidence (S1.1–S1.6, 2026-10-05):** `python3 tests/test_static_site.py` 24
passed; node tests 44; smoke suite 41/41 (+6); backend
`test_openapi_public.py` 4 + OpenAPI snapshot 2 + cache headers 7 passed;
ruff clean; the authz matrix classifies `GET /openapi-public.json` as public (CI round 1 on #75). Lighthouse (local `python3 -m http.server`): desktop SEO 1.00 /
Best Practices 1.00 / Accessibility 0.96 → 0.97 (`landmark-one-main` fixed
by `<main>`; `color-contrast` on muted text remains — design unchanged,
owner's call); mobile 1.00 / 1.00 / 0.97. linkinator 15 links, none broken.
`.pr-evidence/seo/`.

**DECISION (loop, S1.1):** the booking URL is the site's contact form
(`booking.url`), since no public address of the booking platform exists in
the repo; `booking.app_url`/`api_url` are null and the generator switches the
ReserveAction and the llms.txt lines to them when set (S0). Reverse: set the
two fields and regenerate.
**DECISION (loop, S1.1):** capacity is stated only where the published tags
state it (Sala Calma 2, Sala Névoa 6); Sala Brisa gets no number rather than
the app's seed value. Reverse: set `capacity` in business.json.
**DECISION (loop, S1.2):** `privacidade.html` is in the sitemap as the
assignment lists it although it is `noindex` — a mixed signal Google
tolerates. Reverse: drop it from `file_sitemap`.
**DECISION (loop, S1.3):** `additionalType` is the Wikidata item for
"coworking space" (Q5146147). Reverse: drop the property.
**DECISION (loop, S1.4):** transport states only what OpenStreetMap confirms
(the Massamá-Barcarena railway halt ~600 m away), not the line's name
(Overpass timed out twice; Nominatim answered). Access states the software
path (code in the customer area once confirmed). Invoices: nothing in the
product → omitted.
**DECISION (loop, S1.5):** the generator's `--check` ignores `<lastmod>`
values (git's date lags by one commit by construction); the workflow checks
out with full history so the printed date is right.
**DECISION (loop, S1.6):** `assets/js/site-config.js` does not exist (the
form URL lives in `contact-form.js`), so the tokens come from
`flowspace-site/site.env.json` (gitignored, example committed) through the
generator; the `verification` block is left as committed when the file is
absent, so CI agrees with an owner-rendered token. Accessibility is reported
by the budget, not gated, until the contrast finding is the owner's decision.

### S2.1 — The app stops competing

**Priority: P1. State: DONE 2026-10-05** (branch `seo/app-noindex-canonical` from S1's head; the commit after `8541eb0`).
`frontend/app/robots.ts` allows crawling; root metadata `robots: { index:
false, follow: true }`; `alternates.canonical: 'https://flowspace.pt/'` on
the landing only; `metadataBase` from `FRONTEND_URL`; no `sitemap.ts`; OG
tags stay; `/dashboard`, `/admin/**`, `/sign-in`, `/reset-password/**` add
`nofollow` and `X-Robots-Tag: noindex` via `headers()`; `lang="pt-PT"`.
**Acceptance:** route tests for the robots meta on landing vs admin;
Playwright asserts the landing canonical.

**Evidence (S2.1):** `lib/seo.ts` (`ROBOTS_APP`, `ROBOTS_PRIVATE`,
`SITE_CANONICAL`, `metadataBaseFrom`), `lib/robotsHeaders.js` (X-Robots-Tag
rules, copied into the runner image), `app/robots.ts`, root metadata
`robots: { index: false, follow: true }` + `lang="pt-PT"`, the landing's
`alternates.canonical`, `robots: ROBOTS_PRIVATE` on the dashboard, admin,
sign-in and reset-password layouts. Vitest `tests/lib/robotsHeaders.test.ts`
(3) + `tests/app/robotsMetadata.test.ts` (4); Playwright
`tests/e2e/seo-policy.spec.ts` (4: landing meta/canonical/lang/OG, rooms
page, sign-in + dashboard header on the redirect and signed in, robots.txt).
**DECISION (loop, S2.1):** `metadataBase` reads `FRONTEND_URL` and falls back
to `NEXTAUTH_URL` — the frontend container only receives the latter today
and the two are the same address by construction; a bare build keeps Next's
own localhost fallback (existing behaviour). Reverse: require `FRONTEND_URL`.
**DECISION (loop, S2.1):** the X-Robots-Tag header covers exactly the four
private roots named by the assignment (and their children); the landing,
`/spaces/**` and `/sign-up` carry `noindex, follow` through metadata only,
so shared links keep their previews. Reverse: add sources to
`PRIVATE_SOURCES`.

### S3 — MCP server for availability + booking

**Priority: P3. State: DEFERRED.** An MCP server exposing availability
(read) and booking (write, authenticated) for assistants, on top of the
public OpenAPI card from S1.5. Not started; recorded so the public API card
has a successor.

## Dependency upgrades (D-series, D10–D18) — owner assignment 2026-10-06

Goal: every open Dependabot PR fixed, green and merged in tier order (actions
→ npm minor/patch → pillow → postgres → node image → pip group → pytest /
pytest-asyncio → stripe → vitest + jsdom → tailwind), each one tested locally
before it is pushed, with the decisions a major bump forces recorded here and
in the commit that takes them. The IDs start at D10: D01–D06 were an earlier
series, now archived. Merging is authorised for Dependabot PRs only (squash,
delete branch); no other PR is merged by the loop. Never a weakened, skipped
or deleted test, rate limit or budget to get green. Progress and the per-PR
outcome table live in PROGRESS.md (git-excluded) until the final report.

### D10 — Postgres major: one version everywhere (#77, 16 → 18)

**Priority: P1. State: DONE with #77.** Dependabot bumped the two Compose
files only. The 18 image keeps its data in a version-specific subdirectory
(`PGDATA=/var/lib/postgresql/18/docker`) and declares `/var/lib/postgresql`
as its volume: our `pgdata:/var/lib/postgresql/data` mount made the container
exit at start ("in 18+, these Docker images are configured to store database
data in a version-specific subdirectory"), which is what the PR's red e2e and
perf-web jobs were. The named volume is now mounted at `/var/lib/postgresql`;
the three CI service containers (backend-tests, migrations, perf) and the docs
follow the bump; README has a "Postgres major upgrade" note (a 16-era
`pgdata` volume will not start on 18 — `docker compose down -v` and reseed).

**DECISION (loop, D10):** dev Compose, the test Compose, CI service containers
and the docs track **one** Postgres major (18 as of this task); a production
database on a different major is a configuration mismatch to fix there, not
a reason to keep two versions in the repo.

### D11 — Node major: LTS 24 for the image and CI, not 26 (#78)

**Priority: P1. State: DONE with #78.** Dependabot proposed `node:26-alpine`
for the frontend image while every workflow still ran `setup-node` 20. Checked
on the current lock (Next 14.2, Vitest 2 + jsdom 24, Playwright 1.63): on Node
26.10 Vitest fails in 25 files — Node 26 ships the Web Storage globals, which
shadow jsdom's `localStorage`/`sessionStorage` in every component test that
touches them (`undefined.getItem`); `next build` and `tsc` were fine. On Node
24.21 (LTS): Vitest 709/709, `next build`, `tsc`, the image build on
`node:24-alpine` and Playwright 75/75 with the host runner on 24 all pass.

**DECISION (loop, D11):** the frontend image and every `setup-node` step
(lint, frontend-tests, e2e ×2, flowspace-site-checks, perf, security) move to
**Node 24 LTS** together, pinned by digest in the Dockerfile; CI and the image
always run the same major. Node 26 is revisited when jsdom 30 / Vitest 5 (D-series,
#85/#87) are in, which own the storage globals properly. Note for the next
bump: npm 11.19 (bundled with 24 and 26) does not run the install scripts of
esbuild, msw and unrs-resolver unless approved; builds and tests pass without
them, so nothing is approved until something needs it.

### D12 — SQLAlchemy 2.1 deprecates `lazy="noload"` (follow-up to #79)

**Priority: P2. State: QUEUED.** The pip group (#79) brings SQLAlchemy 2.1.3,
which warns at mapper configuration that the `noload` loader strategy "is
deprecated and will be removed in a future release" because it "produces
incorrect results by returning `None` for related items". The models use it
deliberately (CLAUDE.md §4: no surprise N+1s) on `Booking.room/user/
recurrence/package_debits/…` and `AdminAction.actor`; every route that needs
a relationship loads it explicitly. Replacing it is a semantic change (the
candidate is `lazy="raise"`, which makes an unloaded access an error instead
of `None`, and needs every `None`-tolerant reader audited), so it is not done
inside a dependency PR. Acceptance: no `SADeprecationWarning` for `noload` in
the suite, every route still loads what it reads, suite green.

### D13 — pytest 9 and pytest-asyncio 1.4 together; one session loop by configuration (#81, #80 superseded)

**Priority: P1. State: DONE with #81.** Dependabot opened pytest 8.3 → 9.1
(#80) and pytest-asyncio 0.23 → 1.4 (#81) separately, and each was red on
its own: pytest-asyncio 1.4 needs pytest ≥ 8.4, so #81 could not even
install (`ResolutionImpossible`), and #80 alone left pytest-asyncio 0.23.8
pinned to pytest < 9. pytest-asyncio 1.x also removed the overridable
`event_loop` fixture that `tests/conftest.py` used to give the whole session
one loop (the asyncpg rule in CLAUDE.md §6.1).

**DECISION (loop, D13):** both bumps land on #81 — `pytest==9.1.1` next to
`pytest-asyncio==1.4.0` — and #80 is closed as superseded. The session
fixture is gone; `pytest.ini` sets `asyncio_default_fixture_loop_scope =
session` and `asyncio_default_test_loop_scope = session`, which is the same
one-loop-per-session (per xdist worker) behaviour expressed the way 1.x
expects. `worker_database` keeps its own private loop for the maintenance
connection, as before. Evidence: full suite 915 passed three times on the
pytest-9 image before the rebase (2 workers ×2, serial ×1) and again on the
rebased tree, with the "event_loop fixture redefined" deprecation gone.

### D14 — Vitest 2 → 5 with its companions, on top of jsdom 30 (#85; #87 merged by the owner)

**Priority: P1. State: DONE with #85.** Vitest 5 lists `vite` as a peer only
(≥ 6.4) and pins `@vitest/ui` to its own version; `@vitejs/plugin-react` 4
knows vite ≤ 5; jsdom 30 wants Node ≥ 22.22 / 24.15 (we run 24.21, D11).
So the bump is one lock refresh: `vitest` 5.0.3, `@vitest/ui` 5.0.3, `vite`
7.3.7 (explicit devDependency), `@vitejs/plugin-react` 5.2.0, `jsdom`
30.1.x, `@types/node` ^24 (Vitest 5's peer range; matches the runtime).
Two things changed behaviour: Vitest 5 no longer inherits `jest.Matchers`,
so jest-dom's jest-side augmentation stopped reaching `expect` and `tsc`
lost every `toBeInTheDocument`/`toHaveAttribute` (591 errors) —
`tests/setup.ts` imports `@testing-library/jest-dom/vitest` now, the entry
that augments Vitest's own `Assertion`; and the `--poolOptions.*` CLI flags
are gone (`--maxWorkers`). Nothing in the suite hit the other breaking
changes (`clearMocks` default, top-level `vi.mock`, unawaited async
assertions, `toThrow('')`, reporter paths).

**DECISION (loop, D14):** the companions above are part of the same change
because the peer ranges leave no other working combination. jsdom 30 was
meant to ship here with #87 closed as superseded; the owner merged #87 (and
#86, tailwind-merge 3) directly meanwhile, so #85 carries the Vitest side and
rebases on top of them.

### D15 — e2e cross-worker interference (two flake signatures from the dependency CI runs)

**Priority: P2. State: QUEUED.** Seen on #82's `e2e (2/2)` shard (4 workers,
nothing in the PR touches the frontend or the backend code): (1)
`pack-upsell.spec.ts:127` died in the `room` fixture — `POST
/admin/rooms/{id}/availability` answered 404 "Room not found" right after
`createRoom` had returned the room — and (2) `single-space.spec.ts:79`
expected the first "Onde estamos" line to be "Todos os dias 08:00–22:00" and
got it with "Horário por sala no calendário." appended, i.e. another
worker's room with different hours was alive in the shared seeded space at
that moment. Both are ordering-dependent; a rerun passed. Acceptance: the
room fixture tolerates (or explains) the 404, the single-space spec asserts
on its own space or waits for a quiet window, and ten consecutive sharded
CI runs stay green.

### D16 — Tailwind CSS 3 → 4 with tailwind-merge 3, behind a pixel gate (#88; #86 merged by the owner)

**Priority: P1. State: DONE with #88.** tailwind-merge 3 (#86, merged by
the owner first) officially drops Tailwind 3, so the two belong together.
The migration ran `npx @tailwindcss/upgrade@4.3.3` from main's Tailwind 3
`package.json` (with `tailwindcss ^4` already in it the tool treats the
project as v4 and skips the migration, then crashes on `@apply
border-border`): `tailwind.config.ts` became `@theme` tokens in
`app/globals.css`, `postcss.config.js` uses `@tailwindcss/postcss` (no
autoprefixer), 32 templates got the v4 names (`outline-hidden`,
`shadow-xs`, `rounded-sm`, `bg-linear-to-br`, `opacity-(--var)`,
`aspect-16/10`, `data-disabled:`…). Two tool mistakes were undone: it
rewrote the Button `variant` prop value `'outline'` to `'outline-solid'`
(a string, not a class) in four files, and it dropped the
`tailwindcss-animate` JS plugin without a replacement while the dialog,
select, dropdown and toast primitives use its `animate-in`/`fade-in-0`/
`zoom-in-95`/`slide-in-from-*` utilities — `tw-animate-css` 1.4.0, the
CSS-only port with the same names, is imported after `@import
'tailwindcss'`.

**The gate:** `tests/e2e/visual-gate.spec.ts` screenshots landing, space +
booking calendar, dashboard, admin calendar and admin bookings at 1280 and
390 (animations disabled) and compares them to snapshots taken on main
(Tailwind 3 + tailwind-merge 3) with `maxDiffPixelRatio: 0.005`; it is
opt-in (`VISUAL_GATE=1`) because the snapshots belong to the machine that
captures them (chromium-darwin here) and CI's Linux runners have none.
Round 1: 8 of 10 identical, landing +34 px / +36 px. Measuring both builds
element by element found three v4 semantics changes, each fixed by
spelling out what v3 had rendered: (1) v3's responsive `md:text-6xl` was
emitted after `.leading-tight` and reset the hero `h1` line-height to 1;
v4's `--tw-leading` lets `leading-tight` win → `md:leading-none`; (2) v3's
`space-y-*` rule (`> :not([hidden]) ~ :not([hidden]) { margin-top }`)
overrode the children's own `mt-*`, v4's (`> :not(:last-child) {
margin-bottom }`) adds to them → the dead `mt-*` inside `CardHeader`
(pricing cards, the four auth pages, the pricing skeleton) removed; (3)
the dialog's `slide-in-from-left-1/2 / top-[48%]` classes compensated v3's
enter keyframe replacing the centring `transform`; v4 centres with the
`translate` property, which the keyframe leaves alone, so the same classes
started the dialog half a screen higher (the short-screen e2e caught it at
y = −181) → dropped, as shadcn's v4 dialog does. Two e2e assertions pinned
v3 computed strings (`rounded-full` = `9999px`, now `calc(infinity * 1px)`;
the `--hero-watermark-opacity` token `0.08`, now minified to `.08`) and
compare the values instead. Round 2 (baseline retaken on main `858c89b`
with the calendars' moving "now" line masked): **10 of 10 identical**,
full Playwright 75/75 on the Tailwind 4 image, Vitest 710/710, tsc and
ESLint clean; `flowspace-site/assets/css/tokens.css` untouched.

**DECISION (loop, D16):** the bump keeps the rendered pages pixel-identical
to Tailwind 3 by making v3's implicit cascade explicit, rather than
accepting v4's (arguably intended) rendering; any visual re-tuning is a
separate, owner-driven change. `space-y-*` containers whose children carry
their own margins are the one pattern worth a sweep outside the gated
screens (admin forms); the gated screens are clean.

### D17 — Next.js major: the only remaining `npm audit` findings live in Next 14's bundled PostCSS

**Priority: P2. State: QUEUED.** With every Dependabot PR of this assignment
merged, `npm audit --audit-level=high` on the frontend lock reports 5
findings (4 high, 1 critical), all in `node_modules/next/node_modules/postcss`
— the PostCSS copy Next 14.2 bundles for its own CSS pipeline
(GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp,
GHSA-r28c-9q8g-f849). The project's own `postcss` ^8 is current; the fix
npm offers is `next@16`, a major that changes the App Router, caching
defaults, `next lint`, the Node floor and the image pipeline — not a
dependency bump but a migration with its own gate (the visual gate from
D16 is reusable). `pip-audit -r backend/requirements.txt` is recorded in
the closing report. Acceptance: Next on a supported major with the audit
clean at `--audit-level=high`, the visual gate 10/10, Playwright green.

### D18 — `pip-audit`: python-jose 3.5.0 and its `ecdsa` dependency carry unfixed advisories

**Priority: P2. State: QUEUED.** With the pip group (#79) merged,
`pip-audit -r backend/requirements.txt` reports 3 known vulnerabilities in
2 packages and no fixed versions: `python-jose 3.5.0` (CVE-2026-85394) and
`ecdsa 0.19.2` (PYSEC-2026-1325, twice), `ecdsa` being python-jose's
transitive dependency. The app signs and verifies HS256 JWTs only
(CLAUDE.md §2–3), so neither the ECDSA code paths nor python-jose's
algorithm negotiation is exercised, but an unfixable advisory on the auth
library is not something to carry. Candidate: replace python-jose with
PyJWT (HS256 only, explicit `algorithms=["HS256"]`, no `ecdsa`), keeping
`create_access_token`/`decode` behaviour and every auth test. Acceptance:
`pip-audit` clean, `tests/test_auth.py` and the authz matrix green,
tokens issued before the switch still verify.

## Local access from another device (D-series, D19–D20) — owner assignment 2026-10-06

Goal: the local stack can be used from another device — a phone on the same
Wi-Fi via the host's LAN IP, or anything via ngrok — by layering a second env
file on top of `.env`, with no code path changed for the default localhost
setup. One branch (`chore/remote-access-env`), one PR, never merged by the
loop. Decisions not given by the assignment keep today's behaviour and are
recorded here and in the commit that takes them.

### D19 — Reach the local stack from another device (LAN or ngrok) via a layered env file

**Priority: P2. State: IN PROGRESS (branch `chore/remote-access-env`).**
`docker-compose.yml` hard-codes the three browser-facing values that decide
whether another device can use the stack: `CORS_ORIGINS`, `NEXTAUTH_URL` and
`NEXT_PUBLIC_API_URL` are literal `localhost` there, while the rest of that
family (`FRONTEND_URL`, `MEDIA_BASE_URL`, `STRIPE_SUCCESS_URL`,
`STRIPE_CANCEL_URL`, `STRIPE_STUB_CHECKOUT_BASE_URL`) already reads `.env` with
a localhost default. Opening `http://<LAN-IP>:3000` from a phone therefore
renders the landing page and then fails at sign-in: the NextAuth cookie is
bound to `NEXTAUTH_URL`, the browser's API calls go to `localhost:8000` (the
phone itself), and the API would refuse the origin anyway.

Scope (nothing in `backend/app` or `frontend/` changes):
- `docker-compose.yml`: the three values become `${VAR:-<today's value>}`,
  like the rest of the family. `INTERNAL_API_URL` (`http://backend:8000`) is
  container-to-container (CLAUDE.md §6.3) and stays a literal, outside this
  mechanism.
- `.env.remote.example` (committed; `.env.remote` git-ignored): a LAYER for
  `docker compose --env-file .env --env-file .env.remote up -d -V`, not a
  full env file — it holds only the overrides and derives every browser-facing
  URL from two variables, `WEB` (public URL reaching port 3000) and `API`
  (public URL reaching port 8000), so switching means editing two lines.
- `scripts/remote-up.sh lan|ngrok|off [--dry-run]`: `lan` detects the host IP
  (`REMOTE_HOST_IP` overrides it), `ngrok` starts `ngrok start --all` if the
  agent is not up and reads the two public URLs from its local API
  (`tunnels` `web` → :3000 and `api` → :8000; without them it prints the YAML
  to add and exits 1), both write `.env.remote` from the example and run the
  layered Compose command; `off` returns to plain `.env`. Every mode ends with
  the URL to open and the cookie caveat. Idempotent; never touches `.env`;
  refuses to run without one.
- README: `-V` becomes the documented norm in "Run with Docker"; a new
  "Access from another device" section (LAN and ngrok, script and manual,
  the cookie/URL caveat, the ngrok free-plan caveats, how to go back).
- Tests: `scripts/tests/remote-env.sh`, run by `lint.yml` — the rendered
  Compose environment equals today's localhost values with only `.env`, equals
  the derived `WEB`/`API` values with the layer, and `INTERNAL_API_URL` is the
  same in both; `--dry-run` with `REMOTE_HOST_IP=10.0.0.5` prints the env it
  would write without touching Docker. A backend test that a comma-separated
  `CORS_ORIGINS` admits the second origin and still refuses an unlisted one.
  A local (not CI) Playwright run of the auth spec against
  `E2E_BASE_URL=http://<LAN-IP>:3000` on the e2e stack with the layer,
  recorded in the PR body.

Acceptance: `docker compose up --build` on a fresh clone with only
`.env.example` copied renders the same environment as before (the shell test
pins the three values); with the layer every browser-facing value follows
`WEB`/`API` and `INTERNAL_API_URL` does not; the shell test and the CORS test
are green in CI; the auth spec passes against the LAN IP.

**DECISION (loop, D19):** the frontend's `node_modules` stay in the anonymous
volume `docker-compose.yml` declares today, and `-V` (`--renew-anon-volumes`)
becomes the documented `up` flag, because that volume otherwise survives a
dependency change and the container keeps running the old packages. The
alternative — a named `frontend_node_modules` volume — was not taken: `-V`
does not renew named volumes, so a dependency change would then need an
explicit `docker volume rm` (or `down -v`, which also drops the database),
which is more to remember, not less; it stays available if the anonymous
volume ever needs to be shared between Compose projects.

**DECISION (loop, D19):** `.env.remote.example` derives its values with
Compose interpolation (`${WEB}`, `${API}`) inside the env file, which needs
Compose v2.24+ (several `--env-file` flags; in-file interpolation is older).
The alternative — every value written out in full — would be taken only if
the shell test showed CI's Compose not expanding them; it did not.

**DECISION (loop, D19):** the published ports stay `3000`/`8000`; `WEB`/`API`
carry the port, so a stack on other ports (the loop's 3100/8100 overlay) is
reached by writing them into `.env.remote`, and nothing in the layer remaps
`ports:`. Parameterising the port mappings too was the alternative and is not
needed for either flow.

**DECISION (loop, D19):** ngrok uses two tunnels (`web` → 3000, `api` → 8000)
because the browser talks to both services directly today. One tunnel is the
follow-up D20, not part of this change.

Found while running the ngrok mode for real (2026-10-06, ngrok 3.39, the
owner's free account, both tunnels already in its config): (1) both tunnels
came up on the account's single `<name>.ngrok-free.dev` domain — the agent
log shows the same `url=` for `web` and `api`, and ngrok pooled them, joining
requests to :3000 and :8000 at random; (2) a browser-shaped request to the
tunnel without the `ngrok-skip-browser-warning` header gets the
`ERR_NGROK_6024` interstitial as `text/html` with HTTP 200, and the browser's
cross-origin API calls carry no cookie, so clicking through on the `web` URL
does not help them. The script now refuses case (1) ("both tunnels came up
on the SAME URL", nothing written; the shell test covers it with a canned
agent API) and README states both. **DECISION (loop, D19):** the ngrok mode
stays as specified (it is correct on a plan with a second domain and no
interstitial) and is documented as needing that plan today; the free-plan
path is D20, which both findings point at — one origin means one domain and
same-origin API calls. The LAN mode is unaffected.

### D20 — One origin for the browser: a Next.js rewrite from `/api/backend/*` to `INTERNAL_API_URL`

**Priority: P2. State: IN PROGRESS (branch `feat/one-origin-api-proxy`;
owner assignment 2026-10-06, night).** With a `rewrites()` entry in
`frontend/next.config.js` proxying `/backend/:path*` to the backend's
internal origin, the browser reaches the API through the frontend's own
origin: remote access becomes one URL (one ngrok tunnel, one LAN address),
the API half of `.env.remote` disappears, and `NEXT_PUBLIC_API_URL` becomes a
relative path. D19's ngrok run showed this is also what the free ngrok plan
needs: one domain per account, and an interstitial that same-origin calls get
past after one click-through and cross-origin ones never do.

Plan (what changes, with today's behaviour kept wherever the assignment
leaves a choice):
- **Proxy.** `next.config.js` `rewrites()`: `/backend/:path*` →
  `<origin of INTERNAL_API_URL>/:path*` (`http://backend:8000` in Compose,
  `http://localhost:8000` natively; the `/api/v1` suffix stripped by
  `lib/backendProxy.js`, a CommonJS module like `lib/securityHeaders.js` so
  `next start` and Vitest can both load it). `/backend` collides with no app
  route and not with NextAuth's `/api/auth/*`; a Vitest test walks `app/` to
  assert it. Verified in `next dev` and `next start`, including multipart
  photo uploads and `/backend/media/**`.
- **Relative browser URLs.** `NEXT_PUBLIC_API_URL` defaults to
  `/backend/api/v1` (`lib/api.ts`, the Dockerfile build arg, Compose, the e2e
  overlay). Server-side code never inherits it: `lib/auth.ts` and
  `lib/landing.ts` resolve `INTERNAL_API_URL`, else an absolute
  `NEXT_PUBLIC_API_URL`, else `http://localhost:8000/api/v1`
  (`internalApiUrl()` in `lib/backendProxy.js`). `lib/securityHeaders.js`
  treats a relative API URL as same-origin (`connect-src 'self'`), so a
  production build no longer needs the variable; `app/layout.tsx` preconnects
  only to a foreign API origin. Backend-generated browser URLs stay absolute
  and point at the frontend origin: `MEDIA_BASE_URL` and
  `STRIPE_STUB_CHECKOUT_BASE_URL` are derived from `FRONTEND_URL` when unset
  (`<FRONTEND_URL>/backend/media`, `<FRONTEND_URL>/backend`); explicit values
  still win. The stub Checkout page's forms post to relative actions so they
  work at `/backend/checkout/stub/<id>` and at `/checkout/stub/<id>` alike.
  CORS keeps today's default — direct `:8000` access still works for tools.
- **Rate limiting behind the proxy.** All browser traffic reaches the API
  from the frontend container's address. The proxy appends the client to
  `X-Forwarded-For` (verified against an echo server for both `next dev` and
  `next start`); the limiter trusts that header only when the peer is a
  trusted proxy — new `RATE_LIMIT_TRUSTED_PROXIES` (hostnames resolved and
  cached, IPs or CIDRs; Compose sets `frontend`) — and then takes the entry
  the trusted proxy appended (the rightmost), so a client-supplied value on
  the left is ignored. `RATE_LIMIT_TRUST_FORWARDED_FOR` keeps its meaning and
  default (off; S12 still describes its first-entry behaviour). Tests: a
  spoofed header from an untrusted peer is ignored; a trusted peer's
  appended entry is the identity.
- **Single-URL remote access.** `.env.remote.example` shrinks to `WEB=…`
  with `NEXTAUTH_URL=${WEB}` and `FRONTEND_URL=${WEB}`; `scripts/remote-up.sh
  ngrok` needs only the `web` tunnel (found by its upstream port, the
  `domain:` in ngrok.yml making the URL stable), the shared-URL error path
  and the `api` tunnel go; `lan` and `off` unchanged. README updated, with
  the one-off instruction to reserve the free static domain.
- **Compose.** Ports 8000 and 5432 stay published for local tooling; the
  browser never needs 8000. Playwright keeps `E2E_API_URL` for API-level
  fixtures; the specs that watch the browser's own requests match the
  frontend origin. A new spec walks sign-up → booking → stub Checkout at
  `<origin>/backend/checkout/stub/…` → confirmed, photos from
  `<origin>/backend/media/…`, an operator photo upload through the proxy, and
  asserts the browser made no request to port 8000.

Acceptance: the Vitest, backend, shell and Playwright tests above green;
`docker compose up --build -V` on a fresh clone unchanged in use; a manual
`./scripts/remote-up.sh ngrok` on the free account with sign-in and a booking
from a phone on mobile data, recorded in the PR. What it touches, found while
doing D19: `lib/securityHeaders.js` and `app/layout.tsx` build `new URL(...)`
from `NEXT_PUBLIC_API_URL` (a relative value needs the site origin added);
`MEDIA_BASE_URL` and the stub Checkout page (`STRIPE_STUB_CHECKOUT_BASE_URL`,
a full-page navigation to the backend) need the same rewrite or their own;
`E2E_API_URL` and the e2e overlay's build arg follow; and the API's in-process
rate limiter would see every browser as the frontend container's address, so
`RATE_LIMIT_TRUST_FORWARDED_FOR` and Next's forwarded headers must be settled
first (the dev server adds `x-forwarded-for`; S12 governs which entry is
trusted). Acceptance: the e2e suite green with `NEXT_PUBLIC_API_URL=/api/backend`,
D19's shell test extended with the one-URL layer, the rate-limit tests still
proving per-client budgets.

## Reusable agent assignments

Use these when the user is ready to start a delivery assignment. They are
instructions to copy later, not a request to execute them during backlog editing.

### Existing-PR assignment

> Read repository guidance, roadmap.md and TODO.md. Deliver the assigned Gate 0
> task IDs, starting with Q00. Refresh GitHub evidence, fix the existing PRs in
> dependency order, validate the final revisions and prepare them for reviewed
> merge. Merge only within the user's explicit merge assignment. Reconcile Q23
> with this backlog; record commits/checks and complete Q90 when proven. Keep all
> C/R/O tasks on HOLD. Do not implement new roadmap features, deploy, or weaken
> tests to clear the queue. Surface any concrete product decision or unsafe PR
> limitation with a proposed bounded disposition.

### Roadmap assignment after Gate 0

> Gate 0 is verified; roadmap implementation is now resumed. Deliver TODO task
> <ID> and its stated acceptance criteria on an up-to-date feature worktree.
> Verify dependencies and existing merged code, resolve the task's explicit
> policy decisions before dependent implementation, and finish its API, UI,
> migrations, tests and runnable local documentation as one coherent change.
> Follow the delivery contract, record evidence in TODO.md, and prepare a PR.
> Keep later outcomes and deferred tasks on hold; do not deploy or merge unless
> separately included in this assignment.

## Archived tasks (index)

History lives in `docs/backlog-archive/<yyyy-mm>.md`, one file per month of completion, every block verbatim with its evidence (Q54). One line per archived task:

- **A01** — Operator booking management API — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a01-operator-booking-management-api)
- **A02** — Blocked time (`room_blocks`) — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a02-blocked-time-room_blocks)
- **A03** — Admin calendar (`/admin/calendar`) — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a03-admin-calendar-admincalendar)
- **A04** — Operator capability audit ("god mode") — DONE 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#a04-operator-capability-audit-god-mode)
- **A05** — Users: list, customer page, admin role, complimentary hours — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a05-users-list-customer-page-admin-role-complimentary-hours)
- **A06** — Package purchases: extend validity, see remaining hours — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a06-package-purchases-extend-validity-see-remaining-hours)
- **A07** — Room activate/deactivate with a future-bookings check — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#a07-room-activatedeactivate-with-a-future-bookings-check)
- **B14** — Pack purchase fails credential validation (reported as monthly booking) — DONE 2026-09-09 · [2026-09.md](docs/backlog-archive/2026-09.md#b14-pack-purchase-fails-credential-validation-reported-as-monthly-booking)
- **B15** — Signup ignores a failed automatic sign-in — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#b15-signup-ignores-a-failed-automatic-sign-in)
- **B16** — Test database health probe logs a missing database repeatedly — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#b16-test-database-health-probe-logs-a-missing-database-repeatedly)
- **B18** — Fresh-customer E2E exhausts the shared public request budget — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#b18-fresh-customer-e2e-exhausts-the-shared-public-request-budget)
- **B19** — Concurrent registration can surface uniqueness errors — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#b19-concurrent-registration-can-surface-uniqueness-errors)
- **B21** — Lint workflow has no path filter, so every branch inherits main's lint state — DONE 2026-09-15 · [2026-09.md](docs/backlog-archive/2026-09.md#b21-lint-workflow-has-no-path-filter-so-every-branch-inherits-mains-lint-state)
- **B22** — Admin refresh or deep link bounces operators to /dashboard — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b22-admin-refresh-or-deep-link-bounces-operators-to-dashboard)
- **B23** — Customers cannot see their door code — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b23-customers-cannot-see-their-door-code)
- **B24** — Past hours are offered as bookable — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b24-past-hours-are-offered-as-bookable)
- **B25** — Payment return is silent — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b25-payment-return-is-silent)
- **B26** — Closed days, loading and API failure all render as a blank grid — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b26-closed-days-loading-and-api-failure-all-render-as-a-blank-grid)
- **B27** — "Reservar Esta Sala" appears to do nothing — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b27-reservar-esta-sala-appears-to-do-nothing)
- **B28** — Booking modal sign-in link loses the customer's place — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b28-booking-modal-sign-in-link-loses-the-customers-place)
- **B29** — Pack bookings give no confirmation and show the wrong price — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b29-pack-bookings-give-no-confirmation-and-show-the-wrong-price)
- **B30** — Packs are undiscoverable — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b30-packs-are-undiscoverable)
- **B31** — Booking errors are all the same sentence — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b31-booking-errors-are-all-the-same-sentence)
- **B32** — Landing copy promises features that do not exist — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b32-landing-copy-promises-features-that-do-not-exist)
- **B33** — Small correctness and polish findings — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b33-small-correctness-and-polish-findings)
- **B34** — An hour of Lisbon inventory is invisible in the calendar (R01 slice) — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#b34-an-hour-of-lisbon-inventory-is-invisible-in-the-calendar-r01-slice)
- **C01** — Customer enrollment and first paid booking — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#c01-customer-enrollment-and-first-paid-booking)
- **C02** — Complete the package-holder journey — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#c02-complete-the-package-holder-journey)
- **C05** — Enforce booking validity at the API boundary — DONE (2026-09-10) — DONE 2026-09-10 · [2026-09.md](docs/backlog-archive/2026-09.md#c05-enforce-booking-validity-at-the-api-boundary-done-2026-09-10)
- **C06** — Show authoritative pricing and validity — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#c06-show-authoritative-pricing-and-validity)
- **C07** — Explain cancellation eligibility and failures — DONE 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#c07-explain-cancellation-eligibility-and-failures)
- **C09** — One public contact address, from a single source — DONE 2026-09-21 · [2026-09.md](docs/backlog-archive/2026-09.md#c09-one-public-contact-address-from-a-single-source)
- **C10** — Give a space a real location — DONE 2026-09-21 · [2026-09.md](docs/backlog-archive/2026-09.md#c10-give-a-space-a-real-location)
- **C11** — Hide the "space" layer while there is only one — DONE 2026-09-21 · [2026-09.md](docs/backlog-archive/2026-09.md#c11-hide-the-space-layer-while-there-is-only-one)
- **C12** — Hourly booking only, on a day or week view, with a contact note — DONE 2026-09-21 · [2026-09.md](docs/backlog-archive/2026-09.md#c12-hourly-booking-only-on-a-day-or-week-view-with-a-contact-note)
- **C13** — Pack hours first, pay only the extra hours (`mixed` payment) — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c13-pack-hours-first-pay-only-the-extra-hours-mixed-payment)
- **C14** — Image storage and upload behind a gateway — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c14-image-storage-and-upload-behind-a-gateway)
- **C15** — Admin: manage photos and every customer-visible room field — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c15-admin-manage-photos-and-every-customer-visible-room-field)
- **C16** — Customer photo carousel, and seeded placeholder photos — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c16-customer-photo-carousel-and-seeded-placeholder-photos)
- **C17** — Help / report a problem: support requests, dialog and email — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c17-help-report-a-problem-support-requests-dialog-and-email)
- **C18** — Cancellations and the contact note route to the help dialog — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c18-cancellations-and-the-contact-note-route-to-the-help-dialog)
- **C19** — Minimal operator inbox for support requests (`/admin/support`) — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#c19-minimal-operator-inbox-for-support-requests-adminsupport)
- **Deferred scope** — ARCHIVED 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#deferred-scope)
- **H01** — Booking window: customers book at most 30 days ahead — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#h01-booking-window-customers-book-at-most-30-days-ahead)
- **H02** — Hour bank: packs pooled, purchase history kept — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#h02-hour-bank-packs-pooled-purchase-history-kept)
- **H03** — Admin "Alterar horário" fails: two real causes, fixed — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#h03-admin-alterar-horário-fails-two-real-causes-fixed)
- **L02** — One hero message, no separate "O espaço" section (both sites) — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#l02-one-hero-message-no-separate-o-espaço-section-both-sites)
- **L03** — Static site looks like the app — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#l03-static-site-looks-like-the-app)
- **L04** — "Onde estamos" rework (both sites) — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#l04-onde-estamos-rework-both-sites)
- **Legacy IDs and verified baseline** — ARCHIVED 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#legacy-ids-and-verified-baseline)
- **M01** — Remove "Especialidade" from the static site's contact form — DONE 2026-09-24 · [2026-09.md](docs/backlog-archive/2026-09.md#m01-remove-especialidade-from-the-static-sites-contact-form)
- **M02** — Recurring booking card: at least 4 hours a week — DONE 2026-09-24 · [2026-09.md](docs/backlog-archive/2026-09.md#m02-recurring-booking-card-at-least-4-hours-a-week)
- **M03** — "Onde estamos": drop the venue name line — DONE 2026-09-24 · [2026-09.md](docs/backlog-archive/2026-09.md#m03-onde-estamos-drop-the-venue-name-line)
- **Q00** — Refresh evidence and choose the merge sequence — DONE 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#q00-refresh-evidence-and-choose-the-merge-sequence)
- **Q90** — Verify the combined result and close Gate 0 — DONE 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#q90-verify-the-combined-result-and-close-gate-0)
- **R02** — Make recurring reservations payable — DEFERRED 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#r02-make-recurring-reservations-payable)
- **R03** — Manage individual dates and future series — DEFERRED 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#r03-manage-individual-dates-and-future-series)
- **R99** — Outcome 2 acceptance — DEFERRED 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#r99-outcome-2-acceptance)
- **S01** — Authorization and tenant-isolation regression matrix — MERGED 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#s01-authorization-and-tenant-isolation-regression-matrix)
- **S02** — Authentication and token-handling regression tests — MERGED 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#s02-authentication-and-token-handling-regression-tests)
- **S05** — Payment, webhook and hold regression tests — MERGED 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#s05-payment-webhook-and-hold-regression-tests)
- **S09** — Request schemas are unbounded — DONE 2026-09 · [2026-09.md](docs/backlog-archive/2026-09.md#s09-request-schemas-are-unbounded)
- **S19** — Data-exposure regression tests — MERGED 2026-09-18 · [2026-09.md](docs/backlog-archive/2026-09.md#s19-data-exposure-regression-tests)
- **S27** — Regression tests for the contact form's Apps Script — MERGED 2026-09-17 · [2026-09.md](docs/backlog-archive/2026-09.md#s27-regression-tests-for-the-contact-forms-apps-script)
- **V01** — Room photo mosaic and gallery (app), seeded illustration photos — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v01-room-photo-mosaic-and-gallery-app-seeded-illustration-photos)
- **V02** — Static site: room cards with photo galleries and a manifest — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v02-static-site-room-cards-with-photo-galleries-and-a-manifest)
- **V03** — Room copy: photos instead of descriptions — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v03-room-copy-photos-instead-of-descriptions)
- **V04** — Remove the hero pill — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v04-remove-the-hero-pill)
- **V05** — Opening hours: 08:00–22:00 every day — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v05-opening-hours-08002200-every-day)
- **V06** — "Onde estamos" block (app): location, contact and hours — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v06-onde-estamos-block-app-location-contact-and-hours)
- **V07** — "Onde estamos" block (static site) — DONE 2026-09-23 · [2026-09.md](docs/backlog-archive/2026-09.md#v07-onde-estamos-block-static-site)
- **W01** — Static site copy (`flowspace-site/`) — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#w01-static-site-copy-flowspace-site)
- **W02** — App brand: EspaçoHora → FlowSpace — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#w02-app-brand-espaçohora-flowspace)
- **W03** — App landing copy — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#w03-app-landing-copy)
- **W04** — Seed and demo content — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#w04-seed-and-demo-content)
- **W05** — Formal register on every customer- and operator-facing surface — DONE 2026-09-22 · [2026-09.md](docs/backlog-archive/2026-09.md#w05-formal-register-on-every-customer-and-operator-facing-surface)
- **G01** — Audit log: `admin_actions` (O05, minimal and mandatory) — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g01-audit-log-admin_actions-o05-minimal-and-mandatory)
- **G02** — Deletion policy (recorded, then enforced) — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g02-deletion-policy-recorded-then-enforced)
- **G03** — Password reset: customer self-service and admin trigger — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g03-password-reset-customer-self-service-and-admin-trigger)
- **G04** — Missing admin endpoints (tenant-scoped, audited, tested) — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g04-missing-admin-endpoints-tenant-scoped-audited-tested)
- **G05** — Shared admin CRUD kit (`frontend/components/admin/crud/`) — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g05-shared-admin-crud-kit-frontendcomponentsadmincrud)
- **G06** — Entity pages (migrate and complete; routes stable) — DONE 2026-10-05 · [2026-10.md](docs/backlog-archive/2026-10.md#g06-entity-pages-migrate-and-complete-routes-stable)
- **O05** — Tenant-scoped audit history — minimal scope DONE 2026-10-05 (residual scope QUEUED above, under Outcome 3) · [2026-10.md](docs/backlog-archive/2026-10.md#o05-tenant-scoped-audit-history)
