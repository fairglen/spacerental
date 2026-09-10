# TODO — Delivery backlog

Updated 2026-09-10. Product priorities come from [roadmap.md](roadmap.md).
This replaces the previous epic-first queue; the legacy mapping at the end
preserves its history and outstanding requirements.

## Execution boundary and task states

**Current assignment (2026-09-10): roadmap delivery resumed by the user.**
Gate 0 is DONE: #23 merged as `49433c3`; origin/main and the empty open PR/issue
queues were verified on 2026-09-10. Start C01, then C02–C08 in dependency order.
Later outcomes remain HOLD until their entry gates pass.

New work must be recorded before implementation: give it an ID, reproduction or
scope, priority, dependencies, and acceptance/validation. Prioritize P0 for an
immediate critical blocker, P1 for the current customer outcome, P2 for subsequent
outcomes, and P3 for deferred improvements. An unrelated discovery enters the
queue; it does not silently expand the active task. Link already-known gaps to
their existing item instead of duplicating them.

Current queue: C01 (P1, IN PROGRESS), C02–C08/C99 (P1, QUEUED in order),
R/O tasks (P2, HOLD), D tasks (P3, DEFERRED). C04 dependency advisories, C05
booking validity, and C08 diagnostics are known work, retained at their agreed
positions. Reassess priority if new evidence establishes an immediate blocker.

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

# Full backend suite, isolated PostgreSQL 16:
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

**State: DONE — #23 merged as `49433c3` on 2026-09-09.**
Initial snapshot: main `bc3112b`, 12 open PRs checked on 2026-09-09.
Green below means reported checks passed, not approval or proof of completeness.
The recorded failure diagnoses came from the September 9 assessment; re-read
current logs and review threads before applying a fix.

### Review and merge pass — 2026-09-09

Reviewed current PR heads, diffs, review threads and CI. The user authorized
merging PRs without critical remaining issues; necessary fixes were implemented in feature worktrees and verified before merge.
Broader roadmap implementation remains on hold.

| Task | Current disposition | Evidence / remaining work |
|---|---|---|
| Q19 | DONE — merged #19 as `1ec3ec0828c03c30d03c5a5ec93294b0d84378b4` | All reported PR checks passed; entrypoint unittest rerun locally passed (success, duplicate-object/table and unrelated failure cases). The diagnostic detects duplicate-object errors; its README wording is corrected in Q23 without claiming it proves the database is unversioned. |
| Q22 | DONE — merged #22 as `3241e56e792fbcb66e1e39377d6462ee1406c038` | Backend, frontend, E2E, lint and migration checks passed on PR and resulting main. Reviewed debit/refund locks and deterministic concurrent status-transition coverage. C02 retains fresh-customer E2E and distinguishing slot-conflict from insufficient-hours errors. |
| Q31 | DONE — merged #31 as `3bf7fa378e65fb505dca7884a39d64747ccbd82c` | Reran failed infrastructure job in Actions run `34383929172`; E2E passed, as did other reported PR checks. Reviewed compatibility with #22's hourly-payment helper. |
| Q20 | DONE — merged #20 as `c4a8838` | Stable (start_time, id) pagination with tied-start integration coverage and accessible status actions; 152 backend, 82 frontend and 17 browser tests plus green CI. |
| Q23 | DONE on merge of [#23](https://github.com/fairglen/spacerental/pull/23) | Delivers the agreed roadmap, executable task refactor, historical mapping and corrected README/architecture status. Verified exact outcome order, links, holds and unchanged parsed Compose configuration. |
| Q24 | DONE — merged #24 as `02c80d4` | Explicit Ruff 0.16.5 cleanup preserves integrated routes/transitions, includes migrations in lint and removes the inherited auth-secret fallback. Final CI passed: 223 backend, 120 frontend, 20 opt-in browser tests, production build, lint and migration roundtrip. |
| Q25 | DONE — merged #25 as `2b6e864` | Real NextAuth credentials setup, fail-fast readiness and uploaded diagnostics; 74 frontend tests, 17 browser flows and 20 repeated admin checks plus green CI. |
| Q26 | DONE — merged #26 as `5018e87` | 193 backend tests, migration roundtrip, 93 frontend tests and 17 browser flows plus green CI. One Alembic head; shared cancellation policy, row locks and rollback-safe notifications. Explicit opt-in pending UTC foundation; R01–R03 remain HOLD. |
| Q27 | DONE — merged #27 as `3c687d6` | 111 frontend tests, TypeScript and 19 browser flows plus green CI. Single switch gates API/UI, explicit pending acknowledgement, preview/conflict and isolated cancellation coverage. Paid series and local-time scheduling remain HOLD. |
| Q28 | DONE — merged #28 as `e20998a` | 215 backend, 111 frontend, 19 browser tests and migration CI passed. Includes pack/stub checkout issuance, individual/series/admin cancellation, failed-revoke retention and rollback-safe edits. Live startup is gated until O04. |
| Q29 | DONE — merged #29 as `42466e8` | Typed catalog traversal and literal repeated interpolation, behavior-focused tests; 93 frontend tests, TypeScript, 17 browser flows and green CI. |
| Q30 | DONE — merged #30 as `ed571e5` | Locale snapshot hydration regression and persistence flow verified; 98 frontend tests, TypeScript, 18 browser flows and green CI. |

All 12 code PRs in this delivery pass are merged (11 from the original queue
plus B14/#32). The remaining documentation PR is Q23; its merge completes the
13-PR delivery and closes Q90. B14 is merged in #32.
A merged foundation is not completion of
its roadmap outcome. The original per-PR scopes below remain the acceptance
reference; the disposition table above takes precedence over their dated snapshot.

Verified code main is `02c80d4` after #24, with the same application source as
tested PR head `cf7a602`. This PR changes only documentation and a Compose
comment; final integrated evidence is recorded under Q90 below.

### Q00 — Refresh evidence and choose the merge sequence

**State: DONE.** Merge sequence, fixes and evidence are recorded above.
GitHub reported main as unprotected on 2026-09-09; frontend and migration
checks have path filters, so their absence on documentation-only PRs is expected.
Every applicable check is still required by this delivery contract.

**Depends on:** assignment to work on the existing PRs.
**Scope:** GitHub PR heads/bases, reviews, CI logs, changed files, migration graph.

- Reconfirm every PR below, main HEAD, unresolved review findings, and the checks
  actually required for its files. Distinguish test failures from setup failures.
- Suggested sequence: repair shared CI/setup blockers first; review #19/#20;
  integrate #22; handle #26 before #27; handle #28 after booking changes; handle
  #29 before #30; land #31 on the resulting booking behavior; reconcile #23 last.
  Apply #24's mechanical cleanup with care around the functional backend PRs.
- Retarget/rebase stacked children after their parent lands and revalidate them.
  Reassess conflicts after every merge; GitHub's current mergeable flag does not
  establish that independent booking/payment side effects compose correctly.
- Record any unavoidable product decision or unsafe incomplete exposure. Resolve
  it with a bounded PR fix or an explicit disposition; never merge red or unsafe
  code just to clear the queue. A deliberate deferral must be recorded and agreed
  before it can count toward closing Gate 0.

**Done when:** the per-PR execution order, blockers, and current evidence are
recorded without claiming any pending PR is already shipped.

### Per-PR tasks

The table below preserves the historical intake snapshot and accepted scope.
Current states are in the disposition table above; all tasks inherit the delivery
contract and depend on Q00.
Each completion requires resolved relevant review findings, appropriate local
checks and CI on the final revision, and a recorded main merge commit (or an
explicitly agreed disposition). No automatic merging is requested by this file.

| ID / existing PR | Snapshot and bounded assignment | Specific acceptance / dependency |
|---|---|---|
| Q19 / [#19](https://github.com/fairglen/spacerental/pull/19) | Green. Review migration failure diagnostics and preservation of failure exit status. | Fresh schema starts; stale/unversioned and drifted schemas fail with accurate guidance; no automatic stamp/drop and no casual deletion advice for retained data. |
| Q20 / [#20](https://github.com/fairglen/spacerental/pull/20) | Green. Review paginated admin bookings, metadata extraction, and org-switch behavior. | Paging returns scoped totals and deterministic results; switching org resets the page/cache; recent-bookings widget and actions still work. |
| Q22 / [#22](https://github.com/fairglen/spacerental/pull/22) | Green. Review package debit/refund locking, admin transitions, and accounting. | Real-PG concurrent redemption/cancellation cannot double-spend or double-refund; hourly checkout still works. Preserve meaningful race tests. Fresh-customer E2E completion remains C02. |
| Q24 / [#24](https://github.com/fairglen/spacerental/pull/24) | Red. Current logs identify undefined `checkout_stub`, preventing backend startup, plus lint failures. | Repair imports and all current findings; align configured Ruff rules and pins; startup, backend tests, and E2E pass without removing functionality during cleanup. |
| Q25 / [#25](https://github.com/fairglen/spacerental/pull/25) | Red. Shared login setup still times out in CI. | Diagnose from trace, server responses, and logs; full-suite login setup succeeds on a fresh stack and targeted repeated runs. Keep real auth-rate-limit coverage; do not hide the failure with longer timeouts alone. |
| Q26 / [#26](https://github.com/fairglen/spacerental/pull/26) | Green foundation. Review atomic series creation/edit/cancel and migration integrity. | Conflict leaves no partial series; concurrency and migration round trip pass. Record UTC/DST and unpaid-series limitations against R01/R02. Do not claim a paid recurring journey or expose it as completed functionality. |
| Q27 / [#27](https://github.com/fairglen/spacerental/pull/27) | Green; stacked on #26. Review preview, conflict display, and interaction with #22. | Q26 first. Reconcile modal/API contracts after retargeting; preview and conflict behavior pass. Explicitly settle visibility of a series flow without payment; R02/R03 remain HOLD. |
| Q28 / [#28](https://github.com/fairglen/spacerental/pull/28) | Green foundation; memory-only codes and pop-before-revoke failure behavior. | Repair failed-revoke bookkeeping; inspect all confirmation/cancellation paths after Q22/Q26/Q27, including stub checkout. Preserve cancellation semantics and document limitations. Do not enable live use with lost-on-restart identifiers; durability/customer access remain O04. |
| Q29 / [#29](https://github.com/fairglen/spacerental/pull/29) | Red: missing `beforeEach` import. Review also flags interpolation and typing. | Fix the parent itself even though #30 has an import fix; handle repeated placeholders; remove unjustified `any`; preserve PT behavior and avoid tests pinning marketing copy. |
| Q30 / [#30](https://github.com/fairglen/spacerental/pull/30) | Stacked on #29. E2E failed before tests during browser dependency install (APT hash mismatch). | Q29 first; rerun after setup recovery, investigate if persistent; verify locale persistence, rerendering and initial render. Keep scope to existing marketing/layout translations. |
| Q31 / [#31](https://github.com/fairglen/spacerental/pull/31) | E2E failed during the same dependency-install problem, before tests ran. | Recover setup and run real single-click and stale-modal conflict tests on integrated booking behavior; do not mistake infrastructure failure for a booking regression. |
| Q23 / [#23](https://github.com/fairglen/spacerental/pull/23) | Green docs PR, overlaps this backlog rewrite. | Reconcile last, preserving this outcome order, hold, task IDs, and legacy mapping. Salvage useful history without overwriting the new plan or calling open PRs shipped; record merge or agreed supersession. |

### B14 — Pack purchase fails credential validation (reported as monthly booking)

**State: DONE — [PR #32](https://github.com/fairglen/spacerental/pull/32), merged as `c8b4913`.** Reported by the user on
2026-09-09 and repaired under Gate 0. The reproduction, scope and acceptance
below preserve the investigation contract; this repair has no dependency on
future customer enrollment or recurring-booking implementation.

**Reported request:**

```text
POST http://localhost:8000/api/v1/packages/c7ebe549-9bd8-4a02-b5ba-8451ba46617b/purchase
```

```json
{"detail":"Could not validate credentials"}
```

The user describes monthly booking as not working and reports this failure
while buying a pack. The supplied endpoint purchases prepaid hours; it is not
the recurrence endpoint. Preserve that distinction while reproducing the
customer's exact journey. The package UUID is local reproduction evidence,
not a value to hardcode into the fix or tests. An expired, correctly signed backend JWT inside an active NextAuth session reproduces the same 401. The original pre-restart session is unavailable, so its exact invalidation cause cannot be established.

**Scope:** `PackageBuyButton.tsx`, `frontend/lib/api.ts`, NextAuth callbacks in
`frontend/lib/auth.ts` (shared by the route and dashboard layout), sign-in/return navigation and package
dashboard, `backend/app/auth.py`, and package/auth tests. Keep API calls in the
existing wrapper and preserve the backend's authentication and membership checks.

**Code evidence and diagnosis plan:**

- `get_current_user` returns this message with 401 for a JWT validation failure,
  missing subject, or a user no longer present in the database. A missing token
  has a different message; a valid user without org membership receives 403.
  Do not conflate this failure with C01's enrollment gap or Stripe checkout.
- The purchase button sends `session.accessToken`. The backend token has an
  explicit expiry (default 24 hours); current NextAuth callbacks retain that
  token without expiry handling/renewal. A browser session that still appears
  signed in can therefore carry an unusable API token. This failure mode is reproduced in the B14 regression; the exact cause of the original pre-restart session remains unknown.
- Reproduce both from the landing pricing card and `/dashboard/packages`.
  Record HTTP status, running commit/configuration identity, presence of the
  Bearer header, and whether the same session fails `GET /auth/memberships`. Inspect
  expiry/subject/signing-backend consistency without logging tokens or secrets.
  Check whether a DB reset or signing-key change invalidated an existing session.
- Compare with a fresh sign-in to isolate stale-session handling from a broken
  fresh-login path. Re-authentication alone is a diagnostic workaround, not the
  completed fix. Do not ask the user to share tokens, cookies, or passwords.

**Acceptance:**

- With a valid account, location membership and fresh API token, buying an
  active pack returns 201 with the wrapped purchase and usable checkout URL;
  completing local stub checkout activates the pack with the expected hours.
- If the browser looks signed in but its API token is expired/invalid or refers
  to a deleted user, show a Portuguese session-expired/sign-in message and a
  recovery path. Missing/loading tokens cannot trigger an unauthenticated
  purchase. Use explicit re-authentication or a deliberately implemented renewal
  contract; do not silently extend expired tokens or weaken validation.
- Recovery preserves the selected package and returns the user to its purchase
  flow after successful sign-in. Avoid redirect loops, stale user data and
  duplicate purchases; do not blindly replay a purchase POST after an uncertain
  network result. Failed sign-in stays on the sign-in page with an explanation.
- 401, membership 403, missing-package 404 and checkout-provider failure remain
  distinct. An unauthorized attempt creates no purchase or checkout session.
- Walk the reported monthly/pack journey after the repair. If a separate monthly
  scheduling problem remains, record its exact screen, action, endpoint and
  expectation as a separate issue; do not claim this purchase fix solves monthly
  recurrence or silently add a monthly product under B14.

**Validation:** real-PG package-route tests for valid, expired, invalid, missing
and deleted-user credentials plus wrong-org membership; assert rejected attempts
have no purchase/provider side effects. Component tests for loading/missing
tokens, 401 messaging and preserving the selected package. E2E with an explicitly
expired API token inside an otherwise active browser session → sign-in recovery
→ selected pack → local checkout → active hours, plus a fresh-session happy
path. Use controlled token timestamps rather than waiting 24 hours. Run the
required suites and record reproduction/fix evidence before marking DONE.

B14 validation on `6ec0725`: 223 backend tests, 116 frontend tests, TypeScript,
production build and 20 browser flows passed. The regression verifies a genuine
expired backend token inside an active NextAuth session, rejected purchase with
no side effects, preserved selection, sign-in and exactly one activated purchase.
Backend, frontend/build, E2E, lint and migration CI all passed before merge.
A second local browser run also verified expired-session recovery starting from
`/dashboard/packages`. Shared auth configuration
moved to `frontend/lib/auth.ts` to fix Next.js route-export validation; the
frontend workflow now also builds production output. The final review identified
an inherited hardcoded secret fallback; Q24 removes it and tests missing/blank
configuration. Recovery clears authenticated caches because re-login may select
a different account; no purchase POST is automatically replayed.

### Q90 — Verify the combined result and close Gate 0

**State: DONE — #23 merged as `49433c3`.** Integrated code verification remains
recorded below. Gate completion verified again on 2026-09-10.

Final evidence from the integrated code revision `cf7a602` (merged unchanged as
`02c80d4`):

- 223 real-PostgreSQL backend tests passed locally and in final
  [backend CI](https://github.com/fairglen/spacerental/actions/runs/34413078990).
- 120 frontend tests, TypeScript and production build passed locally and in
  [frontend CI](https://github.com/fairglen/spacerental/actions/runs/34413078940).
- All 20 browser tests passed locally with recurrence disabled and in final
  [E2E CI](https://github.com/fairglen/spacerental/actions/runs/34413078919) with
  recurrence enabled. The opt-in suite covers pending-series preview, isolated
  cancellation and conflict; the default run verifies the control is hidden.
  Hourly/pack checkout, expired-session recovery, access codes, cancellation,
  admin browsing and locale persistence pass together.
- A separate empty PostgreSQL database passed upgrade → check → downgrade →
  upgrade → check, with no application tables or enums left after downgrade.
  [Final migration CI](https://github.com/fairglen/spacerental/actions/runs/34413078772)
  also passed. Ruff 0.16.5 passes across the full backend, including migrations.
- Documentation links, complete/unique task IDs, dependencies, acceptance,
  exact outcome order and all three HOLD boundaries were checked. Parsed Compose
  configuration is unchanged by the documentation comment. Q23's applicable
  lint/E2E checks must pass before its merge; frontend/backend/migration workflow
  path filters intentionally exclude this documentation-only change.

Remaining limitations are assigned to C/R/O/D tasks below: fresh-customer
membership, payment/hold recovery, dependency updates, paid Lisbon-time series,
and durable email/refund/access operation. Recurrence stays disabled by default;
live smart-lock startup remains gated. None of these outcomes is marked complete.

**Depends on:** disposition of Q19–Q31 above, including Q23, and B14 resolved;
no unresolved unsafe
interaction between merged PRs. **Scope:** integrated main, tests, docs.

- Verify single hourly checkout, package redemption, cancellation, org switching,
  and any enabled recurring/lock paths together. Specifically check that package
  confirmation issues access when enabled and bulk series cancellation does not
  skip accounting, email, or lock behavior already enabled on that branch.
- Verify B14's fresh-session purchase and expired-session recovery flow with the
  selected package preserved; a demo-admin purchase alone does not cover it.
- Confirm one valid Alembic history containing every merged schema change. A
  migration-number collision is work to reconcile, not a reason to omit schema.
- Run full backend, Vitest, TypeScript, E2E, and applicable migration checks on
  the integrated revision. Investigate missing checks rather than calling them
  passing. Record final PR dispositions, commit IDs, and known gated limitations.
- Reconcile README and architecture status claims with main, and update the
  historical mapping below. Keep future tasks on HOLD.

**Done when:** the existing queue is merged or explicitly disposed of, integrated
main is verified, and remaining work is accurately assigned below. Ask for the
next roadmap assignment only after presenting this concrete result; completing
Gate 0 alone does not start new feature implementation.

## Outcome 1 — First customer can reliably pay and book

**State: ACTIVE.** Q90 is complete; roadmap implementation resumed 2026-09-10.
Start C01, then C02. Continue in the listed order unless the user's next
assignment explicitly reprioritizes a task. Dependencies below are additional
to that shared entry gate.

### C01 — Customer enrollment and first paid booking

**Priority: P1. State: IN PROGRESS.** Branch: `feat/customer-enrollment`,
worktree `/private/tmp/spacerental-customer-enrollment`;
[PR #33](https://github.com/fairglen/spacerental/pull/33), implementation `94c10bd`.
Implementation and local validation complete; remains IN PROGRESS until reviewed
and merged. Evidence (2026-09-10):

- 231 backend tests on isolated PostgreSQL 16 (`spacerental-c01-tests`), including
  explicit registration roles, missing/closed targets, tenant denial, legacy
  membership preservation, and concurrent enrollment idempotency.
- 126 frontend tests, TypeScript, Ruff 0.16.5 across the backend, and production
  build passed. Build uses the existing Google Font download.
- All 20 Playwright tests passed together on isolated app ports 3300/8300 with
  the default real rate limits and recurrence disabled. New-customer signup →
  two-hour selection → local payment → confirmed dashboard and selected pack →
  signup → pending purchase → payment → active 10h balance both pass.
- Fresh stack applied the existing Alembic chain; no model change/migration.
  README operator creation and authenticated legacy enrollment commands passed
  against the isolated app; no existing privileges were removed.
- B15 signup recovery and B18 browser fixture fixes are included. B16/B17/B19
  remain queued; C02 starts after C01's merge. Main checkout and its app retained.

**Enrollment policy (2026-09-10):** customer registration enrolls only in
`CUSTOMER_ENROLLMENT_ORG_SLUG`, configured as `demo-space` for the seeded local
stack. No first-org lookup or caller-selected tenant. A global explicit
`CUSTOMER_ENROLLMENT_ENABLED` switch closes enrollment; missing/unknown targets
fail clearly without creating an account. Member is the only assigned role.
Operator registration has a separate explicit endpoint and creates its own org.
Existing users may explicitly enroll using an authenticated endpoint; repeated
requests preserve existing privileges and memberships. No automatic conversion,
removal, or migration of legacy organizations. Alternatives (automatic enrollment
on login, arbitrary public tenant selection) would change existing access or
require a multi-location product policy and are outside C01.

**Depends on:** Q90. **Scope:** `backend/app/routers/auth.py`, organization
membership, registration UI, auth tests, and `frontend/tests/e2e/`.

Separate customer signup from operator creation. Define an explicit configured
location/enrollment policy; do not select an arbitrary first organization or
silently grant membership across tenants. Preserve an intentional operator
creation path without turning every customer into an owner.

**Acceptance:** a fresh user enrolls as a member of the intended location, can
book and buy its packages, cannot use admin endpoints, and gains no unrelated
org access. Existing accounts/memberships retain their privileges. The browser
journey signup → browse → multi-hour selection → real local stub checkout →
confirmed dashboard booking requires no manual SQL or demo-admin credentials.
Unknown/closed enrollment targets fail clearly. Document any migration or
explicit enrollment path for existing customers stranded in empty organizations.

**Validation:** real-route register/login/membership tests including denial and
existing-user cases; fresh-customer E2E with a unique user and booking dates.

### B15 — Signup ignores a failed automatic sign-in

**Priority: P1. State: IN PROGRESS with C01 (implemented and validated, awaiting merge).** Discovered 2026-09-10 in
`sign-up/[[...sign-up]]/page.tsx`: the result of `signIn(..., redirect: false)`
is ignored, so a created account can be sent to a protected page with no session.
Fix within C01 because signup → booking depends on it. Preserve the selected
package, explain that the account exists, and offer sign-in recovery without
repeating registration. Validate failed/throwing sign-in component behavior.

### B16 — Test database health probe logs a missing database repeatedly

**Priority: P2. State: QUEUED; group with C08 diagnostics.** Observed during C01
backend validation on 2026-09-10. `docker-compose.test.yml` runs `pg_isready -U
spacerental` while the test database is `spacerental_test`; PostgreSQL logs
`FATAL: database "spacerental" does not exist` every three seconds even though
the suite connects correctly and proceeds. Set the explicit test database in
the probe; verify healthy startup and the absence of these messages without
weakening readiness detection. It does not block C01.

### B17 — Dialog descriptions and noisy component test diagnostics

**Priority: P2. State: QUEUED after C99.** C01's frontend suite passes but reports
missing accessible descriptions in booking/admin dialogs, an unwrapped React
update in the org-switch test, and unsupported jsdom navigation in a package
recovery test. Fix dialog descriptions with accessible behavior coverage and
make the test interactions await the intended events; do not silence warnings
or remove assertions. Validate affected components with clean diagnostics.

### B18 — Fresh-customer E2E exhausts the shared public request budget

**Priority: P1. State: IN PROGRESS with C01 (validated in the full 20-test browser run).** First C01 browser run on
2026-09-10 adds up to 33 day-navigation requests before the existing booking
suite. Backend logs show 429s on availability and public space reads, causing
later calendar/package tests to fail. Use dedicated nearer future inventory and bounded probing. The second run
still reaches 429 late in the package suite, so pace the added full customer
journey with one public-rate window at the auth-suite boundary. C02 CI confirmed
the late visitor failure was a public 429, and its redemption check also picked
Sunday inventory. The test now waits for the real window and chooses the next
non-Sunday day. The cooldown test has an explicit timeout so the wait is outside
the normal 30-second assertion budget. All browser/API clients share one host
peer address in Compose.
Preserve the real public/auth limits and keep this cooldown outside assertions;
do not retry failed journeys or change application throttling to make tests pass.
Validation: full browser suite with the default limits, including existing
booking/package flows and the new customer journeys.

### B19 — Concurrent registration can surface uniqueness errors

**Priority: P2. State: QUEUED after C99; reproduction pending.** C01 review found
existing check-then-insert patterns for user email and generated operator slugs
in `auth.py`, without `IntegrityError` translation. Two simultaneous requests
may both pass the preliminary lookup and make one fail with a server error.
Reproduce with real PostgreSQL before implementing. Acceptance: duplicate email
has a clear client response, distinct operator accounts with equal names get
unique slugs, and failure creates no partial account/org/membership. Preserve
normal duplicate-email and shared rate-limit behavior.

### C02 — Complete the package-holder journey

**Priority: P1. State: IN PROGRESS.** Branch: `feat/package-holder-journey`.
The merged backend already provides atomic purchase activation, package debit,
and exact-once cancellation credit. This delivery closes the remaining UI/API
error distinction and adds a fresh-customer purchase → redemption → cancellation
browser journey. C02 remains open until its PR is merged and integrated checks
are recorded.

**Evidence so far (2026-09-10):** 19 BookingModal component tests pass,
including a package booking conflict that now displays the slot conflict rather
than an insufficient-hours message; TypeScript and Ruff pass. The existing
real-PG package redemption/concurrency suite remains green from C01 (the full
backend suite passed 231 tests). Full frontend and browser validation is pending
on the C02 branch. The package E2E now also covers a fresh signed-out customer
buying the seeded pack, redeeming two hours for a booking, and cancelling to
restore the full balance. Full frontend validation is 127 tests; the targeted
browser journey is pending against the C02 image.

**Depends on:** C01 and Q22 merged (otherwise revive its accepted scope first).
**Scope:** package/booking routes, `package_hours.py` if merged, booking modal,
package dashboard, API wrappers, isolated E2E fixtures.

**Acceptance:** a new customer buys a package through local checkout, sees it
activate only after payment, redeems the correct hours without hourly checkout,
and sees the remaining balance. Cancellation restores hours exactly once.
Pending, expired, wrong-org, and insufficient balances cannot fund a booking.
Choosing hourly payment remains possible when a package exists. Concurrent
requests cannot overdraw a balance. Preserve the existing policy for selecting
eligible packages and document it; do not rebuild already-merged #22 logic.
Distinguish a stale-calendar 409 from an insufficient-hours 409 on the package
path; the merged modal currently labels both as insufficient hours.

**Validation:** extend real-PG accounting/race tests only for uncovered cases;
add buy → redeem → cancel E2E with its own customer/package balance, without
sharing `admin@demo.com` state. Verify API shapes and modal behavior if changed.

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

### C05 — Enforce booking validity at the API boundary

**Depends on:** C04. **Scope:** booking schema/route, shared availability logic,
admin status transitions that acquire a slot, booking/space integration tests.

**Acceptance:** overlapping two existing bookings returns 409, never a
multiple-results server error. Reject past starts, missing/invalid timezone
information, non-positive intervals, closed hours, gaps between availability
windows, and inactive rooms/spaces. Define supported slot alignment/duration
from the current product and enforce it consistently in calendar and backend.
The API cannot bypass rules enforced by the UI; concurrent claims still rely on
the real exclusion constraint. Reinstate/confirm paths cannot create overlaps.
Document current timezone semantics; R01 supplies the Lisbon-time migration.

**Validation:** integration boundary and wrong-org cases, including a range
covering multiple conflicts and lunch closure; concurrent constraint coverage;
calendar/modal interaction tests where behavior changes.

### C06 — Show authoritative pricing and validity

**Depends on:** C05. **Scope:** `Pricing.tsx`, package/room API data, purchase CTA
and pricing component tests. **Size:** small follow-up.

**Acceptance:** advertised price, hours, validity and computed savings agree with
the selected location's current packages and rates. Editing them in admin changes
what customers see and pay. Removed/unavailable packages cannot be purchased
through stale marketing cards. Loading and API errors are distinct from no stock;
format money consistently and avoid unsupported benefit claims.

**Validation:** component tests vary price/validity and simulate failure; exercise
admin update → public price → checkout amount in the local flow.

### C07 — Explain cancellation eligibility and failures

**Depends on:** C06. **Scope:** dashboard, booking cancellation responses, shared
error/date handling and component tests. **Size:** small follow-up.

**Acceptance:** show the existing 24-hour cancellation rule and explain why an
action is unavailable. A server rejection or network error leaves an accurate
booking state and an actionable Portuguese message; a successful cancellation
updates bookings and package balances. Explicitly resolve/test the exact
24-hour boundary. Do not promise or imply a cash refund before O02 implements it.

**Validation:** before/at/after-boundary tests, denied/failed/successful UI
interactions, and cancellation E2E. Backend remains authoritative if time or
status changes after rendering.

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

**Validation:** verify artifacts on a controlled failing local/CI exercise when
assigned, auth failure tests, full E2E on a fresh stack, and a walkthrough of the
README commands. Do not disable tests or globally weaken throttling for a pass.

### C99 — Outcome 1 acceptance

**Depends on:** C01–C08. **Scope:** integrated validation and evidence only.

**Acceptance:** the outcome-1 criteria in `roadmap.md` all pass on one integrated
revision: fresh enrollment, hourly payment, package purchase/redemption, conflict
handling, abandoned checkout recovery, accurate pricing and cancellation feedback.
Record exact commands, results and commit. Full required suites and production
build pass without third-party credentials. No later outcome starts while this
outcome remains incomplete unless the user explicitly changes priorities.

## Outcome 2 — Regular customers can manage their schedule

**All tasks: HOLD.** Entry gate: C99 complete and assigned roadmap work.
Merged #26/#27 are gated foundations; do not reimplement their accepted behavior.

### R01 — Preserve Lisbon wall time for availability and recurrence

**Depends on:** C99; disposition of Q26/Q27. **Scope:** room/space timezone
metadata, migration, availability and recurrence expansion, frontend preview.

**Acceptance:** establish an explicit location timezone (Europe/Lisbon for the
pilot), keep stored instants UTC, and preserve a weekly 09:00 appointment through
both DST transitions. Preview and backend expansion agree, including end-date
boundaries and duration. Define ambiguous/nonexistent local-time behavior and a
safe migration strategy for existing opening hours/series; do not silently move
paid appointments. Preserve the existing occurrence cap and reject invalid ranges.

**Validation:** unit expansion tests around both transitions and ambiguous/gap
cases; real-PG API/migration tests; browser preview matches stored dates.

### R02 — Make recurring reservations payable

**Depends on:** R01 and C02/C03. **Scope:** recurrence routes/schema, payment/order
representation and migrations, gateways, webhooks, modal and API wrappers.

**Decision first:** settle whole-series versus per-occurrence charging, package
allocation, insufficient balance, hold expiry, and partial payment/failure. Record
an explicit state model and compensation policy before changing the payment
schema; the current unique session-per-booking column cannot simply be reused
for a single session confirming many rows.

**Acceptance:** customer previews dates and total, pays hourly or uses eligible
package hours, and receives exactly the intended confirmed series. A date conflict
returns the conflicting dates with no partial series/debit. Retries and webhooks
are idempotent; abandonment releases the intended holds; late payments follow C03.
No enabled customer series flow ends as indefinitely pending with no payment path.

**Validation:** integration/real-PG race tests for series-vs-series,
series-vs-single and shared balances; API extraction and modal tests; full local
series preview → pay/redeem → dashboard E2E.

### R03 — Manage individual dates and future series

**Depends on:** R02. **Scope:** recurrence edit/cancel endpoints, dashboard series
controls, accounting and notification integration, tests.

**Decision first:** document price differences, paid-date cancellation handling,
and rules for moving paid future occurrences. Reuse C03's payment recovery and
existing package restoration; represent unresolved cash obligations explicitly
until O02, without telling the customer a refund was issued when it was not.

**Acceptance:** identify series on the dashboard; cancel one occurrence without
cancelling siblings; cancel from a selected date; edit only not-yet-started
occurrences. Preserve past/completed records. A conflicting edit changes no dates,
charges or balances. Respect cancellation eligibility; bulk actions cannot bypass
it. Wrong-user/org requests fail. Balances and notifications follow exactly the
changed occurrences, with hooks covering already-enabled lock behavior.

**Validation:** API happy/failure and concurrent edit/cancel cases, scoped access,
component controls, and E2E proving unaffected siblings/history survive.

### R99 — Outcome 2 acceptance

**Depends on:** R01–R03. **Scope:** integrated customer flow and regression checks.

**Acceptance:** `roadmap.md` outcome-2 criteria pass together: preview, paid series,
conflict atomicity, stable local times, editing, individual/future cancellation,
and accurate accounting/notifications. Run required suites and migration checks,
record integrated commit and exact stub-mode reproduction steps.

## Outcome 3 — The location can operate reliably

**All tasks: HOLD.** Entry gate: R99 complete and assigned roadmap work.
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

### O05 — Tenant-scoped audit history

**Depends on:** O04. **Scope:** `AuditLog` model/migration, transition call sites,
admin endpoint/API wrapper and `frontend/app/admin/audit/page.tsx`.

**Acceptance:** record actor, organization, action, target, timestamp and useful
non-sensitive change metadata for booking/series changes, cancellations, refund
operations and role changes. Write business-action records in the same transaction;
rollback creates none. Distinguish system/provider actions from human actors.
Do not log passwords, tokens or access codes. Admin-only, tenant-scoped listing
returns wrapped entries in deterministic newest-first order with bounded paging;
no public mutation of audit history.

**Validation:** committed/rolled-back and system-action integration tests,
wrong-role/org denial, API shape tests and admin browsing E2E. Model indexes and
migration round trip must match metadata.

### O99 — Outcome 3 acceptance

**Depends on:** O01–O05. **Scope:** integrated operational recovery exercise.

**Acceptance:** `roadmap.md` outcome-3 criteria pass on one revision. Restart the
local worker/backend around queued email, refund and access operations; inject
provider failures; recover without duplicate financial effects or lost revoke
capability. Demonstrate accurate operator statuses, revenue reconciliation and
audit history. Record unavoidable external-delivery limits and manual recovery
procedures. Required suites and migration checks pass without external credentials.

## Deferred scope

| ID | Previous work | Reactivation condition |
|---|---|---|
| D01 | Epic 6: RLS | Before onboarding another operator. Design policies for public reads, user-owned multi-org data and worker access; verify with a non-bypass DB role that omission of a route filter cannot leak data. Do not mechanically apply the old single-org setting design to every request. |
| D02 | Epic 9: further i18n | A product need after the single-location journey is reliable. Q29/Q30 only complete/dispose of existing marketing/layout work; full booking/admin translation is not implicitly authorized. |
| D03 | Additional multi-operator/multi-space UX | Explicit expansion decision; existing tenant isolation and org-cache correctness remain mandatory now. |
| D04 | B13: daily booking products/monthly recurrence | Explicit customer/product requirement; these are new products, not regressions of hourly or weekly booking. |
| D05 | Epic 5: pagination beyond existing admin bookings | Demonstrated list growth. Q20 owns existing work; add further list coverage only when needed (O05's bounded audit listing is part of that task). |

## Legacy IDs and verified baseline

This is historical mapping, not another executable queue. The original assessment used main `bc3112b`; the table now distinguishes merged
foundations from outcome-level follow-ups. Gate 0 evidence is recorded above.
Keep old IDs in bug reports/PRs useful by linking them to the tasks below.

| Legacy item | Disposition / replacement |
|---|---|
| Seven-item architecture review follow-up | Landed by `40c05bd`; preserve isolation, API shapes, Decimal handling and overlap protections. |
| B1/B2/B4 and hourly portion of B5; T7 | Landed through `84b8e86`: multi-hour selection, separated same-day blocks, checkout redirect, busy-slot and cancellation coverage. Additional single-click/stale-modal proof is Q31; recurring B5 coverage is R02/R03/R99. |
| B3; Epic 1.1–1.4 | Q26/Q27 are merged as an opt-in pending UTC foundation; paid/local-time/manageable journey remains R01–R99. |
| B6 | Drag/click instructions landed (`90b4a1c`). |
| B7–B11 (from #23) | Admin org-cache, room/package/space editing and availability UI landed through `37123f8` and follow-ups. Preserve under Q20 and integrated checks; no duplicate CRUD project. |
| B12 (from #23) | Auth-aware package purchase UI landed (`88b1ecc`). Fresh-customer membership is C01; spending hours and full customer flow are Q22/C02. |
| B13 (from #23) | Hourly hardening Q31; recurring validation R99; daily/monthly product ideas D04. |
| T1/T8 | Migration ownership/baseline fixed (`f2d7b38`); stale-volume diagnostics Q19. Future model changes still require migrations. |
| T2 | Ruff cleanup exists in Q24; do not start a duplicate upgrade branch. |
| T3 | E2E login reliability Q25; broader diagnostics/auth feedback C08. |
| T4 | Path-filter behavior documented as intentional (`6cb76f4`); verify actual required-check configuration in Q00/C08. |
| T5/T6 | Stripe Compose settings/template consolidation landed (`5b24379`); configuration maintenance C08. |
| T9 | Rate-limit Compose forwarding landed (`3c6bb69`); configuration drift follow-up C08. |
| T10 | Walkable stub checkout landed (`bc3112b`/`55067ad`); abandonment/recovery is C03, not a second stub checkout implementation. |
| T11 (from #23) | Admin promotion command landed (`05f752c`). It is not customer enrollment; C01 handles that. |
| Epic 2.1–2.3 | Hourly/package checkout and signed completion handling landed (`147f698`); incomplete payment lifecycle C03 and refunds O02. |
| Epic 2.4 (from #23) | Existing redemption Q22; complete and verify customer flow C02. |
| Epic 3.1–3.3 | Merged lock foundation Q28 (live startup gated); durable and complete operational access O04. |
| Epic 4.1–4.3 | Stub/live email and confirmation/cancellation content landed (`0d19b2e`); in-process tasks do not complete durable queue acceptance. Recovery O01. |
| Epic 5.1–5.2 | Pagination Q20 merged and verified; additional pagination D05. |
| Epic 6.1–6.2 | Deferred D01, preserving isolation requirements. |
| Epic 7.1–7.2 | Auth/public rate limiter landed (`d8d4c3a`). Test/client-identity issues Q25/C08; do not rebuild the limiter speculatively. |
| Epic 8.1–8.2 | Audit persistence and admin view O05. |
| Epic 9.1–9.2 | Existing catalog/switcher Q29/Q30; expansion D02. |

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
