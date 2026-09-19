# TODO — Delivery backlog

Updated 2026-09-10. Product priorities come from [roadmap.md](roadmap.md).
This replaces the previous epic-first queue; the legacy mapping at the end
preserves its history and outstanding requirements.

## Execution boundary and task states

**Current assignment (2026-09-10): roadmap delivery resumed by the user.**
Gate 0 is DONE: #23 merged as `49433c3`; origin/main and the empty open PR/issue
queues were verified on 2026-09-10. C01 ([#33](https://github.com/fairglen/spacerental/pull/33),
`2304e8c`) and C02 ([#34](https://github.com/fairglen/spacerental/pull/34), `d919f52`)
are now DONE — verified merged on main via `git log`/`gh pr list` on 2026-09-10
after this file had gone stale showing them IN PROGRESS. B16/B17/B19 and C05
are now IN PROGRESS. Later outcomes remain HOLD until their entry gates pass.

New work must be recorded before implementation: give it an ID, reproduction or
scope, priority, dependencies, and acceptance/validation. Prioritize P0 for an
immediate critical blocker, P1 for the current customer outcome, P2 for subsequent
outcomes, and P3 for deferred improvements. An unrelated discovery enters the
queue; it does not silently expand the active task. Link already-known gaps to
their existing item instead of duplicating them.

Current queue: C01–C02 (P1, DONE), C05 (P1, IN PROGRESS — reprioritized ahead
of C04; see C05 below for the confirmed live bug that justified this), C04/
C06–C08/C99 (P1, QUEUED in order), B16/B17/B19 (P2, IN PROGRESS), R/O tasks
(P2, HOLD), D tasks (P3, DEFERRED). C08 diagnostics is known work, retained at
its agreed position. Reassess priority if new evidence establishes an immediate
blocker.

**Smoke-test findings (2026-09-17):** a browser smoke test of main `cced0f4`
(fresh customer + seeded admin, stub mode, production build) found the gaps
recorded as B22–B36 below and as evidence on C03/C04/C06/C07/R01/O03.
B22–B34, the C03 hold slice, C06 and C07 were fixed on `fix/smoke-findings`
and merged as `84e9b12` ([PR #46](https://github.com/fairglen/spacerental/pull/46))
on 2026-09-18; see each item for evidence. Still open: B35 and B36 (QUEUED),
the C04 residual (Next 15 major upgrade, a decision), and the R01/O03
evidence, which changed no state.

**Security hardening loop (2026-09-18):** active by user assignment. It audits
the repository unit by unit and records its work as the S-series near the end
of this file; ordinary bugs it finds continue the B-series. Each branch starts
with a docs commit for its item and ends with the evidence.

**Single-location simplification (2026-09-19):** by explicit owner assignment
on `feat/location-single-space-simple-booking`. The only booking product is
HOURLY booking (one or more contiguous hours) chosen on a day or week view: no
half-day or full-day products, no monthly booking, no recurring bookings.
R02, R03 and R99 are DEFERRED (R01 is not); the weekly series code, migration
and tests stay in the repo, passing, with the flag off. The assignment's four
steps are recorded as C09–C12 below, and admin handling of requests raised
through the new contact note is D06. Commits stay local; the owner opens the PR.

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

**Priority: P1. State: DONE — merged as `2304e8c` (2026-09-10).** Branch:
`feat/customer-enrollment`, worktree `/private/tmp/spacerental-customer-enrollment`;
[PR #33](https://github.com/fairglen/spacerental/pull/33) merged and verified
present on main via `git log`/`gh pr list` on 2026-09-10. Evidence:

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

**Priority: P1. State: DONE — merged with C01 in [PR #33](https://github.com/fairglen/spacerental/pull/33) as `2304e8c`.** Discovered 2026-09-10 in
`sign-up/[[...sign-up]]/page.tsx`: the result of `signIn(..., redirect: false)`
is ignored, so a created account can be sent to a protected page with no session.
Fix within C01 because signup → booking depends on it. Preserve the selected
package, explain that the account exists, and offer sign-in recovery without
repeating registration. Validate failed/throwing sign-in component behavior.

### B16 — Test database health probe logs a missing database repeatedly

**Priority: P2. State: DONE — merged as `c7d810a` in [PR #36](https://github.com/fairglen/spacerental/pull/36)
from branch `fix/test-db-health-probe`.** Observed during C01 backend
validation on 2026-09-10: `docker-compose.test.yml` ran `pg_isready -U
spacerental` while the test database was `spacerental_test`, so PostgreSQL
logged `FATAL: database "spacerental" does not exist` every three seconds even
though the suite connected correctly and proceeded. Fixed by probing the
explicit test database (`pg_isready -U spacerental -d $$POSTGRES_DB`); healthy
startup is unchanged and the messages are gone. The same mismatch in the two
CI workflows was not part of that fix and is tracked as B20 below.

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

### B18 — Fresh-customer E2E exhausts the shared public request budget

**Priority: P1. State: DONE — merged with C01 in [PR #33](https://github.com/fairglen/spacerental/pull/33).** First C01 browser run on
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

**Priority: P2. State: DONE (PR #37, `b81500b`).** Reconciled on 2026-09-18: the
fix is on main. `_register` translates the `IntegrityError` of a lost race into
the normal duplicate-email answer, `_create_default_org` retries slug collisions
inside a savepoint, and `test_concurrent_duplicate_email_registration_is_race_safe`
and `test_concurrent_operator_registration_gets_distinct_slugs` cover both. The
remote branch `fix/concurrent-registration-race` is a leftover. Original entry,
kept for history: branch `fix/concurrent-registration-race`.
Confirmed still open on 2026-09-10: no `IntegrityError` handling exists around
the register routes in `auth.py`. Reprioritized ahead of C99 since it is small,
independently scoped, and does not depend on C03–C08. C01 review found
existing check-then-insert patterns for user email and generated operator slugs
in `auth.py`, without `IntegrityError` translation. Two simultaneous requests
may both pass the preliminary lookup and make one fail with a server error.
Reproduce with real PostgreSQL before implementing. Acceptance: duplicate email
has a clear client response, distinct operator accounts with equal names get
unique slugs, and failure creates no partial account/org/membership. Preserve
normal duplicate-email and shared rate-limit behavior.

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

### B21 — Lint workflow has no path filter, so every branch inherits main's lint state

**Priority: P2. State: DONE — this PR.** Discovered 2026-09-14 while reviewing
why [PR #40](https://github.com/fairglen/spacerental/pull/40) (a static-HTML-only
change under `flowspace-site/`) showed a failing `Lint / python` check.
`.github/workflows/lint.yml` was declared as bare `on: [push, pull_request]`
with no `paths:` filter (`e2e.yml` is also unfiltered, but it does not run
`ruff check backend`), so the lint job ran against every branch regardless of
what it touched, and reported main's pre-existing `E501` failure as that PR's
red X. Fixed by giving the workflow the same push/pull_request path filters the
backend-tests, frontend-tests and migrations workflows use. The filter includes
root `ruff.toml` and `.pre-commit-config.yaml` as well as `backend/**`: the Ruff
configuration lives at the repository root and the hook pins the same Ruff
version as the workflow, so a change to either must still trigger the job.
Verified against Q00's finding that main carries no required-status-check
configuration, so a skipped run cannot leave a pull request stuck pending.

### C02 — Complete the package-holder journey

**Priority: P1. State: DONE — merged as `d919f52` (2026-09-10).** Branch:
`feat/package-holder-journey`; [PR #34](https://github.com/fairglen/spacerental/pull/34)
merged and verified present on main via `git log`/`gh pr list` on 2026-09-10.
The merged backend already provided atomic purchase activation, package debit,
and exact-once cancellation credit; this delivery closed the remaining UI/API
error distinction and added a fresh-customer purchase → redemption → cancellation
browser journey.

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

### C05 — Enforce booking validity at the API boundary — DONE (2026-09-10)

**Priority: P1. State: IN PROGRESS.** Branch: `feat/booking-validity-boundary`.
Reprioritized ahead of C04 under this file's own "reassess priority if new
evidence establishes an immediate blocker" rule: confirmed on 2026-09-10 that
`create_booking` in `backend/app/routers/bookings.py` calls `scalar_one_or_none()`
on the overlap-conflict query, which raises `MultipleResultsFound` (an unhandled
500) instead of a 409 whenever a requested interval overlaps two or more
existing bookings on the same room — this is exactly the crash this task's
acceptance criteria names.

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

**Evidence:** `backend/app/routers/bookings.py`'s `create_booking` used
`scalar_one_or_none()` on a multi-row `select(Booking)` overlap query, raising
an unhandled `MultipleResultsFound` (500) whenever a request overlapped two or
more existing bookings — fixed with an existence-only query
(`has_conflicting_booking` in the new `backend/app/booking_validity.py`), now
returning 409 as intended. That module is the single source of truth for
booking-slot validity, shared by `bookings.py` and `admin.py`:
- `is_within_open_hours` mirrors `BookingCalendar.resolveSelection`'s rule
  (hour-aligned slots, no closed gap, e.g. a lunch break, inside the range) —
  the API can no longer accept a range the calendar UI would refuse.
- `has_conflicting_booking` is reused by `admin_update_booking` so a
  cancelled/completed booking reinstated to `confirmed`/`pending` cannot
  create an overlap the customer-facing path would have rejected.
- `is_lost_slot_race` recognizes that a concurrent INSERT racing another
  writer for the same `bookings_no_overlap` GIST range can surface as a
  Postgres deadlock (sqlstate 40P01) instead of `IntegrityError` — both
  `bookings.py` and `recurrences.py` (whose bulk series insert isn't covered
  by `_lock_room` against a concurrent one-off booking) now recognize either
  form as a lost race (409) rather than an unhandled 500. This was found
  because the added per-request latency from the new checks below made a
  pre-existing, previously-rare deadlock window in
  `test_a_series_racing_a_single_booking_leaves_exactly_one_winner` fail
  consistently; the fix is general, not test-specific.
- `create_booking` also now rejects a past `start_time` (400), an inactive
  `Space` (404, alongside the pre-existing `Room.is_active` check — a room
  under a deactivated space was previously still bookable), and
  `BookingCreate.start_time`/`end_time` reject naive datetimes (422) instead
  of the schema silently accepting them (contrast with `RecurrenceCreate`,
  deliberately left as-is — out of scope). Non-positive intervals were
  already rejected and are covered by an existing test; unchanged.
- Timezone semantics: all comparisons are tz-aware UTC instants; storage is
  `TIMESTAMPTZ`. R01 remains the ticket for Lisbon wall-time.

**Tests:** `backend/tests/test_bookings.py::TestBookingValidityBoundary` (9
new cases — multi-conflict 409/no-500, wrong-org 403, past-start 400, naive
datetime 422, lunch-gap rejection, fully-closed-hours rejection, misaligned
slot rejection, inactive room 404, inactive space 404) and
`test_admin.py::TestAdminBookings::test_reinstating_a_cancelled_booking_cannot_create_an_overlap`.
Fixed one pre-existing test (`test_auth.py::test_customer_can_book_and_purchase_only_at_enrolled_org`)
that used a wall-clock, non-hour-aligned booking time incidental to what it
was actually testing. The existing EXCLUDE-constraint concurrency suite in
`test_recurrences.py` (`TestConcurrentSeriesCreation`, `overlap_constraint`
fixture) is preserved and, per above, hardened rather than left flaky.

**Commands run:**
`docker compose -p spacerental-c05-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-tests`
— 241 passed, run 4 times consecutively with zero failures after the deadlock
fix (`down -v` after each run). `ruff check` clean on every changed file. No
model/schema field was added (`Space.is_active` and `AvailabilityRule` already
existed), so no Alembic migration was needed. No frontend file was changed —
the UI already only ever offers what the API now enforces.

**Follow-up (2026-09-10):** a GitHub Copilot review on PR #39 raised 5 findings
(2 serious, 3 low-severity), all confirmed valid and fixed in a follow-up
commit on the same branch/PR:
- Serious — `create_booking` resolved org membership (403) *after* the
  past-start/open-hours (400) and conflict (409) checks, so a non-member could
  probe another org's calendar before ever being rejected. Moved the
  membership check to immediately after the room 404 check, before every
  other validation.
- Serious — `is_within_open_hours` loops one DB query per calendar day with
  no cap on the requested range, so an absurdly long interval could force
  unbounded per-request DB/CPU work. Added `MAX_BOOKING_DURATION` (24h) to
  `booking_validity.py` as an explicit defensive technical bound (not a
  product decision), checked in `create_booking` before calling
  `is_within_open_hours`.
- Low — the `booking_validity.py` module docstring overclaimed that
  `spaces.py`'s `GET /rooms/{room_id}/availability` already shares this
  module's open-hours logic; corrected to state that endpoint still has its
  own separate, not-yet-unified implementation.
- Low — `BookingCreate._require_timezone` only checked `tzinfo is None`; a
  tzinfo whose `utcoffset()` returns `None` slipped past it into an unrelated
  `ValueError` from `astimezone`. Now also checks `utcoffset() is None`.
- Low — removed `_future_slot`'s unused `hours_offset_from_now` parameter in
  `test_bookings.py` (no caller ever varied it).

**Follow-up evidence:** 3 new cases in
`test_bookings.py::TestBookingValidityBoundary` (multi-day range rejected
before the open-hours day-loop runs; non-member 403 before the past-start
check; non-member 403 before the conflict check, with no valid slot needed in
either). Full suite:
`docker compose -p spacerental-c05-fixup-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-tests`
— 244 passed (`down -v` after). `ruff check backend/` clean. No frontend file
touched.

**Second follow-up (2026-09-11):** a further automated review of
`is_within_open_hours` raised 2 findings, both confirmed by reading the code
and fixed. Note this round landed *after* PR #39 had already been squash-merged
to `main`, so it ships on its own branch rather than as more commits on #39.
- Real bug — duplicate/overlapping `AvailabilityRule` rows for the same
  room/weekday made `_hourly_slots` emit the same hour more than once. After
  sorting, the duplicates sat adjacent, so the contiguity check compared a
  slot's end (09:00) against the repeated slot's start (08:00), returned
  `False`, and rejected a perfectly open slot with a 400. Nothing in the schema
  or admin UI prevents an operator creating such rules, so this was reachable
  with real data. Slots are now collected into a `set` before sorting; genuine
  adjacency and genuine gaps are unaffected (both are covered by tests).
- Latent — the function only checked that the *duration* was a whole multiple
  of `SLOT_DURATION`, not that the endpoints landed on clock hours. A rule
  configured at `open_time = 08:30` therefore let the API accept an 08:30 start
  that the calendar (`step={60}`) can never produce — confirmed by running the
  new test against the pre-fix code, which created the 08:30 booking. Now
  rejects explicitly when UTC `minute`/`second`/`microsecond` are non-zero; the
  duration-multiple check is kept.
- Also fixed a pre-existing `E501` in `bookings.py` (the `MAX_BOOKING_DURATION`
  message f-string, 107 chars) that was making CI's `ruff check backend` job
  red on `main`.

**Second follow-up evidence:** 4 new cases in
`test_bookings.py::TestBookingValidityBoundary` (overlapping rules still allow
a booking; adjacent windows still merge across the boundary; a real closure
between two windows still rejects; a half-hour rule does not permit a
half-hour start), bringing the class to 16. Verified failing-before /
passing-after: against the pre-fix module the overlapping-rules case failed
400≠201 and the half-hour case failed 201≠400, while the adjacency and gap
guard cases passed both before and after. Full suite:
`docker compose -p spacerental-c05-dedupe-tests -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-tests`
— 250 passed (`down -v` after). `ruff check backend/` clean with the pinned
0.16.5. No schema change and no frontend file touched.

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


**Smoke-test evidence (2026-09-17):** `Pricing.tsx` takes price/validity/savings
from the i18n JSON keyed by hours (10, 20), so an admin price edit makes the
landing page contradict checkout, and a pack of any other size never appears.
Slice on `fix/smoke-findings`: render the cards from the packages API (name,
hours, price, validity_days) and the room hourly rate; compute savings from
real numbers and omit the line when not positive; keep translated labels for
static wording only; distinguish loading, error and "no packs".

**C06 decision (recorded 2026-09-18 before implementation):** `Pricing.tsx`
renders one card per active package returned by `GET /packages?org_id`
(sorted by hours), taking name, hours, price and `validity_days` from the
API; the hourly card takes the lowest active room rate of the first public
space (`GET /spaces/{id}`), shown as "desde" when rooms differ. Savings =
`hours × rate − price`, rendered only when positive. The "Mais Popular"
badge is dropped (not derivable); the best value (lowest price per hour) is
highlighted with a computed "Melhor valor" badge instead. Static wording
stays in the catalogs; every number comes from the API. States: skeleton
cards while loading; an error notice with retry when the packages request
fails; "no packs" copy pointing to hourly booking when the list is empty; a
missing rate degrades to a hourly card without a number and no savings
line. Alternatives rejected: keeping copy keyed by hours (the smoke test's
contradiction), or a backend "marketing" endpoint (a second source of
truth). Reversal: restore the `pack_10_*`/`pack_20_*` catalog keys and the
previous `packageCopyByHours` map.

**State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46), 2026-09-18.** Evidence:
`Pricing.tsx` now renders one card per active package from the API (name,
price, "{hours} horas", "Válido {days} dias", computed savings only when
positive, "Melhor valor" on the lowest price per hour) and the hourly card
from the lowest active room rate ("desde" when rooms differ); skeleton cards
while loading, an error notice with retry, and "no packs" copy. The
`pack_10_*`/`pack_20_*`/`hourly_plan_price`/`unavailable_cta` keys were
removed from both catalogs and replaced by parameterised labels (key parity
test passes). Four new Pricing component tests (varying price/validity,
savings omitted at zero, rate from rooms, error → retry → no packs, loading)
failed before and pass after; the three existing CTA tests still pass.
Vitest 210 passed. Playwright `packages.spec.ts` gained "an operator price
change reaches the landing page and the checkout amount": the 20h pack is
set to 177,50 € through `PUT /admin/packages/{id}`, the landing shows
177,50 € and a computed 42,50 € saving, the stub checkout page shows
177,50 €, and the price is restored. The journey lives in `admin.spec.ts`
(runs first): on a full-suite run the packages spec, last alphabetically,
hit the public rate limit (3 × 429) before it could even read `/spaces`. Public `GET /packages`
already returns active packs only, so a deactivated pack disappears from
the cards.

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


**Smoke-test evidence (2026-09-17):** cancelling a booking <24h away returns 400
and the dashboard dialog just stays open with no message. Slice on
`fix/smoke-findings`: `onError` handling with a Portuguese explanation mapped
from the response; the 24h rule stated in the dialog up front; Cancel disabled
or hidden for ineligible bookings with a visible reason. Backend stays
authoritative; no refund promise (O02).

**State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46) on 2026-09-18 (delivered 2026-09-17).** Delivered:
`cancellationEligibility()` in `lib/utils.ts` mirrors `validate_cancellation`
(eligible iff start − now ≥ 24h and not cancelled/completed); the dashboard
disables Cancel with the visible reason, states the rule in the dialog, and on
rejection keeps the dialog open with `cancellationErrorMessage()` from
`lib/httpError.ts` (400 24h / already cancelled / completed, 401, 403, 404,
429, network). No refund wording anywhere. Evidence: backend unit tests pin the
exact boundary (`test_booking_cancellation.py`: 24h+1s allowed, exactly 24h
allowed, 24h−1s rejected); frontend unit tests for eligibility at the same
boundary and for every mapped message; 3 dashboard component tests (11 failed
before the change, 23 pass after); new booking E2E "a booking inside the 24h
window cannot be cancelled and says why" passes (9/9 in the spec). Existing
success-path cancellation E2E unchanged.

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

### Smoke-test findings — 2026-09-17

Observed in a real browser against main `cced0f4` (Postgres, migrated and seeded
backend in stub mode, production Next build, Playwright as a fresh customer and
as `admin@demo.com`). Backend (251) and frontend (127) suites were green, so
every item is a coverage gap, not a regression. Items marked *code-confirmed*
were verified by reading the code rather than in the browser. All are P1 unless
stated; they are delivered on `fix/smoke-findings`, one commit per item.

### B22 — Admin refresh or deep link bounces operators to /dashboard

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): `OrgContext` now derives `currentOrgId` with `useMemo` from the
memberships plus the stored selection instead of a later `useEffect`. New
`tests/components/OrgContext.test.tsx` (4 tests) fails on the old code with a
render of 2 memberships and `currentOrgId: null`; new Playwright cases in
`admin.spec.ts` (reload on `/admin`, cold `/admin/bookings`, member redirect)
failed 2/3 before the fix (URL ended on `/dashboard`) and pass 3/3 after.
Vitest 131 passed, tsc clean. This also removes the Radix Select
uncontrolled→controlled warning (B33c) because the switcher's value is never
undefined once memberships exist.

Original report: **Priority: P1.** Reproduction (100%): sign in as
`admin@demo.com`, click Admin (works), press reload, or open `/admin/bookings`
directly → lands on `/dashboard`. Cause (code-confirmed in
`frontend/app/admin/layout.tsx` + `contexts/OrgContext.tsx`): the redirect
effect runs on a render where memberships are already known from the session
but `currentOrgId` is still `null` (it is set in a later `useEffect`), so
`isAdmin` is false and `router.replace('/dashboard')` fires.
**Dependencies:** none. **Acceptance:** derive the current org synchronously
(memberships + stored selection) so a loaded membership set never renders with
no current membership; reload on `/admin` and a cold deep link to
`/admin/bookings` stay in admin; a plain member is still redirected.
**Validation:** Playwright reload + deep link as admin; member redirect.

### B23 — Customers cannot see their door code

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): `Booking.access_code` added to `types/index.ts`; the dashboard
renders "Código de acesso: <code>" on confirmed upcoming cards, a calm "ainda
não disponível" line when confirmed without a code, and nothing for
pending/cancelled. `tests/components/DashboardPage.test.tsx` (3 states, 2/3
failed before the change), `api.test.ts` shape test for `access_code`, and the
booking E2E now asserts the code is on the dashboard card after stub payment
(passes). Durability of the code across restarts remains O04.

Original report: **Priority: P1.** `GET /bookings/me` returns `access_code` for
confirmed bookings but nothing under `frontend/` renders it (code-confirmed by
grep). **Dependencies:** none (O04 owns durability; stub codes vanish on
restart and that is out of scope here). **Acceptance:** confirmed upcoming
bookings on the dashboard show the code, clearly labelled; pending/cancelled
never show one; "confirmed but no code yet" shows a calm Portuguese message
rather than an empty gap. `Booking` type and `lib/api.ts` carry the field.
**Validation:** component test for the three states; booking E2E asserts the
code is visible after stub payment.

### B24 — Past hours are offered as bookable

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): `GET /rooms/{id}/availability` now reads the clock through
`app/clock.py::utcnow()` and marks any slot whose start is behind it as
`available: false` (shape unchanged). Real-PG tests with a pinned clock
(`test_past_slots_are_not_available`, `test_future_day_is_unaffected_by_the_clock`)
fail on the old code and pass now (9 passed in `test_spaces.py`).
`BookingCalendar` classifies a past slot locally: disabled styling, no
"Ocupado" chip, and a "já passou" notice instead of "já está reservada"
(3 new component tests; the existing calendar fixtures were moved from
2026-08-10, already in the past, to 2030-08-12). Booking E2E 8/8 passed.

Original report: **Priority: P1.** At 22:11 UTC the availability endpoint
returned every same-day slot as `available: true`; the calendar paints them
green; clicking one ends in a generic error because `POST /bookings` correctly
rejects past start times. **Dependencies:** none. **Acceptance:** in
`backend/app/routers/spaces.py` a slot whose start is in the past is not
available; response shape unchanged. The calendar does not present
unavailable-because-past as "Ocupado" — past is styled as disabled with no
event chip. **Validation:** real-PG pytest with a controlled clock; component
test for the past state.

### B25 — Payment return is silent

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): the dashboard reads `?pagamento=sucesso|cancelado`, shows a
dismissible `role="status"` notice (success links to `/dashboard/packages`;
cancelled says "Pagamento não concluído. Não foi cobrado nada.") and calls
`router.replace('/dashboard')` so a reload does not repeat it. Three component
tests (success + link + dismiss, cancelled, absent) — 2/3 failed before.

Original report: **Priority: P1.** Stub/Stripe return to
`/dashboard?pagamento=sucesso` or `?pagamento=cancelado` and the page ignores
the parameter. **Dependencies:** none. **Acceptance:** dismissible success or
"pagamento não concluído" notice; the parameter is stripped from the URL so a
reload does not repeat it; pack purchases return to the same URL, so the
success notice links to `/dashboard/packages`. **Validation:** component tests
for both values and for absence.

### B26 — Closed days, loading and API failure all render as a blank grid

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): `BookingCalendar` now shows "A carregar disponibilidade…"
(`role=status`) while fetching, "Não foi possível carregar…" with a "Tentar
novamente" button (`role=alert`, refetches the failed queries) on error, and
"Fechado neste dia." / "Fechado nesta semana." when the day has no opening
hours; the grid stays mounted so navigation still works. A selection that
touches no slot at all now shows an inline notice instead of being ignored.
Four component tests, all failing before the change; 14 pass in the file.

Original report: **Priority: P1.** A Sunday renders a blank white calendar with no
label and clicks do nothing (`resolveSelection` returns `kind: 'none'` and
`handleSelectSlot` ignores it). Loading and an availability API failure look
identical. **Dependencies:** none. **Acceptance:** `BookingCalendar` has three
distinct, visible states — loading, error (with retry), and closed ("Fechado
neste dia"); a `'none'` selection shows the same inline notice the `'taken'`
and `'closed'` branches use. **Validation:** component tests per state.

### B27 — "Reservar Esta Sala" appears to do nothing

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): selecting a room scrolls the calendar section into view
(`behavior: 'auto'` under `prefers-reduced-motion: reduce`, `smooth`
otherwise) and focuses its heading (`tabIndex={-1}`); `RoomCard` takes a
`selected` prop that adds a ring, a "Sala selecionada" badge and
`aria-pressed`. New `tests/components/SpacePage.test.tsx` (3 tests, all
failing before). Booking E2E 9/9 still passes through the same button.

Original report: **Priority: P1.** The calendar mounts below the fold (top at
851px in a 900px viewport) with no scroll, and no card shows as selected.
**Dependencies:** none. **Acceptance:** selecting a room scrolls the calendar
section into view and moves focus to its heading, respecting
`prefers-reduced-motion`; the selected room card is visibly marked.
**Validation:** component test for selection state and focus/scroll call.

### B28 — Booking modal sign-in link loses the customer's place

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): new `lib/navigation.ts` (`safeInternalPath`, `signInHref`)
accepts only same-origin relative paths (rejects absolute, `//host`, schemes,
`/\`). The modal links to `/sign-in?callbackUrl=<space page>`; sign-in and
sign-up follow a safe `callbackUrl` after success (package resume still
wins) and carry it to each other's links. Before this, sign-in ignored
`callbackUrl` entirely (it only read `packageId`). Tests: 3 unit tests for
the helper, 4 sign-in tests, 1 modal link test; 37 pass across the touched
files. Restoring the exact slot is not attempted.

Original report: **Priority: P1.** The modal links to bare `/sign-in`, so after
login the customer lands on `/dashboard` and must start over.
**Dependencies:** none. **Acceptance:** link to `/sign-in` with a `callbackUrl`
back to the space page; the sign-in page honours only same-origin relative
paths (no open redirect); returning to the space page is required, restoring
the exact slot is optional. **Validation:** sign-in component tests for a
relative, an absolute/external, and a missing `callbackUrl`; modal link test.

### B29 — Pack bookings give no confirmation and show the wrong price

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): a package booking now keeps the modal open on a "Reserva
confirmada" state (room, date, time, "3h do teu pack", hours remaining from
the refetched balance, link to Minhas reservas, Fechar); the previous modal
test that encoded the silent close was rewritten to assert this. The
dashboard's upcoming and history cards show `formatHours(duration) + " do
pack"` for `payment_method: 'package'` and the euro amount only for hourly
bookings (2 new dashboard tests). `formatHours` in `lib/utils.ts` renders
"10h" / "7,5h" (unit test). 41 tests pass across the touched files.

Original report: **Priority: P1.** Paying with pack hours closes the modal
silently; the dashboard then shows "33,00 €" on a booking that cost no money.
**Dependencies:** none. **Acceptance:** after a pack booking the modal shows a
clear success state (what was booked, hours used, hours left, link to Minhas
reservas). In the dashboard and history, bookings with `payment_method:
'package'` show hours used ("3h do pack"), not a euro amount. **Validation:**
modal component test for the success state; dashboard test for the label.

### B30 — Packs are undiscoverable

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): navbar (desktop + mobile) shows "Os meus packs" →
`/dashboard/packages` for signed-in users (`navbar.my_packages` in pt/en);
the dashboard has an "Os teus packs" region listing active purchases with
`formatHours(hours_remaining)`, expiry date and a link, or an invitation when
there is none; `/dashboard/packages` renders "10h" / "7,5h" instead of
"10.0h". Tests: 2 navbar, 2 dashboard, 1 packages-page test; the existing
packages-page test that pinned "7.0h" was updated to "7h". Full Vitest: 175
passed.

Original report: **Priority: P1.** Nothing links to `/dashboard/packages` — not
the navbar, not the dashboard whose subtitle promises "reservas e pacotes".
"10.0h restantes" is also shown instead of "10h". **Dependencies:** none.
**Acceptance:** a nav entry for signed-in users and a compact packs summary on
the dashboard (hours left, expiry, link); hours format as "10h" and keep real
fractions with a Portuguese comma ("7,5h"). **Validation:** navbar and
dashboard component tests; unit test for the hours formatter.

### B31 — Booking errors are all the same sentence

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): `bookingErrorMessage(error, method)` in `lib/httpError.ts` maps
409 (slot taken vs insufficient pack hours, unchanged), 400 past start, 400
outside opening hours, other 400, 401 (modal adds an "Entrar na conta" link
with `callbackUrl`), 403 not a member, 404, 429, 502 payment start, network
failure, and a generic fallback. The modal's private `errorMessage` was
removed in favour of it. Tests: 4 unit tests over every mapping, 3 modal
tests (past, 401 link, network); 32 pass across the touched files.

Original report: **Priority: P1.** `errorMessage()` in `BookingModal.tsx` maps
everything that is not 409 to "Erro ao criar reserva". **Dependencies:** none.
**Acceptance:** map at least past start time, outside opening hours, 401
expired session (offer sign-in with `callbackUrl`), 403 not a member, 429 rate
limited, and network failure; the mapping lives next to the existing helpers
in `lib/httpError.ts` for reuse. **Validation:** unit tests per mapping; modal
tests for the 401 sign-in offer.

### B32 — Landing copy promises features that do not exist

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): in both catalogs the hero badge no longer says
"recorrente/recurring", step 1 no longer mentions Google, the flexibility
value prop no longer offers "mensalmente/monthly", and the "Reserva
prioritária / Priority booking" feature lines were removed from both pack
cards (`pack_*_feature_4` keys deleted, `Pricing.tsx` no longer reads them).
"Sem mensalidade / No monthly fee" stays: it is a true negation. New
`tests/lib/i18nCatalogs.test.ts` checks key parity between pt/en and that
none of the removed claims reappear (4/5 failed before the change).

Original report: **Priority: P1.** In both `pt.json` and `en.json`: "com o
Google" (no Google sign-in), "mensalmente"/monthly, "Reserva prioritária" (no
such feature), and the hero badge's "recorrente" while
`RECURRING_BOOKINGS_ENABLED` defaults to false. **Dependencies:** none.
**Acceptance:** remove or reword without adding new unverifiable claims; both
catalogs stay key-aligned. **Validation:** i18n catalog test (keys aligned, the
removed claims absent); existing component tests still assert behaviour only.

### B33 — Small correctness and polish findings

**Priority: P2. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-17): a) footer shows "As minhas reservas" → `/dashboard` when signed
in (`footer.my_bookings` in pt/en; 2 tests); b) the org switcher renders only
with ≥2 memberships (test); c) fixed by B22 — a test now asserts no Radix
"uncontrolled" console error for a multi-org user; d) calendar `formats`
give "sexta-feira, 18 de setembro" day headers plus Portuguese week/month
headers (test); e) history shows 5 with "Ver mais (N)" revealing all (test);
f) `app/not-found.tsx` in Portuguese with links home and to spaces (test);
g) `seed.py` descriptions, city and amenities translated — verified by
`alembic upgrade head && python -m app.seed && alembic check` on a fresh
throwaway database (no test pinned the English strings; existing databases
keep their rows because the seeder is insert-only); h) docs-only, recorded
below. Full Vitest 194 passed; locale + booking E2E 10 passed.

Grouped for one polish commit, or one commit
each where a change is not trivial:

- a) Footer shows "Entrar" while signed in.
- b) Org switcher is shown to customers; hide it for a single membership (keep
  it for multi-org users).
- c) Radix Select "uncontrolled to controlled" console warning on every
  authenticated page (the org switcher's value starts undefined).
- d) Calendar toolbar label reads "sexta-feira set 18"; use proper Portuguese
  ("sexta-feira, 18 de setembro") via the localizer formats.
- e) Dashboard history is hard-capped at 5 with no way to see more.
- f) Add a styled Portuguese `app/not-found.tsx` (currently the English default).
- g) Seed content is English on a Portuguese site (space/room descriptions,
  "Lisbon"); translate in `backend/app/seed.py` after checking no test pins
  the strings.
- h) Two Alembic revisions share the `0002_` prefix
  (`0002_booking_pkg_purchase.py`, `0002_recurring_bookings.py`). Applied
  revision IDs are never renamed. Convention going forward: the next revision
  takes the next unused numeric prefix on the branch it is created from
  (`0003_…`), and a merge revision is generated with `alembic merge` when two
  branches collide instead of sharing a prefix. Recorded here because no
  migrations README exists.

**Validation:** component/unit tests per changed behaviour; seed run on a fresh
database; full suites.

### B34 — An hour of Lisbon inventory is invisible in the calendar (R01 slice)

**Priority: P1. State: DONE — merged as `84e9b12` in [PR #46](https://github.com/fairglen/spacerental/pull/46).** Evidence
(2026-09-18): `visibleRange()` in `BookingCalendar.tsx` derives `min`/`max`
from the returned slots with one hour of padding, clamped to the day, and
keeps the last known window while the next day loads (fallback 08:00–20:00
only until the first slots arrive). Three component tests (padding, an
operator window outside 08–20 never hidden, clamping + fallback) failed
before and pass after (18 in the file). The E2E specs located calendar rows
by a fixed 08:00 offset; they now find rows by the gutter label and resolve
them only once the day's slots are on the grid (the auth journey was
otherwise resolving its two rows on different grids and dragging three
hours). Auth + booking E2E: 16 passed.

Original report: **Priority: P1.** Opening hours are stored as naive times and
evaluated as UTC (seed 08:00–20:00 = 09:00–21:00 Lisbon during DST) while
`BookingCalendar` hard-codes `min`/`max` 08:00–20:00 in the browser's zone.
Today the 20:00–21:00 Lisbon slot can never be booked and 08:00 looks closed.
**Dependencies:** none for the slice; the full fix is R01. **Acceptance
(slice):** derive the calendar's visible range from the slots the API returned
(with padding and a fallback) so nothing bookable is hidden whatever the
operator configures. No timezone column, wall-clock rules or DST recurrence
here — that evidence is recorded on R01. **Validation:** component test with
slots outside the old fixed range.

**B34 decision (recorded 2026-09-18 before implementation):** `BookingCalendar`
derives `min`/`max` from the slots the API returned for the days in view:
`min` = the earliest slot start rounded down to the hour minus one hour of
padding (never before 00:00), `max` = the latest slot end rounded up plus one
hour (never past 24:00), both in the browser's zone because that is the zone
react-big-calendar lays the grid out in. With no slots yet (loading, error,
closed day) the previous 08:00–20:00 window is the fallback so the grid does
not jump. Alternatives rejected: keeping the fixed window (hides the
20:00–21:00 Lisbon slot today and any future operator change); showing the
full 00:00–24:00 day (600px grid becomes unreadable); asking the API for the
room's opening window (R01 owns the timezone-correct version of that).
Reversal: delete `visibleRange()` and restore the two constants.

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

### C09 — One public contact address, from a single source

**Priority: P1. State: IN PROGRESS** — implemented on `feat/location-single-space-simple-booking` as `b4fc68a`, committed locally; the owner opens the PR (DONE only once merged).
**Evidence (2026-09-19):** `frontend/lib/contact.ts` exports `CONTACT_EMAIL` and
`contactMailto()`; the footer renders the address from it as a `mailto:` link
and the `footer.email` catalog key is gone from both locales. `contact.test.ts`
refuses any literal address in `pt.json`/`en.json`. Repo grep for
`@(espacohora|flowspace).pt`: `flowspace-site/` already used
`geral@flowspace.pt` everywhere (form copy, Apps Script recipient, README), so
it is unchanged; the only other hits are `EMAIL_FROM_ADDRESS`, left alone on
purpose. **Open (owner):** the sender domain — mail still goes out as
`no-reply@espacohora.pt` while customers are told to write to `flowspace.pt`.
**Scope:** the public contact address is `geral@flowspace.pt`; the footer
catalogs (`frontend/lib/i18n/pt.json`, `en.json`) still say
`geral@espacohora.pt`. Align every customer-facing contact address in the
repository, `flowspace-site/` included, and make the frontend read it from one
constant that C12's contact note reuses. `EMAIL_FROM_ADDRESS`
(`no-reply@espacohora.pt` in `config.py`, `docker-compose.yml`, `.env.example`)
is NOT changed: it is a sending domain that needs DNS/Resend verification, a
separate owner decision. **Dependencies:** none. **Acceptance:** one exported
constant is the only place the address is written in `frontend/`; the footer
renders it as a `mailto:` link in both locales; a repo-wide grep finds no other
customer-facing contact address. **Validation:** component test on the footer
link (behaviour: href and visible address come from the constant); i18n catalog
parity test still green; repo grep recorded as evidence.

### C10 — Give a space a real location

**Priority: P1. State: IN PROGRESS** — implemented on `feat/location-single-space-simple-booking` as `56fd6be`, committed locally; the owner opens the PR (DONE only once merged).
**Evidence (2026-09-19):** migration `0004_space_location`; upgrade → `alembic
check` ("No new upgrade operations detected") → downgrade to
`0003_booking_holds` (columns gone) → downgrade base (no tables left) → upgrade
→ check, on an empty PostgreSQL 16 scratch database. 35 real-PG tests in
`tests/test_space_location.py` (range, NaN/Infinity, both-or-neither on create
and on update, clearing, 403/404 for another organization's admin, 403 for a
member, public list/detail shape, the CHECK constraints refusing a raw UPDATE,
seed placement and re-seed moving a Lisbon-era row without duplicating it);
the S09 sweep and the S19 exposure allowlist cover the new fields. Frontend:
`SpaceLocation`, `lib/location.ts`, admin form and footer tests. Full backend
suite 427 passed. **Decisions:** (1) on update the two coordinates travel
together — a body with only one is a 422 — rather than being judged against the
stored half; reverse by merging with the stored row in `admin_update_space`.
(2) Coordinates are rounded to six places, not refused, because maps apps hand
out more digits. (3) CHECK constraints duplicate the API rules for writers that
skip the API; drop them with a one-line migration if unwanted. (4) The admin
form validates the Portuguese `0000-000` postcode format; the API only bounds
the length (20), so a foreign operator is blocked by the form alone — delete the
regex in `lib/spaceLocationForm.ts` to lift it. (5) "Como chegar" uses Google's
universal maps URL (it hands off to the phone's maps app); the embedded preview
is OpenStreetMap and loads only on "Ver mapa". **Original scope:** **Scope:** `Space` gains
`postal_code` (String, nullable) and `latitude`/`longitude` (Numeric(9,6),
nullable, real ranges, both or neither) with one reviewed Alembic migration;
the fields appear in the public space schema and the admin create/update
schemas with the wrapped shapes unchanged; `API_SPEC.md` updated. No timezone
column (R01 owns it). The seeded demo space moves to R. 12 de Julho de 1997 5,
Loja 1, 2745-841 Queluz (38.755723, -9.279799), updating an already-seeded
space in place. Frontend: a `SpaceLocation` component (address block from the
parts that exist, "Como chegar" directions link, OpenStreetMap preview mounted
only on click, no API key and no new dependency); admin space form (new + edit)
gets the three fields with inline validation; the footer location comes from
the space when there is exactly one. **Dependencies:** C09 (order only).
**Acceptance:** migration upgrade → `alembic check` → downgrade → upgrade is
clean on an empty PostgreSQL 16; out-of-range or half-given coordinates are a
422 on create and on update, including an update that would leave one
coordinate without the other; another organization's admin cannot write the
fields; nothing customer-facing says Lisbon/Lisboa for the seeded space; no
third-party request happens before the customer presses "Ver mapa"; with no
coordinates there is no map section and the directions link falls back to an
address search. **Validation:** real-PG integration tests for validation and
tenant scoping on the admin endpoints and for the public shape; seed
idempotency test (re-seed updates, never duplicates); `api.test.ts` shape test;
component tests for `SpaceLocation` with full, partial and missing data and for
the iframe being absent until the button is pressed; admin form validation test.

### C11 — Hide the "space" layer while there is only one

**Priority: P1. State: IN PROGRESS** — implemented on `feat/location-single-space-simple-booking` as `bcd5691`, committed locally; the owner opens the PR (DONE only once merged).
**Evidence (2026-09-19):** `useSingleSpace()` is the only place that counts
spaces (`grep -rn "spaces.length" frontend/app frontend/components` finds
nothing). Component tests drive 0, 1 and 2 spaces plus loading and error for
the landing section, `/spaces`, the `?room=` deep link and the navbar/footer/
hero/how-it-works labels. Playwright `single-space.spec.ts` on the seeded
stack: landing → room card → that room's calendar open, in view and marked;
stale `?room=` ignored; back button does not loop; location visible on landing
and rooms page with no third-party request before "Ver mapa". **Decision:**
`/spaces` renders the rooms view in place instead of redirecting to
`/spaces/<id>` (no history entry to loop on, no hop per visit, nothing to undo
when a second space appears); reverse by replacing the single-mode branch of
`app/spaces/page.tsx` with `router.replace`. **Cost to know about:** every full
page load now reads `GET /spaces` once (the navbar label depends on it); it is
cached for 60 s within a page session. **Original scope:** **Scope:** while exactly one
active space is publicly visible, customers go straight to rooms; when a second
space appears the current spaces UI returns with no code change. The mode is
decided in one hook over the existing public spaces query
(`{ mode: 'single' | 'multi', space }`, with loading and error explicit), and
everything else asks the hook. Single mode: the landing section lists that
space's room cards with a CTA that deep-links to the space page with the room
preselected and the calendar open (`?room=<id>`); "Espaços" navigation labels
become "Salas" in both catalogs; `/spaces` does not show a one-card list;
`SpaceLocation` appears as a compact "Onde estamos" section on the landing page
and in the header of the rooms page. Multi mode is unchanged, and
`/spaces/[id]` URLs work in both. Admin is out of scope. **Dependencies:** C10.
**Acceptance:** no multi-space UI flashes before the mode is known (skeletons
until then); an invalid or inactive `?room=` is ignored quietly; the back
button does not loop from `/spaces`; zero spaces shows a sane empty state.
**Validation:** component tests for 0, 1 and 2 spaces from mocked API data,
plus loading and error; Playwright on the seeded single-space stack: landing →
room card → the calendar for that room is open. Assertions are on behaviour,
not marketing strings.

### C12 — Hourly booking only, on a day or week view, with a contact note

**Priority: P1. State: IN PROGRESS** — implemented on `feat/location-single-space-simple-booking` as `501db46`, committed locally; the owner opens the PR (DONE only once merged).
**Evidence (2026-09-19):** `BookingCalendar` passes `views={['day','week']}`,
no month message/format/drill-down. `RECURRING_BOOKINGS_ENABLED` verified false
in `backend/app/config.py`, `docker-compose.yml` (backend and
`NEXT_PUBLIC_`) and `.env.example`; with it off the dialog has no checkbox
(component test, and the untouched weekly-series E2E asserts the same).
Component tests: offered views, default per width (1024/1440 week, 1023/390
day), manual choice surviving a remount, storage unavailable, click and drag in
both views, contact note placement/mailto/role. Playwright `week-view.spec.ts`:
week view by default at 1280px, no "Mês", two-hour drag → stub checkout →
Confirmado; a 390px phone opens on the day and keeps the week once chosen. No
backend booking change was needed. **Decision:** the manual choice lives in
`sessionStorage` (per tab session); the default is read once on mount.
**Original scope:** **Scope:** remove the month
view from `BookingCalendar` (view list, message, drill-down, the branches it
leaves dead, and the page help text that mentions it); default to "Semana" at
≥1024px and "Dia" below, with the customer's manual choice winning for the rest
of the session; both views keep click-one-hour and drag-several-hours. A small
shared contact note ("Somos flexíveis…") reads the C09 constant and links
`mailto:` with a prefilled subject naming the room; it shows on the booking
page between the help text and the calendar and as one muted line in the
confirm dialog. Landing copy in both catalogs stops claiming recurring,
monthly or day-rate booking. No request form, inbox or admin view (that is
D06). No backend booking change is expected; needing one is a stop-and-ask.
**Dependencies:** C09, C11. **Acceptance:** only Dia/Semana are offered;
`RECURRING_BOOKINGS_ENABLED` defaults to false everywhere it is defined and,
with it off, the confirm dialog has no "Repetir semanalmente" checkbox; the
note never looks like an error, blocks nothing and keeps no dismissed state.
**Validation:** component tests for the offered views, the default per viewport
width and the manual choice sticking, single-click and drag selection in both
views, the note and its `mailto:` on the page and in the dialog, and no
recurrence checkbox with the flag off; Playwright: in week view drag two hours
on a day later this week → stub checkout → Confirmado on the dashboard, and the
toolbar has no "Mês". The untouched recurrence tests keep passing.

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
files wait out one window each (the B18 rule). For (2), carrying the last
answer across full page loads for its 60 s freshness would remove most of it. **Proposal:** a ranged availability read
(`?from=&to=`, bounded to 7 days, same wrapped `{slots}` shape) with the
`lib/api.ts` wrapper and shape test. It is a backend change on a public
endpoint, so it was not made under C12. **Acceptance:** one request per week
shown; real-PG tests for range bounds and the rate tier; week-view E2E green.

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

### R02 — Make recurring reservations payable

Noticed 2026-09-19 (C12), not changed: `.github/workflows/e2e.yml` sets `RECURRING_BOOKINGS_ENABLED: 'true'`, so CI's browser run still shows the weekly checkbox while every default is false; decide whether CI should follow the parked state.

**State: DEFERRED** — parked by owner 2026-09-19 to simplify; customers rebook each week; weekly series code stays in the repo, flag off.

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

**State: DEFERRED** — parked by owner 2026-09-19 to simplify; customers rebook each week; weekly series code stays in the repo, flag off.

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

**State: DEFERRED** — parked by owner 2026-09-19 to simplify; customers rebook each week; weekly series code stays in the repo, flag off.

**Depends on:** R01–R03. **Scope:** integrated customer flow and regression checks.

**Acceptance:** `roadmap.md` outcome-2 criteria pass together: preview, paid series,
conflict atomicity, stable local times, editing, individual/future cancellation,
and accurate accounting/notifications. Run required suites and migration checks,
record integrated commit and exact stub-mode reproduction steps.

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

### S01 — Authorization and tenant-isolation regression matrix

**Priority: P1. State: MERGED (PR #48, `ad4bc12`; follow-ups in PR #49,
`344913a`).** Follow-up evidence
(2026-09-18): the matrix is at 68 cases; with the webhook digest never
compared, the org filter dropped from two dashboard metrics and enrolment
granting owner, four tests failed for those reasons and the code was
restored. The last review pass on #48 named four
coverage gaps that ship with S02's PR: the dashboard isolation check asserts
only the booking count; a new customer route needs nothing beyond the
anonymous sweep; the hostile-field registration case skips the operator
registration path; and the forged webhook signature is refused for its old
timestamp before its digest is looked at. Evidence
(2026-09-18): `backend/tests/test_authz_matrix.py` classifies all 39 API routes
and adds real-PostgreSQL cases (51 at first); all pass on main `c096e0c`, so the audit of
authorization and tenant isolation found no flaw: every operator handler
filters its target by the caller's `org_id`, the update schemas expose no
owner or organization field, and customer routes check ownership. A mutation
check proved the suite can fail: with the room org filter, the booking
ownership check and the operator role filter removed and one unclassified
route added, seven tests failed for the expected reasons, and the code was
restored. Review follow-up (same day): the org's own operator is now an
intruder on customer-owned booking and series endpoints, cross-org series
creation is covered, a misspelt classification is rejected, every public,
webhook and stub route is swept anonymously, the webhook acts only on a
valid provider signature (unsigned and forged events leave a pending
booking pending, the signed one confirms it), and the hold deadline is
bounded on both sides by `BOOKING_HOLD_MINUTES`; 65 cases, and two further
mutation checks failed six tests for the expected reasons. Full backend
suite: 345 passed. Convention
going forward: a new route fails `test_every_route_is_classified` until it
is added to `ROUTES` and covered.
**Scope:** `backend/tests/test_authz_matrix.py`; no application change is
expected. **Why:** tenant isolation is enforced by hand in every handler
(CLAUDE.md §4; PostgreSQL RLS is deferred as D01) and nothing fails today when
a new route forgets its check. **Dependencies:** none.

**Acceptance:** every API route carries a classification (public, customer,
operator, webhook, stub checkout) and a test fails when a route is added
without one or when its authentication dependency does not match it. For six
personas (anonymous, customer of org A, customer of org B, operator of A,
operator of B, a user who operates A and is a customer of B): every operator
route refuses the wrong organization, and refuses another organization's
space, room, availability, booking or package without changing it; customer
routes refuse another customer's booking, purchase and series; lists return
only the caller's or the organization's rows; client-supplied `org_id`,
`user_id`, `status`, amounts and roles are ignored; a stale role claim in a
token grants nothing.

**Validation:** real-PostgreSQL pytest through the `client` fixture. A case
that fails on main becomes its own S item with a fix; the cases that pass stay
as regression tests.

### S02 — Authentication and token-handling regression tests

**Priority: P1. State: MERGED (PR #49, `344913a`).**
Evidence (2026-09-18): `backend/tests/test_auth_tokens.py` adds 22
real-PostgreSQL cases and all pass on the code as audited, so token
validation is sound: the algorithm is pinned, expiry and signature are
enforced, the user is re-loaded on every request, and a token is read only
from the `Authorization` header. A mutation check proved the cases can fail:
with a second algorithm allowed and expiry verification off, a distinct
answer for unknown emails and the login password bound removed, five tests
failed for those reasons, and the code was restored. Full backend suite with
the S01 follow-ups and the review rounds: 370 passed. The audit's confirmed
findings are S03, S04 and B37 below; each has a failing test held locally
until its fix ships in the same PR.
**Scope:** `backend/tests/test_auth_tokens.py`; no application change.
**Why:** every customer and operator route trusts one dependency,
`get_current_user`, to turn a Bearer header into a user, and nothing pins what
it must refuse. S01 covers what a known user may do; this covers how a user
becomes known. **Dependencies:** none.

**Acceptance:** real-PostgreSQL tests prove that a token is refused when it is
expired, signed with another key, unsigned (`alg: none`), signed with another
algorithm, altered after signing, missing its subject, or issued to a user who
no longer exists; that a token is read only from the `Authorization` header;
that login answers identically for an unknown email and a wrong password; that
issued claims and the auth responses carry no secret; and that over-long
passwords are refused before any hashing. A case that fails on main becomes
its own item (S or B) with a fix; the passing cases stay as regression tests.

**Validation:** pytest through the `client` fixture, plus a mutation check
proving the cases can fail.

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

### S05 — Payment, webhook and hold regression tests

**Priority: P1. State: MERGED (PR #50, `4ea1b4f`).**
Evidence (2026-09-18): `backend/tests/test_payment_integrity.py` adds 12
real-PostgreSQL cases and all pass on the code as audited: events are bound
to booking, org and session together, amounts are computed server-side, live
mode exposes no stub surface, and door codes exist only for confirmed
bookings. A mutation check proved the cases can fail: with the session
binding and the purchase's org binding dropped, the replay window removed and
the stub routes serving any gateway, five tests failed for those reasons,
and the code was restored. Full backend suite: 382 passed. A pending
purchase being unspendable was already covered by `test_package_redemption`
and is not duplicated. The audit's confirmed findings are S06 and B38 to B40
below, and S07 is the decision it leaves with the owner.
**Scope:** `backend/tests/test_payment_integrity.py`; no application change.
**Why:** a booking may become `confirmed`, and a package `active`, only through
a verified payment of its own checkout session, a package debit or an operator
of its org. The existing webhook tests cover a missing or invalid signature, a
replay, another org's booking event, an unpaid session and an unknown session;
the bindings below are not pinned anywhere. **Dependencies:** none.

**Acceptance:** real-PostgreSQL tests prove that a correctly signed event
cannot act on a booking through another booking's session, nor across the
booking and purchase kinds; that a valid digest with a stale timestamp is
refused; that a duplicate or foreign purchase event changes no balance; that
the amount sent to the gateway is always the server's price, whatever the
client sends, and a hostile purchase body is ignored; that a pending purchase
cannot be spent; that in live mode every stub checkout route answers 404 and a
payload signed with the public stub secret does not verify; and that an access
code exists only for a confirmed booking and never travels by email. A case
that fails on main becomes its own item; the passing cases stay as regression
tests.

**Validation:** pytest through the `client` fixture, plus a mutation check
proving the cases can fail.

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

### S09 — Request schemas are unbounded

**Priority: P1. State: DONE on `fix/sec-request-bounds` (pending PR).** Evidence
(2026-09-18): `backend/tests/test_request_bounds.py` sends 56 hostile requests
in three sweeps (anonymous, customer, operator). On main the sweeps fail, with
31 requests answered 500 and the rest accepted where they should be refused;
with `backend/app/schemas/bounds.py` applied to every request schema all are
answered 4xx, and a control proves ordinary operator input, including the
largest values the limits allow, is still accepted. Full backend suite: 392
passed. `API_SPEC.md` documents the bounds.
**Decision recorded (2026-09-18), generous technical limits that change no
documented journey:** names 1 to 255 characters (the column size); city 100;
address 500; descriptions 5000; booking and series notes 2000; at most 50
amenities or images per row, 100 and 500 characters each, images `http(s)`
URLs only; room colour `#RRGGBB`; capacity 1 to 10000; `hourly_rate` and
`price` from 0 to 99999999.99 with two decimals (the column); package hours 1
to 999 (what a purchase row can hold); validity 1 to 3650 days; weekday 0 to
6 with opening before closing, at most 50 rules per call; booking and series
instants before the year 2100; admin list pages up to 1000000. No string may
carry a NUL byte, and an update may not set a required column to null.
Raising any of these is a one-line change; none is a product limit.
Finding (2026-09-18, input-validation audit), severity Medium: almost no request
field carries a bound, so over-long, out-of-range or otherwise unstorable input
reaches the database or date arithmetic and is answered with a server error
instead of 422. Some of it is reachable without an account, through the
rate-limited registration routes; most needs a customer or operator account.
Every failing transaction rolls back, so nothing is corrupted. A few accepted
operator values also break a later customer request. **Scope:**
`backend/app/schemas/*.py`, paging parameters in `backend/app/routers/admin.py`,
tests. **Acceptance:** every string has a length bound matching its column,
every number a range that fits its column and makes sense, NUL bytes and
explicit nulls for required columns are refused, dates have a generous upper
bound, and a sweep of hostile requests across anonymous, customer and operator
routes answers nothing at or above 500. The bounds are generous technical
limits that change no documented journey; the numbers are recorded here when
the fix lands. `extra="forbid"` belongs to the hardening phase.
**Validation:** a failing-first sweep test per audience, plus the full backend
suite.

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

### S19 — Data-exposure regression tests

**Priority: P2. State: MERGED (PR #51, `8441817`).**
Evidence (2026-09-18): `backend/tests/test_data_exposure.py` adds 6
real-PostgreSQL cases and all pass on the code as audited: public responses
carry exactly their published fields, availability is start, end and a
boolean, a customer's list nests nobody else's data, a door code reaches its
owner and that org's operators only, operators see customers through the
user schema, and an unhandled error answers without internals. A mutation
check proved the cases can fail: with a password hash on the user schema, an
extra slot field, the owner filter removed from "my bookings" and debug mode
on, five tests failed for those reasons, and the code was restored. Full
backend suite: 388 passed. The audit's findings are S20 and B41 below.
**Scope:** `backend/tests/test_data_exposure.py`; no application change.
**Why:** response schemas are the only thing between a new model column and a
public response, and nothing pins what each audience may see.
**Dependencies:** none. **Acceptance:** real-PostgreSQL tests pin the exact
fields of every public response and of the user data an operator sees; prove
that availability reveals nothing about who booked; that a customer's lists
never nest another person's data; that a door code reaches only its owner and
that org's operators; and that an unhandled error answers without internals.
A case that fails on main becomes its own item. **Validation:** pytest through
the `client` fixture, plus a mutation check.

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

### S27 — Regression tests for the contact form's Apps Script

**Priority: P1. State: MERGED (PR #52, `87c5211`).**
Evidence (2026-09-18): `flowspace-site/tests/code-gs.test.mjs` adds 38 cases
with Node's built-in runner and all pass on the script as committed. A
mutation check proved they can fail: with the visitor's name put back in
the subject, the control-character check skipped, the recipient read from
the request and the honeypot dropped, 26 of 38 failed, and the script was
restored. `Code.gs` itself is unchanged, and so is every published file.
**Scope:** `flowspace-site/tests/code-gs.test.mjs`; no change to `Code.gs` or
to the deployed site. **Why:** `apps-script/Code.gs` is the only enforcement
point of the public contact form, and it carries the header-injection fix from
PR #45, yet nothing executes it: the smoke spec covers the browser side with
the endpoint mocked. A regression there would be pasted into the live script
by hand, unnoticed. **Dependencies:** none; Node's built-in test runner, no
package. **Acceptance:** the file is loaded into a sandbox with fake Google
services, never the network, and tests prove that the recipient is constant,
that no free text reaches a header, that control characters in any field are
refused before a send slot is spent, that oversized and malformed bodies are
refused, that the honeypot sends nothing, and that the per-address and global
limits hold. **Validation:** `node --test`, plus a mutation check.

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

## Deferred scope

| ID | Previous work | Reactivation condition |
|---|---|---|
| D01 | Epic 6: RLS | Before onboarding another operator. Design policies for public reads, user-owned multi-org data and worker access; verify with a non-bypass DB role that omission of a route filter cannot leak data. Do not mechanically apply the old single-org setting design to every request. |
| D02 | Epic 9: further i18n | A product need after the single-location journey is reliable. Q29/Q30 only complete/dispose of existing marketing/layout work; full booking/admin translation is not implicitly authorized. |
| D03 | Additional multi-operator/multi-space UX | Explicit expansion decision; existing tenant isolation and org-cache correctness remain mandatory now. |
| D04 | B13: daily booking products/monthly recurrence | Explicit customer/product requirement; these are new products, not regressions of hourly or weekly booking. Owner decision 2026-09-19: hourly booking is the only product (C12); half-day, full-day, multi-date and monthly booking stay deferred, as do R02/R03/R99. |
| D05 | Epic 5: pagination beyond existing admin bookings | Demonstrated list growth. Q20 owns existing work; add further list coverage only when needed (O05's bounded audit listing is part of that task). |
| D06 | Admin handling of special requests (recurring arrangements, longer bookings, questions) raised through the booking contact note (C12) | Stub only. **Scope:** somewhere in the admin panel for an operator to see, answer and close requests that today arrive by email at the C09 contact address; tenant-scoped, no customer-facing request form implied. **Acceptance (to be written when reactivated):** an operator can list, read and resolve a request for their own organization only, with real-PG happy/failure tests and a Playwright admin flow. Reactivate on demonstrated request volume or an explicit owner decision; until then the mailbox is the process. |

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
