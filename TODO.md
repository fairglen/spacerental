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

**Customer payments/photos/help and operator tooling (2026-09-22):** by explicit
owner assignment, delivered unattended on two stacked branches that become two
PRs. **PR 1** `feat/customer-mixed-pay-photos-help` (from main `6218d6d`, with
`fix/smoke-findings` #46 and `feat/location-single-space-simple-booking` #54
already merged): C13–C19. **PR 2** `feat/admin-calendar-tools` (from the
finished PR 1 branch): A01–A07. Money-touching customer code stays separate
from operator tooling. Out of scope for both: refunds of any kind (there are
none in the product; nothing here builds, mentions or promises one — money
questions after a cancellation go to a person through the help form, C17/C18;
O02 stays as it is), recurring bookings (code stays, flag off), half/full-day
or monthly products, the audit log (O05), and any third-party service that
needs credentials in tests. The owner is not available during delivery: where
a decision was not given, the most conservative option that keeps existing
behaviour is taken, recorded under the task and tagged `DECISION:` in the
commit body. Commits stay local; the owner reviews and merges.

**Brand and copy revision (2026-09-22):** by explicit owner assignment on
`feat/flowspace-brand-copy` (from main `6e9ffa6`, after #55 and #57 merged):
the app is renamed FlowSpace where people can read it, the static site and the
app landing take the owner's source copy, the audience becomes "profissionais
de saúde e bem-estar", and customer/operator-facing Portuguese moves to the
formal register. Recorded as W01–W07 near the end of this file; the stale
static-site smoke suite it found first is B49. Opened as
[PR #58](https://github.com/fairglen/spacerental/pull/58) on the owner's
instruction; the owner reviews and merges.

**Booking rules, hour bank, photos and "Onde estamos" (2026-09-22, after
#58):** by explicit owner assignment, delivered unattended on two stacked
branches that become two PRs. **PR 1** `feat/booking-rules-hour-bank` (from
main `08e2916`): H01–H03 — a 30-day booking window for customers, pack hours
pooled into one bank with per-purchase debits, and the two real causes of the
admin "Alterar horário" failure. **PR 2** `feat/photos-mosaic-map-contacts`
(from the finished PR 1 branch): V01–V07 — the four illustrated room scenes as
a photo mosaic in the app and as card galleries on the static site, photos
instead of room descriptions, no hero pill, 08:00–22:00 every day, and one
"Onde estamos" block (location, contact, hours, centred map) on both sites.
Recorded as the H-series and V-series near the end of this file. Out of scope:
refunds, recurring bookings (code stays, flag off), half/full-day products,
and any price change — the 12€/15€/18€ on the static site versus 11€/h in the
app is queued as Q-H04, untouched. Decisions the owner did not give are taken
the conservative way, recorded under the task and tagged `DECISION:` in the
commit body. Opened on the owner's instruction on 2026-09-23 as
[PR #59](https://github.com/fairglen/spacerental/pull/59) (H01–H03, base
`main`) and [PR #60](https://github.com/fairglen/spacerental/pull/60)
(V01–V07, stacked on #59's branch — retarget to `main` once #59 merges);
the owner reviews and merges. Copilot's eight findings on #59 (2026-09-23)
were all valid and fixed in one commit: the move path's own
`expire_stale_holds` could flip the booking being moved while the ORM copy
still read `pending` (critical — double credit on shrink, orphan debits on
grow, the row written back as pending); the shrink credited purchases in
reverse draw order without first taking their locks in the walk's order
(deadlock); the operator's customer page read the bank without reconciling
lapsed holds; `package` labels used the duration instead of the debited
share after a partly covered growth (table, sheet, `formatBookingCost`);
the calendar asked for days past the window and showed the 400s as a load
error; `bookingWindowEnd` used calendar days (an hour off across DST); the
sheet's outcome copy read the duration delta rather than the pack-share
delta and keyed the split by text; `sala-04.svg`'s label said two armchairs.
Both merged 2026-09-23: #59 as `1aabcfe`, #60 as `9a497f7`.

**Local opening hours, landing parity and "Onde estamos" rework (2026-09-23,
after #60):** by explicit owner assignment, delivered unattended on two
stacked branches. **PR 1** `fix/local-opening-hours` (from main `9a497f7`):
R01's opening-hours slice — rules evaluated on the space's wall clock
(Europe/Lisbon for the pilot), small and separately revertible. **PR 2**
`feat/landing-parity-where-we-are` (from the finished PR 1 branch): the
owner named three sections — hero copy, static-site design parity, "Onde
estamos" rework, on both the app and the static site — but the assignment
text reached the loop truncated before their specification (see L02–L04
below), so they are recorded as blocked, not guessed at. Decisions the owner
did not give are taken the conservative way, recorded under the task and
tagged `DECISION:` in the commit body. Commits stay local; the owner reviews
and opens the PRs.

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

### C13 — Pack hours first, pay only the extra hours (`mixed` payment)

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help` (backend `0240817`, frontend in the next
commit), committed locally; DONE only once merged. **Evidence (2026-09-22):**
26 real-PG tests in `tests/test_mixed_payment.py` (the 7h+1h split and Checkout
amount/description; client numbers ignored; whole-block pack wins; soonest pack
pays the partial share; another org's pack untouched; confirm keeps hours;
stub cancel, lazy expiry via packs page / another customer taking the slot /
the next booking all restore them once; cancel of paid and unpaid restores 7
not 8 and moves no money; operator cancel + reinstate; pay-now re-debit and its
409; late money with and without hours, incl. a lapse nothing had noticed; two
bookings racing for one pack; revenue; CHECK constraint). Full backend 453
passed. Migration `0005_booking_mixed_payment`: upgrade → check → downgrade →
upgrade clean on an empty PostgreSQL 16, backfill and the lossy downgrade
verified against real `package` and `mixed` rows. Frontend: `lib/paymentSplit`
(mirror of the server rule, 12 unit tests), BookingModal breakdown + choice
(7 component tests; the old "hide the pack when it cannot cover the block"
test — the reported bug — now asserts pack-plus-money), dashboard/admin split,
API shape tests; Vitest 370. Playwright `pay-mixed.spec.ts`: fresh customer,
7h left, books 8h → modal breakdown → stub Checkout shows 11,00 € and
"1h Sala Brisa (7h pagas com o pack)" → dashboard "7h do pack + 11,00 €",
0h left; full suite 35 passed. **Known limitation:** hold expiry is lazy, so an
abandoned mixed hold's hours return when that customer (or anyone touching the
slot) next hits the API, not at the 15-minute mark; a sweeper is O-series work.
**Observed:** with a pack that has
7h left, booking 8h hides the pack option and charges all 8h. **Wanted:** the 7h
come out of the pack and the customer pays only the extra hour, shown clearly.

**Decision (recorded 2026-09-22 before implementation; items 1–5 are the
owner's, 6–9 are conservative choices made unattended):**
1. Keep `hourly` and `package`; add `mixed`. A booking stores
   `package_hours_used` (Decimal, default 0) next to `package_purchase_id`.
   For `mixed`, `total_amount` is the MONEY charged (uncovered hours × rate),
   so revenue keeps meaning money: it sums `hourly` and `mixed`. A `package`
   booking's `total_amount` stays what it is today (the slot's value, excluded
   from revenue); its `package_hours_used` is backfilled to its duration.
2. Hours are reserved (debited) when the mixed booking is created `pending`
   and restored whenever it leaves the held state without confirming: stub
   checkout cancel, lazy hold expiry, customer/admin cancel. Confirmation
   changes nothing about the hours. Same ledger module (`package_hours`), no
   fork: one "debit the first usable purchase" helper serves both the
   whole-block rule and the partial one.
3. One pack per booking, the soonest-expiring one that still has hours.
4. Cancelling a mixed booking follows the existing rules exactly: hours go
   back as a `package` booking's do; the money part is treated as an `hourly`
   booking's is. Nothing about money changes on cancel (no refunds exist).
5. `mixed` requires 0 < `package_hours_used` < duration. The server computes
   the split and ignores client numbers: remainder 0 → a plain `package`
   booking; nothing usable → a plain `hourly` one.
6. If ONE pack can cover the whole block, a `mixed` request becomes `package`
   against that pack (today's rule), even when a sooner-expiring pack holds a
   few hours. Charging money while a pack could pay for everything would be
   the wrong way round. Alternative: always take the soonest-expiring pack
   and charge the rest. Reverse: drop the whole-block attempt in
   `create_booking`.
7. "Holds its hours" is one predicate for every path: `pending`, `confirmed`
   and `completed` hold them; `cancelled`, `expired` and `paid_unfulfilled` do
   not. The admin status change used "cancelled or not"; under the single
   predicate an operator moving a pack-paid booking to `expired` or
   `paid_unfulfilled` now returns its hours too, instead of burning them
   silently. Alternative: keep two rules (a fork). Reverse: narrow
   `holds_package_hours()`.
8. Retrying an expired mixed hold ("Pagar agora") re-debits the same pack for
   the same hours; if the pack can no longer cover them → 409 and the hold
   stays expired (the customer books again and gets a fresh split). The split
   and the price of an existing booking are never recomputed.
9. Money arriving late for an expired/cancelled mixed hold (C03) confirms it
   only if the slot is free AND the same hours can be re-debited; otherwise it
   becomes `paid_unfulfilled`, as a lost slot does today, for a person to
   resolve. Expiry stays lazy (no sweeper): a lapsed hold's hours return the
   next time that customer's bookings, packs or a new booking are touched, or
   anyone touches the slot.

**Scope:** model + migration (`package_hours_used`, enum value), `POST
/bookings`, hold release, cancel, resume checkout, webhook, admin status change,
revenue, checkout description ("1h Sala Calma (7h pagas com o pack)"), admin
bookings table, `BookingModal` breakdown and payment choice, dashboard rows,
`lib/api.ts` + shape test, API_SPEC. **Dependencies:** C02, C03 (merged).
**Links:** O02 (no refunds here), O03 (revenue meaning). **Acceptance:** 7h pack
+ 8h booking → 7 used, 1h charged; abandon/expire restores 7h; confirm keeps
them; cancel restores per the existing rule; two concurrent mixed bookings
against one 7h pack → only one gets the hours; remainder 0 downgrades to
`package`; a client-supplied `package_hours_used` is ignored. **Validation:**
real-PG integration tests for each; component tests for the three modal cases;
Playwright: 7h pack, book 8h, stub checkout shows 11,00 €, dashboard shows the
split and 0h left.

### C14 — Image storage and upload behind a gateway

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally; DONE only once
merged. **Evidence (2026-09-22):** 28 real-PG + temp-dir tests in
`tests/test_media.py` (processing to 1600px/480px WebP; the client's filename
never reaches disk or URL; JPEG/PNG/WebP accepted by content whatever the name;
PHP/PDF/SVG/empty/GIF → 415; > 8 MB → 413; 11th → 409; EXIF/GPS/ICC stripped
from both files; orientation applied to the pixels before stripping; spaces;
public shape + file served as `image/webp`, PUT → 405; another org's admin →
403 / 404 identical to a missing id, no file written; member 403, anonymous
401; reorder = full permutation else 409; delete removes both files, second
delete 404; a backfilled external photo can be removed; upload rate tier →
429; an unimplemented `MEDIA_STORAGE` raises). The six routes are classified in
the S01 matrix (incl. its cross-org sweeps); S19's public field allowlist
declares `photos`. Migration `0006_photos` round trip clean, backfill verified
(order kept, `images` untouched). Full backend 481 passed. **Decisions:**
(1) `photos` (JSONB) is a NEW field and the source of truth for uploads;
`images` (external URLs) is left exactly as it was, so no API client sees a
change; existing URLs are copied into `photos` so nothing configured vanishes
from the carousel. Reverse: drop the column. (2) The database stores storage
KEYS and responses build absolute URLs from `MEDIA_BASE_URL`, so moving to a
bucket or another domain rewrites no rows. (3) Delete answers 200 with the
updated entity, not 204 — the client needs the new list and cover. (4) A new
`upload` rate tier (30/min) rather than reusing `auth`/`public`. (5) Found on
the way: python:3.12-slim has no WebP MIME type, so files were served as
`text/plain`; registered explicitly. **Scope:** `images` exists on Space and
Room and in the admin schemas but nothing writes it. A `MediaStorage` gateway
(`MEDIA_STORAGE=local` now: files under `MEDIA_ROOT`, served read-only at
`/media/…` by the API; a marked seam for S3/R2 later, no cloud SDK). `POST
/admin/rooms/{id}/images` and `POST /admin/spaces/{id}/images` (multipart, one
file, tenant-scoped lookup first), `DELETE …/images/{image_id}`, `PUT
…/images/order`. Validate by content with Pillow (jpeg/png/webp, else 415;
> 8 MB → 413; 11th image → 409). On upload: fix EXIF orientation, strip all
metadata, max 1600px long edge, WebP q≈82, plus a 480px thumbnail; random uuid
filenames. Stored as `{id, url, thumb_url, width, height}` objects with one
migration backfilling the old string shape. Uploads rate-limited with the
existing limiter. **Dependencies:** none. **Acceptance/Validation:** real-PG +
tmp-dir tests: happy path, wrong type, oversize, 11th image, cross-tenant 403
with no detail leak, metadata stripped, orientation fixed, reorder, delete
removes files; migration round trip; API_SPEC; `.env.example`/Compose so a fresh
checkout still comes up.

### C15 — Admin: manage photos and every customer-visible room field

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally. **Evidence
(2026-09-22):** `PhotoManager` (17 component tests: empty/grid/limit states,
"Capa" on the first only, reorder by buttons and by drag sending the full
order, a refused reorder keeps the list and says why, delete behind a confirm
step, client-side type/size refusal naming the file with no request, several
files sent one request at a time with a progressbar, every server error mapped
next to its file while the queue carries on, drop zone, only as many files as
fit); room edit dialog tests (description, amenities, active; an inactive room
is listed and can be switched back on; the Fotografias section); 3 API shape
tests. Vitest 394; admin Playwright spec 6 passed; a live upload → fetch
(`image/webp`, `nosniff`) → delete against the running stack. **Found and
fixed here:** the admin rooms page read rooms from the PUBLIC endpoint, which
hides inactive rooms — so a room an operator switched off vanished from the
admin and could never be switched back on. It now reads the operator's own
listing. **Decisions:** (1) never optimistic — the grid always shows the last
list the server returned; (2) the new-space page reveals the photo step after
the space is created (photos need an owner) instead of sending the operator to
find "Editar"; (3) plain `<img>`, not `next/image`, for operator-uploaded files
on the API's origin. **Limit to know:** deactivating a room here does not yet
check for future bookings — that check is A07 (PR 2). **Scope:** a "Fotografias" section on
the admin room edit page and the space new/edit pages: thumbnail grid, first =
"Capa", drag-to-reorder with move up/down buttons as the keyboard path, delete
with confirm, upload (button + drop zone, several files, one request at a time,
per-file progress and errors), client-side type/size checks with the API's
limits. Every customer-visible room field (name, description, capacity, hourly
rate, amenities, active) is editable. **Dependencies:** C14. **Validation:**
component tests (states, reorder, delete confirm, upload error); `lib/api.ts`
shape tests.

### C16 — Customer photo carousel, and seeded placeholder photos

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally. **Evidence
(2026-09-22):** `PhotoCarousel` — 16 component tests (0 photos → the given
placeholder and no region; 1 → no controls or indicators; 3 → prev/next + a
`tab` per photo labelled "Fotografia 2 de 3"; 5 dots vs "1 / 8" counter from 6;
ends disable the buttons; arrow keys; dot jump; the live region is empty until
the visitor moves it; nothing moves in 60 s of fake time; `behavior: 'auto'`
under prefers-reduced-motion; region role/roledescription/label, focusable,
icons `aria-hidden`; first image eager, the rest lazy, all with width/height;
thumbnails on cards vs full images on the page; 44px buttons; controls never
reach a surrounding click handler; a swipe is not a click, a tap still is).
Used by `RoomCard` (landing + space page, today's placeholder kept for zero
photos) and, full size, above the booking section. Seed: 2 real-PG tests — each
demo room gets 3 generated photos through the upload pipeline (WebP, no
metadata, distinct files); a re-seed adds none and leaves an operator's photos
alone. Playwright `photos.spec.ts` 2 passed: a landing card shows a decoded
image from `/media`, "next" selects the second dot and brings its image into
view without following the card's link, ArrowLeft goes back; the booking
section shows the full-size file. Vitest 410. **Found by looking at it:** white
dots vanished on light photos (now on a dark pill); the placeholder caption
drew hollow and Pillow's built-in font has no "é" (now ASCII on a dark band).
**Scope:** one `PhotoCarousel` (native
scroll-snap, no new dependency) on room cards and, larger, above the room's
booking section: fixed 4:3 frame, first image eager and the rest lazy,
thumbnails on cards; prev/next buttons (≥44px, "Fotografia anterior/seguinte"),
arrow keys, dots as a `tablist` up to 5 photos and a "2 / 8" counter from 6,
`role="region"` + `aria-roledescription="carrossel"`, no autoplay, controls
never trigger a surrounding card's navigation, one photo = no controls, zero =
today's placeholder, `prefers-reduced-motion` respected. The seed generates 2–3
small gradient PNGs per room with Pillow through the C14 storage (no binary
assets in git). **Dependencies:** C14. **Validation:** component tests for
0/1/3/8 photos, keyboard, dots vs counter, aria; Playwright: a landing card
shows a photo and "next" advances.

### C17 — Help / report a problem: support requests, dialog and email

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally. **Evidence
(2026-09-22):** 18 real-PG tests in `tests/test_support.py` (stored row and
receipt shape; email to `SUPPORT_EMAIL` = `geral@flowspace.pt` with Reply-To
the customer and subject "[Ajuda] Pagamento — #REF"; the message is never
echoed and is escaped in the HTML part; email required when signed out; bounds
incl. NUL and an unknown category; a visitor's `booking_id` ignored; unknown
context keys dropped; signed-in identity from the token not the body; own
booking attached and sets the org; someone else's booking = 404 identical to a
missing one; a bad token is 401, not an anonymous request; honeypot answers
like success and stores nothing; 5/hour → 429; a mail failure keeps the row).
Route classified PUBLIC in the S01 matrix. Migration `0007_support_requests`
round trip clean (downgrade drops its enum types too). Full backend 508.
Frontend: `HelpProvider` (one shared dialog, presets per opener) + `HelpDialog`
— 10 component tests (signed-out validation and success with the reference,
context captured, "O que enviamos" collapsed, failure keeps the message,
honeypot hidden from people; signed-in read-only email, upcoming bookings only,
presets from props; the provider opens it from anywhere). "Ajuda" in the
navbar (desktop + mobile, signed in and out) and footer. Vitest 420.
Playwright `help.spec.ts`: a visitor submits from the navbar → reference and
"Respondemos por email"; the row lands with the enrollment org resolved.
**Decisions:** (1) a present-but-invalid token is a 401, not a silent
anonymous request (an expired session must not drop the booking link);
(2) `org_id` resolves booking → the customer's only org → the enrollment org →
null, and a null-org row is emailed but listed for no tenant; (3) the app
version is baked in at build time from `NEXT_PUBLIC_APP_VERSION` or the git
commit. **Scope:** "Ajuda" in the navbar (signed
in and out) and footer opens a dialog (not a floating widget): Assunto
(Problema técnico / Reserva / Pagamento / Pack / Outro), Mensagem (20–2000),
Email (prefilled and read-only when signed in), optional upcoming booking, a
collapsed "O que enviamos" (URL, viewport, user agent, app version, timestamp,
user id). Initial category and booking come in as props. `POST
/support/requests` (optional auth) stores a `support_requests` row (org_id when
resolvable, user_id, category, message, contact_email, booking_id, context JSON,
status `new`) and emails `SUPPORT_EMAIL` (default `geral@flowspace.pt`, the C09
address) through the existing gateway with Reply-To = the customer, subject
"[Ajuda] <categoria> — #<short id>". Honeypot + the existing limiter, tight
(5/hour/IP). No screenshots. **Links:** this table IS the inbox D06 will read;
C09 (contact address). **Validation:** pytest: stored row, email stub called
with Reply-To, honeypot drop, rate limit, no cross-org read; component tests
for validation and signed-in/out variants; Playwright: a signed-out visitor
submits → success state with the reference.

### C18 — Cancellations and the contact note route to the help dialog

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally. **Evidence
(2026-09-22):** dashboard component tests — a cancellable hourly or mixed
booking keeps self-service cancel and gets one muted line below the buttons
("Questões sobre o valor pago? Fala connosco" → help, Assunto "Pagamento",
booking preselected), the dialog says nothing about refunds; a package booking
and an unpaid hold get no money line (nothing was paid for them); inside the
24h window Cancel stays disabled with C07's reason and "Precisas de cancelar?
Fala connosco" opens help on "Reserva" with the booking; the link is absent
when cancel is allowed. Contact note tests: "Fala connosco" opens help on
"Reserva", the address stays visible, no bare mailto. Catalog guard refuses
"cancelamento gratuito"/"free cancellation"/refund wording; PT+EN hero pill
and hourly-plan feature now read "Cancelamento até 24h antes" / "Cancel up to
24h ahead". Vitest 427. Playwright `help.spec.ts` (2): a signed-in customer
opens help from the cancel dialog of a paid booking, sees Assunto "Pagamento"
and the booking preselected, submits, gets a reference. **Decision (the
owner's default (a), kept):** >24h self-service cancel stays open for
money-paid bookings; only the muted line was added. **Scope:** (a) the C12 contact note's
"Fala connosco" opens the help dialog with Assunto "Reserva" instead of a bare
mailto; (b) the dashboard cancel dialog: for still-cancellable bookings keep
self-service cancel (C07 behaviour, pack hours restored as today) and add one
muted line "Questões sobre o valor pago? Fala connosco" → help dialog, Assunto
"Pagamento", booking preselected, saying nothing about whether money comes
back; inside the 24h window, where C07 disables Cancel with its reason, add
"Precisas de cancelar? Fala connosco" → Assunto "Reserva", booking preselected;
(c) landing copy "Cancelamento gratuito 24h antes" → "Cancelamento até 24h
antes" / "Cancel up to 24h ahead" (hero pill and hourly plan feature, PT + EN),
with no statement about refunds. **Dependencies:** C17. **Links:** C07, C12,
O02. **Validation:** component tests for both cancel variants and the note;
catalog guard; Playwright: cancel dialog → help → submit.

### C19 — Minimal operator inbox for support requests (`/admin/support`)

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/customer-mixed-pay-photos-help`, committed locally. **Evidence
(2026-09-22):** 6 real-PG tests (newest first with booking/room and the
list's fields; status filter and paging; reopen; another org lists nothing and
gets 403/404 on close; a null-org request is listed for nobody but still
emailed; a member gets 403); both routes classified OPERATOR in the S01
matrix. Page: 5 component tests (list columns, message and context shown as
text — an `<img>` payload renders as text —, close/reopen, status filter,
empty state) + 2 API shape tests; sidebar entry "Pedidos de ajuda". Vitest
434. Playwright `admin-support.spec.ts`: the admin sees the visitor's and the
customer's requests, the customer's with its room and time, opens one, closes
it. **Scope:** `GET /admin/support/requests`
and a status toggle (new/closed), admin of that org only; a list page (newest
first: category, email, excerpt, linked booking, status). Full handling stays
deferred in **D06**, which this delivers the first slice of. **Dependencies:**
C17. **Validation:** real-PG happy/failure + cross-org denial; `lib/api.ts`
shape test; component test; Playwright: the admin sees the visitor's request
with its booking reference.

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
slice stays parked with R02/R03 (code untouched, flag off). **Evidence (#61,
2026-09-23, commit `9892851`):** 10 real-PG tests in
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

## Operator tooling (A-series) — owner assignment 2026-09-22 (PR 2)

Branch `feat/admin-calendar-tools`, created from the finished PR 1 branch. Not
part of the outcome gates above: assigned directly by the owner. Every endpoint
does its tenant-scoped lookup first and uses `require_admin`. No charge, credit
or refund is ever created by an operator action (O02 owns money movement; O05
owns the audit trail — neither is started here). **Links:** B46 (operators had
no action on a confirmed booking) and B43 are answered by A01/A03.

**Integrated verification (2026-09-22, final branch state `a48e81b`, stub
mode, no credentials, isolated stack rebuilt from an empty database):** backend
pytest 595 passed (516 at PR 1's HEAD); `alembic upgrade head` → `check` →
`downgrade -1` → `upgrade head` → `downgrade base` (no tables or enum types
left) → `upgrade head` → `check` clean through `0010_purchase_amount_paid`;
`tsc` clean; Vitest 471 (434 at PR 1's HEAD); `next build` OK; full Playwright
43 passed with the recurrence flag off AND 43 passed with it on (PR 1's 40 plus
`admin-calendar`, `admin-users`, `admin-room-active`); `npm audit` unchanged at
21. Section 3's own end-of-section Playwright run had failed for an
environment reason (the loop stack's backend container was gone); this final
run on a fresh stack covers it.

### A01 — Operator booking management API

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Evidence (2026-09-22):** 23
real-PG tests in `tests/test_admin_booking_management.py` — reschedule (paid
booking moved, one "alterada" email with the new Lisbon time, `hours`
before/after; a longer duration moves no money and mints no session; move to
another room; another org's room = 404; no 24h rule but the same past/closed/
conflict checks; another org's admin = 404 and nothing moves; a plain status
change still works); manual booking (confirmed with code and email; the
customer must be a member; same conflicts; the customer API rejects `manual`
with 422; another org = 404); mark-paid (pending hourly → confirmed `manual`,
session expired at the provider, reason appended to the note; a late webhook
after it stays single-confirmed with no second email; a mixed hold keeps its
pack share; confirmed/package/cancelled → 409; empty reason 422; another org
404); admin note (set by the operator, never in `/bookings/me` nor the
resume-checkout response, a customer cannot write it, the operator list shows
it); admin cancel restores pack hours and frees the slot through the shared
ledger rule. Routes classified in the S01 matrix. Migration
`0008_admin_booking_tools` round trip clean. Full backend 541. Frontend: types
+ "Pago no local" label (Vitest 435). **Found on the way (would have shipped
a real bug):** narrowing the customer schema to a `Literal` of strings made the
router's enum identity checks always true, so every customer booking took the
pack path — caught by C13's tests; the router now converts at the boundary.
**Known limitation (by the owner's instruction):** a duration change on a paid
booking creates no charge or credit; `hours` is returned and the operator
settles it with the customer outside the platform. **Decision:** mark-paid
clears the row's session id after expiring the session, which is what makes a
late webhook unable to match it (the webhook looks up by session id).
**Scope:** `PUT /admin/bookings/{id}`
also accepts `start_time`/`end_time`/`room_id` (same org; same validity and
conflict checks as a customer booking, EXCLUDE race included; no 24h rule for
admins); a duration change on a paid booking moves no money — old and new hour
counts are returned and the admin settles outside the platform (known
limitation); the customer gets the confirmation email with one added line "A
tua reserva foi alterada". `POST /admin/bookings` for an org member with
payment method `manual` ("paid or arranged outside the platform"), optional
`admin_note`, confirmed at once with access code and email. `manual` is
admin-only: the customer `POST /bookings` rejects it. `POST
/admin/bookings/{id}/mark-paid` (pending hourly/mixed → confirmed `manual`,
reason required, open checkout session expired so a late webhook cannot
double-confirm). `admin_note` (Text) never returned by customer endpoints.
Admin cancel shares the customer cancel code path. **Dependencies:** C13.
**Validation:** each endpoint happy/failure, cross-tenant 403/404, `admin_note`
never leaks, manual booking gets a code and an email, customer `manual`
rejected, mark-paid then late webhook stays single-confirmed, reschedule email
sent once; enum + column migration round trip.

### A02 — Blocked time (`room_blocks`)

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Evidence (2026-09-22):** 18
real-PG tests in `tests/test_room_blocks.py` (CRUD with `created_by`; windowed
listing; bounds incl. naive datetimes, empty reason, > 31 days; a block may
start in the past but not end there; another org's admin → 403/404 on every
verb, a member → 403; the public calendar hides the hours; a customer cannot
book into, across or over a block but can at its edge; an operator cannot move
or create a booking into one; a reinstated booking cannot land on one; a block
over a held booking → 409 listing it; cancelled/expired bookings do not stand
in the way; moving/extending a block is checked too; the EXCLUDE constraint
refuses overlapping blocks and the API reports the race as 409). Routes
classified in the S01 matrix incl. its cross-org room sweep. Migration
`0009_room_blocks` round trip clean; `room_blocks_no_overlap` verified present
after migration (invisible to `alembic check`, like the bookings one). Full
backend 563. **Decision:** blocks enter `has_conflicting_booking`, the ONE
conflict check every booking path already uses, rather than each path
checking separately. A 31-day cap per block (create several) is a technical
bound, not a product rule. **Scope:** `room_blocks` (org_id,
room_id, start, end, reason, created_by) with the bookings' overlap EXCLUDE
pattern; blocks count as unavailable in `/rooms/{id}/availability` and in every
booking conflict check (customer and admin); CRUD under
`/admin/rooms/{id}/blocks`; a block over a slot-holding booking → 409 listing
it (no silent overrides). **Validation:** block vs booking conflicts both
directions, cross-tenant, migration round trip with a constraint test.

### A03 — Admin calendar (`/admin/calendar`)

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Evidence (2026-09-22):**
`BookingSheet` + `MoveConfirm` — 13 component tests (what the sheet shows incl.
the customer link, mixed/manual payment lines; Confirmar; Marcar como pago
with a required reason; Cancelar with reason + confirm step; Alterar horário
sending room/time and reporting `hours` before → after with the settle-outside
note; a 409 shown inline; Guardar nota; linked support requests; the popover
describes the move, calls the API only on "Mover", Escape/"Não mover" do
nothing, a resize names the hour change, a refusal stays inline). 7 API shape
tests. Playwright `admin-calendar.spec.ts`: day-by-room with a column per
room; click the seeded booking → cancel from the sheet; a manual booking
created on an empty 14:00 slot through "Nova reserva" (customer picker, note)
and shown with its "local" tag; an hour blocked through "Bloquear horário";
`GET /rooms/{id}/availability` then reports 14:00 and 16:00 taken and 10:00
free again. Drag-to-move exercised live in Chromium: the popover appears, the
booking is NOT moved until "Mover" (verified via the API mid-drag), then lands
where dragged. Vitest 454; `next build` OK (`/admin/calendar` static).
**Found by running it:** (1) the sheet reset its status line on every fresh
copy of the same booking — now only when a different booking opens; (2) the
new-entry dialog kept its first slot's times — now keyed per picked slot.
**Decisions:** (1) the vertical range is 07:00–22:00 with 08–20 shaded as the
seed's opening hours, not the rooms' union (the availability rules are per
room and the page would need one more query per room; queued as a follow-up
under A03 residuals); (2) the customer picker reads the existing
`/admin/users`, which lists only customers who already booked — A05 upgrades
it to members; (3) `resources` are the space's active rooms in the day view,
and a block shows as a hatched event with a small sheet (remove/close) rather
than the full booking sheet. **Residuals:** opening-hours union per room;
keyboard drag alternative is the sheet's "Alterar horário" (as specified).
**Scope:** react-big-calendar with
`resources` and its drag-and-drop addon. "Dia por sala" (a column per active
room) and "Semana" for one room; status shown by colour AND text; cancelled
hidden behind a toggle; blocks hatched; a right-side sheet per booking with
every A01 action; drag/resize open a confirm popover before any write (never
optimistic on money-bearing objects); click/drag on empty space → "Nova
reserva" (manual) or "Bloquear horário"; view/room/date in the URL; below
1024px a read-only agenda. **Dependencies:** A01, A02, A05 (customer link).
**Validation:** component tests for the sheet actions and the move-confirm
popover; Playwright as admin: open, cancel the seeded booking, create a manual
booking, block an hour, and the customer calendar shows both unavailable.

### A04 — Operator capability audit ("god mode")

**Priority: P1. State: DONE (docs, 2026-09-22)** — the walk of the customer
journey below; each state an operator may need to change and cannot today,
with a priority and whether PR 2 delivers it (A01–A03, A05–A07) or it is
queued as a new item. Reviewed against the API as it is on
`feat/admin-calendar-tools` after A03.

| Area | What the operator cannot do today | Priority | Disposition |
|---|---|---|---|
| Users | See one customer's bookings, packs and help requests in one place; the list has no search or pages and lists only people who already booked | P1 | **A05** (this PR) — done: `/admin/users` (members, search, pages) and `/admin/users/{id}` |
| Users | Promote/demote an org admin from the UI (`promote_admin.py` is a script; no demote at all; no "cannot demote yourself" rule) | P1 | **A05** (this PR) — done: `PUT /admin/users/{id}/role`, self and owner refused |
| Users | Grant complimentary hours | P1 | **A05** (this PR) — done: a purchase row at 0,00 € with a reason, so reports still add up |
| Users | Deactivate/ban a customer, or reset their password | P3 | **Q-A08** queued: needs a policy on what happens to their future bookings; no self-service reset exists either |
| Packages | Extend a purchase's expiry; see remaining hours per purchase; see a customer's purchase history | P1 | **A06** (this PR) |
| Packages | Refund/cancel a purchase, or move hours between purchases | P3 | O02 (money) — not here |
| Rooms | Activate/deactivate with a check for future confirmed bookings | P1 | **A07** (this PR); C15 already exposes the flag without the check |
| Rooms | Opening hours: the editor covers one window per weekday; a lunch break (two windows) or a one-off closure has no UI (blocks cover the latter, A02) | P2 | **Q-A09** queued: multi-window rules in the editor |
| Rooms | Delete a room outright (only deactivate) | P3 | deliberately absent: bookings reference it |
| Bookings | Reschedule/move, create for a customer, mark as paid, private note, block time | P1 | **A01, A02, A03** (this PR) |
| Bookings | Refund a paid booking after an operator cancel | — | O02; the calendar's cancel says "nada é devolvido aqui" |
| Bookings | Change a booking's customer (re-assign) | P3 | **Q-A10** queued; workaround: cancel + manual booking |
| Payments | See the Stripe Checkout Session id / payment status for a booking or purchase; a link into the Stripe dashboard | P2 | **Q-A11** queued: read-only exposure of `stripe_checkout_session_id` in admin responses (customer responses must never carry it) |
| Payments | Reconcile revenue vs. refunds | — | O03 |
| Support | Answer from the inbox, assign, history | P2 | D06 (C19 is the first slice) |
| Settings | Contact/support email, hold expiry, enrollment org, rate limits are env vars; no per-org settings UI | P2 | **Q-A12** queued: an org settings page over `organizations.settings` (JSONB, unused today) for the values that are per-tenant (support email, hold minutes); env stays for deployment-wide ones |
| Settings | Access codes: see/revoke a customer's door code by hand | P2 | O04 (durable lock state first) |
| Spaces | Deactivate a space with active future bookings | P2 | **Q-A13** queued: same check as A07, at space level |
| Audit | Who did what (every table above) | P2 | O05 |

New queued items from this audit (recorded, not started): Q-A08 customer
deactivation/reset, Q-A09 multi-window opening hours, Q-A10 re-assign a
booking, Q-A11 payment session visibility, Q-A12 per-org settings page,
Q-A13 space deactivation check. **Scope:** walk the customer
journey and list every state an operator may need to change and cannot today
(users, packages, rooms, bookings, payments, support requests, settings), each
with a priority and whether PR 2 delivers it or it is queued.

### A05 — Users: list, customer page, admin role, complimentary hours

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Scope:** `/admin/users`
searchable and paginated; a user page with bookings, package purchases and
support requests; "Tornar admin / Remover admin" per org with confirm (cannot
demote yourself); "Atribuir horas": a package purchase of N hours at 0,00 €
with a reason. **Links:** `promote_admin.py` (script only today), D05
(pagination). **Validation:** per endpoint happy/failure/cross-tenant; UI
confirm-step tests.

**Policy (recorded):** complimentary hours are a purchase row with
`amount_paid = 0` and an `admin_note`, not a separate balance. The customer's
packs page, the redemption ledger, cancellation credits and any revenue report
treat them exactly like a bought pack; `amount_paid` is what tells them apart.
`user_package_purchases.amount_paid` is new (migration `0010`): a paid purchase
copies the package's price at purchase time, and existing rows are backfilled
from their package's current price (all of them were bought through checkout —
granting did not exist before this migration).

**DECISIONS (conservative; each reversible in one commit):**
- **The users list is the org's members, not "people who booked".** The old
  `GET /admin/users` listed customers with at least one booking; the admin
  audit (A04) called that out. Members with zero bookings (just signed up,
  granted hours only) are the ones an operator most needs to find. The
  operator's own account and other admins appear too, with their role. Alt:
  keep "booked only" — reverse by adding a join on bookings to the list query.
- **`role` accepts `admin` and `member` only; an owner is untouchable here**
  (422 for `owner`, 409 when the target is an owner, 409 for yourself).
  Ownership transfer is a different decision (billing, deletion) and stays
  out. Alt: allow owner→admin by another owner — a two-line change.
- **A granted purchase's expiry defaults to `now + package.validity_days`;**
  an explicit `expires_at` (future, tz-aware) overrides it. The hours are
  bounded 0 < h ≤ 999 (the column's ceiling) and the reason is required
  (1–2000 chars). The purchase is `active` at once (nothing to pay).
- **The `admin_note` is the reason verbatim** (no "granted by X" suffix — who
  did it belongs to the audit log, O05). The note never reaches a customer
  endpoint (`UserPackagePurchaseOut` does not carry it; `AdminPurchaseOut`
  does). Customer endpoints do expose `amount_paid` (it is their own money).

**Evidence (2026-09-22):** `tests/test_admin_users.py` — 15 tests (list:
members incl. the operator, search by name/email case-insensitive, paging,
`bookings_count`, tenant isolation; detail: bookings with room, purchases with
package, support requests, non-member and other-org 404; role: promote,
demote, self 409, owner 409, `owner` 422, other org 403/404; complimentary
hours: 201 with `amount_paid == "0"`, note, default and explicit expiry,
active and spendable, bounds 422/400, unknown/foreign package 404, non-member
404; a paid purchase records `amount_paid == package.price`). S01 matrix and
S19 allowlists extended for the four routes (`ORG_USER_FIELDS`). Frontend:
`RoleDialog` + `GrantHoursDialog` — 6 component tests (confirm step before a
role changes, destructive demote, cancel/errors; what "Atribuir horas" sends,
refuses without a reason or with 0 hours, explicit date as end of day); 4 API
shape tests; the calendar's customer picker now searches server-side.
Playwright `admin-users.spec.ts`: register a customer → search in
`/admin/users` → open → "Atribuir horas" 3h with a reason → the packs table
shows "3h de 3h · Oferta · reason" → `GET /packages/me` as the customer shows
`active`, `hours_remaining 3.00`, `amount_paid 0.00`, no `admin_note` → "Tornar
admin" opens the confirm and cancels cleanly. Migration `0010` round trip
pending the PR 2 wrap-up run.

### A06 — Package purchases: extend validity, see remaining hours

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Scope:** "Prolongar validade"
(new expiry date, reason) and remaining hours per purchase visible to the
admin. **Validation:** happy/failure/cross-tenant; component test.

**DECISIONS (conservative; each reversible in one commit):**
- **Extending only.** `PUT /admin/purchases/{id}/expiry` accepts a date later
  than the current expiry and in the future (400 otherwise). A lapsed pack may
  be brought back — that is the usual reason. Shortening is refused because it
  takes something the customer paid for; if ever needed it is a one-line
  relaxation of the check. Alt: allow any future date.
- **Only `active` purchases** (409 for `pending`/`cancelled`): an unpaid
  purchase has nothing to extend and a cancelled one is not a balance.
- **The reason is appended to `admin_note`, dated** (`[YYYY-MM-DD] Validade:
  old → new. reason`), so the row tells its own story until O05. The customer
  sees the new date and never the note.
- Remaining hours per purchase were already on the A05 customer page
  (`hours_remaining de hours_total`); A06 adds "caducou" on a lapsed active
  pack and the "Prolongar" action per active row.

**Evidence (2026-09-22):** `tests/test_admin_purchases.py` — 7 tests (extend a
live purchase and keep the reason on the note, customer sees the date not the
note; bring back a lapsed one; refuse shortening and the past (row unchanged);
409 for cancelled/pending; 422 for a blank reason, a naive datetime, a missing
date; unknown id 404 and a foreign `org_id` never a hint; a customer 403). S01
matrix: route classified, and a cross-org sweep (`test_user_and_purchase`)
proving A's operator gets 404 on B's user and purchase with nothing changed.
Frontend: `ExtendValidityDialog` — 3 component tests (sends end-of-day ISO +
reason; refuses a date ≤ current expiry and an empty reason; says "já
caducou"); 1 API shape test. Playwright `admin-users.spec.ts` extended: after
granting 3h, "Prolongar" by a year → the note shows in the packs table and
`GET /packages/me` carries the later date.

### A07 — Room activate/deactivate with a future-bookings check

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/admin-calendar-tools`, committed locally. **Scope:** activate/deactivate
from the room page; deactivating a room with future confirmed bookings → 409
listing them. **Validation:** happy/409/cross-tenant; component test.

**DECISIONS (conservative; each reversible in one commit):**
- **The check lives in `PUT /admin/rooms/{id}`** (the field the edit form
  already sent), not in a new endpoint — so the "Sala ativa" checkbox cannot
  bypass it. The room page gets a dedicated "Desativar / Ativar" button with a
  confirm step, and the same 409 is shown in the edit form as a one-line
  message.
- **"Future bookings" = rows that still hold a slot** (`holds_slot`:
  `confirmed`, and `pending` while its hold is alive) ending after now. A
  lapsed hold, a cancelled/expired booking, and anything already over do not
  block. Alt: `confirmed` only — a live unpaid hold would then be confirmable
  by webhook on a room that is off.
- **The 409 lists the soonest 20 with the true `total`**, with the customer's
  name/email, so the operator can go move or cancel them in the calendar.
  Only `is_active: true → false` is checked; other edits on a room with future
  bookings save normally; reactivating is always allowed.

**Evidence (2026-09-22):** `tests/test_room_activation.py` — 5 tests (no future
bookings → inactive and off the public space page, with past and cancelled
rows ignored; refused with the future bookings listed soonest-first incl. a
live pending hold and excluding a lapsed one, room untouched and still public;
other fields still save; reactivation always allowed and bookable again; the
list is capped at 20 while `total` is 25). Cross-org 404 is covered by the
S01 matrix sweep on `PUT /admin/rooms/{room_id}`. Frontend:
`RoomActiveDialog` — 3 page tests (confirm step sends only `is_active`; a
409 renders the list with "por pagar" and "e mais N" and offers no confirm;
reactivate from the card). Playwright `admin-room-active.spec.ts`: a manual
booking 20 days out → "Desativar" refused with the booking listed → cancel it
→ off, gone from `GET /spaces/{id}` → on again, back.

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
Copy revision of the published page (hero, "O espaço", audience, brand line)
is W01 below; the deploy workflow publishes it on the merge to main.

### B49 — The flowspace-site smoke suite is stale since the real Apps Script URL landed

**Priority: P2. State: IN PROGRESS** on `feat/flowspace-brand-copy` (found as
the W-series baseline, 2026-09-22). **Evidence:** `0fc2c10` — the rewrite matches
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

## Brand and copy revision (W-series) — owner assignment 2026-09-22

Branch `feat/flowspace-brand-copy` from main `6e9ffa6` (#46, #54, #55, #57 all
merged, so nothing older was pending). One commit per step;
[PR #58](https://github.com/fairglen/spacerental/pull/58), which the owner
reviews and merges. Source copy, decisions and the step order come
from the owner's assignment; anything it did not decide is taken the
conservative way, recorded under the task and tagged `DECISION:` in the
commit body. Nothing here touches prices, adds photos or door signs; the two
business items the source raised are W06/W07, queued for the owner.

**Integrated verification (2026-09-22, final branch state `297dc4c`, stub mode,
no credentials, isolated stack rebuilt from an empty database):** backend
pytest 598 passed (596 on main); `alembic check` clean at
`0010_purchase_amount_paid` (no schema change in this branch); ruff clean;
`tsc` clean; Vitest 475 (471 on main); `next build` OK; full app Playwright
43 passed on the freshly seeded stack (auth, booking, help, locale and
week-view specs re-pointed at the catalogs / formal strings); flowspace-site
smoke 22 passed (3/21 on main, B49) and Code.gs 38 passed; `npm audit`
unchanged at 21. Screenshots and the before/after copy tables are in
`PR_DRAFT.md` (uncommitted).

**Baked-in decisions (each reversible on its own commit):** BRAND — the app is
called FlowSpace wherever a customer or operator can read it; internal
identifiers (repo, npm/Python package names, DB names, env var names, Compose
service names, storage keys, migration files) keep their names. AUDIENCE —
"profissionais de saúde e bem-estar" replaces "psicólogos, terapeutas e
profissionais de saúde" / "psicólogos e psiquiatras" wherever the audience is
named, PT and EN. TERMINOLOGY — "gabinete(s)" appears only where the source
copy uses it (brand line, hero subtitle, "O espaço"); the product object stays
"Sala/Salas" everywhere in the UI. REGISTER — customer- and operator-facing
Portuguese moves to the formal register ("o seu/a sua", 3rd-person verbs,
never "você"), done last as W05 with one commit per surface.

### W01 — Static site copy (`flowspace-site/`)

**Priority: P2. State: IN PROGRESS** — `727988e` (copy) + `04a448e` (register,
W05a). **Evidence (2026-09-22):** preview renders; site smoke 22 passed; Code.gs
38 passed; heading order h1→h2→h3 intact; room cards, form options and Code.gs
untouched. Conversion line "Reserva à hora, sem contratos nem compromissos."
(DECISION: no online-booking promise — the site's only conversion path is the
contact form, B32). No OG/Twitter tags existed and none were added. Links F01
(this is the published page).
**Scope:** `index.html` H1 → "O seu espaço, no seu tempo." keeping the `<em>`
on "espaço"; hero lede → the source subtitle + support line, keeping the
hero badge and one conversion line; "O espaço" → the two source paragraphs;
audience wording in `<title>`, meta description and footer tagline; the brand
line "FlowSpace · Gabinetes profissionais" as the `<title>` suffix on both
pages; no layout, dependency or logo changes; `Code.gs` only if it names the
audience. `smoke.spec.ts` loosens its two H1 string pins to structure.
**Validation:** `python3 -m http.server` preview renders; the site smoke suite
green; `node --test flowspace-site/tests/code-gs.test.mjs` green. The Pages
workflow deploys on the merge to main (paths filter) — nothing to do now.

### W02 — App brand: EspaçoHora → FlowSpace

**Priority: P2. State: IN PROGRESS** — `d8ac677`. **Evidence (2026-09-22):**
`grep -ri espaçohora/espacohora` leaves only the three "formerly" notes, this
file's history, the `espacohora.*` storage-key identifiers (kept: renaming them
resets every visitor's saved locale/calendar view) and a negative test
assertion; Navbar/Footer tests prove the brand comes from `brand.name`;
test_email pins the customer sign-off and its absence from the support
forward; titles on the dev stack "FlowSpace · Gabinetes profissionais",
"Salas · FlowSpace", "Entrar · FlowSpace", "Criar conta · FlowSpace",
"Painel de Admin · FlowSpace" (admin chrome moved to
`components/admin/AdminShell.tsx` so a server layout carries the title);
`/icon.svg` linked. **Scope:** every customer/operator-visible
"EspaçoHora" in `frontend/` (Navbar, Footer, admin layout, sign-in/sign-up,
root metadata, i18n copyright) reads a single `brand.name` catalog key; the
`<title>` pattern becomes "<page> · FlowSpace" with the new audience in the
description; the static site's `favicon.svg` becomes the app favicon; email
sender default `FlowSpace <no-reply@flowspace.pt>` in `config.py`,
`docker-compose.yml`, `.env.example` (comment: verify the domain at the
provider before live mode); email templates gain the brand sign-off; the stub
checkout page and README/CLAUDE.md/AGENTS.md/roadmap say FlowSpace with a
one-line "formerly EspaçoHora" note. Not renamed: repo, package names, DB and
env var names, Compose services, workflow names, migrations, storage keys.
**Validation:** LocaleSwitcher test updated; a component test that the
Navbar/Footer brand comes from the catalog; no case-insensitive
"espacohora"/"espaçohora" left outside git history, the "formerly" note and
identifier names; email tests green.

### W03 — App landing copy

**Priority: P2. State: IN PROGRESS** — `55001d8` (+ `94bae62` register, W05b).
**Evidence (2026-09-22):** Hero test asserts headline/subtitle/support/pills from
the catalog; TheSpace test asserts a labelled `#o-espaco` region with an H2 and
two paragraphs; LocaleSwitcher and the auth/locale Playwright specs compare
against the catalogs; i18n parity + B32 promise checks green; screenshots in
`PR_DRAFT.md`. DECISION: "O espaço" sits after the rooms section and before
"Como funciona" because "Onde estamos" is rendered inside SpaceCards. The old
subtitle's online-booking sentence survives as a fourth pill. **Scope:** Hero
H1/subtitle/support line
from the source, pills and both CTAs kept; a new "O espaço" section (two
source paragraphs, same visual language, no image); audience wording in the
value props, "Como funciona", pricing subtitle and footer tagline; EN catalog
translated for every changed/added key. Landing pricing and feature claims
untouched. **Validation:** Hero/Footer component tests assert structure and
links; `i18nCatalogs` parity and B32 promise checks green.

### W04 — Seed and demo content

**Priority: P3. State: IN PROGRESS** — `a92782c`. **Evidence (2026-09-22):**
`TestSeed` real-PG tests: fresh seed writes the new texts, a re-seed refreshes
seed-written texts and keeps an operator's own, no duplicates (35 passed in
`test_space_location.py`); re-seeding the running dev stack rewrote existing
rows, read back through `/api/v1/spaces`. Room lines use only facts the
marketing site states per room. **Scope:** demo space description →
one sentence consistent with "O espaço"; each room description → a short
factual line; names, capacities, prices and hours unchanged; the seed keeps
updating rows it wrote before (previous-text sets, as the location does).
**Validation:** the `TestSeed` real-PG tests extended for the description
rewrite; no test pins the old text.

### W05 — Formal register on every customer- and operator-facing surface

**Priority: P2. State: IN PROGRESS** — six commits, see the DECISION below.
**Evidence (2026-09-22):** marker grep per surface leaves only third-person
statements about a room/photo/series ("volta a aparecer", "aguarda
confirmação"), EN strings and identifiers; every prose pin updated with its
assertion intact (ContactNote, DashboardPage, BookingModal, HelpDialog,
httpError, PhotoManager, AdminUsersParts, help/week-view Playwright specs);
test_email pins "Responda a este email". Done last, one commit per surface so it
can be reverted alone: (a) static site, (b) app landing + auth pages, (c)
customer dashboard, booking dialogs and errors, (d) emails, (e) admin UI, (f)
the CLAUDE.md/AGENTS.md rule. Informal → formal ("tu/teu/tua/tens/podes/clica/
regista-te/reserva (imp.)" → "o seu/a sua/tem/pode/clique/registe-se/
reserve"), same sentence length, meaning and placeholders; "Olá, {name}"
stays; EN untouched; "você" never written. **Validation:** a marker grep after
each surface with only identifiers, EN strings or history left; every test
that pinned prose updated with its assertion intact. **Reversal recipe:**
revert the six commits of this task (SHAs recorded in `PR_DRAFT.md`) — no
other commit depends on them.
**DECISION (2026-09-22):** CLAUDE.md/AGENTS.md had no literal "informal tu"
sentence to replace; the register rule is added under §9 Frontend next to
the "All UI copy is Portuguese" rule, worded as the owner gave it. The six
commits: (a) static site `04a448e`, (b) landing + auth `94bae62`, (c)
customer dashboard/booking/errors `83961a3`, (d) emails `fe2b77c`, (e)
admin UI `0355cab`, (f) this rule — revert them in reverse order to restore
"tu" everywhere; W01–W04 do not depend on them (the source hero/"O espaço"
copy is formal by the owner's text and stays either way).

### W06 — Per-room pricing (business)

**Priority: P3. State: QUEUED — owner decision.** The source copy lists prices
per room as an open item. Not touched here: no price changes in W01–W05.

### W07 — Price review (business)

**Priority: P3. State: QUEUED — owner decision.** The source copy asks for a
review of the price list. Not touched here.

## Booking rules, hour bank, admin fix (H-series) — owner assignment 2026-09-22 (PR 1)

Branch `feat/booking-rules-hour-bank` from main `08e2916` (#58 merged). One
commit per task, in the order H01 → H02 → H03; the owner opens the PR. Backend-
heavy and money-touching, so it stays separate from PR 2's photos and copy.
Binding as always: tenant scoping, `require_admin` per org, wrapped responses
extracted in `lib/api.ts`, Decimal money, formal-register Portuguese, an
Alembic migration for every schema change, never weaken a test or a rate limit.
**Links:** C13 (mixed payment and the ledger this extends), A01 (the admin
reschedule this fixes), C07 (the 24h cancel rule, which stays as it is), C05
(the API-side validity checks the window joins).

**Integrated verification (2026-09-23, final code state `dd842e7` plus the
one-word register fix in the evidence commit, stub mode, no credentials,
isolated stack rebuilt from an empty database):** backend pytest 635 passed
(598 on main); `alembic upgrade head` → `check` → `downgrade -1` → `upgrade
head` → `downgrade base` (no tables or enum types left) → `upgrade head` →
`check` clean through `0011_booking_package_debits`; ruff check + format
clean; `tsc` clean; Vitest 507 (475 on main); `next build` OK; full app
Playwright 46 passed (43 on main + `booking-window`, `hour-bank`,
`admin-reschedule`) on the freshly seeded stack, after the two new
public-heavy specs were paced at their file boundaries (B18: `booking-window`
waits before and after, `hour-bank` before) and `admin-reschedule` moved to
a fresh customer so the seeded admin's packs, which `packages.spec` reads,
stay as found; flowspace-site smoke not re-run (nothing under
`flowspace-site/` changes here but the image files; 22/22 on the baseline).
Screenshots in `pr-screenshots/` (uncommitted): the bank card with two
packs, the modal breakdown "− 5h (de 2 packs)", the sheet after shortening
a 9h pack booking. `PR1_DRAFT.md` (uncommitted) has the per-section summary,
the decisions with reversals, the open questions (Q-H04 prices, Q-V08 real
photos, H01 granularity, `balance` org scope, hourly growth) and the local
reproduction commands. Found by the screenshot: the booking modal's
description still read "Revê…" (informal, missed by W05c) — now "Reveja…".

### H01 — Booking window: customers book at most 30 days ahead

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/booking-rules-hour-bank`, committed locally; DONE only once merged.
**Evidence (2026-09-22):** 10 real-PG tests in `tests/test_booking_window.py`
(the last instant of the window, now + 30 days exactly, is bookable and one
hour later is refused with `start_time is beyond the booking window`; the
window is checked before opening hours so a far-off Sunday names the rule
that applies; the setting moves the boundary; an operator creates and moves a
booking a day past it; availability on the last day marks the hours after the
instant `beyond_window`; past/booked/blocked each carry their reason and
`reason` is null exactly when `available`; a date past the window is 400 and
the last day is still served). The S19 slot allowlist gains `reason`. Full
backend 608 passed; `alembic check` clean (no schema change). Frontend:
`lib/bookingWindow` (7 unit tests: default, configured value, loud failure on
a bad value, when › must stop in day and week view, the API's reason is the
only "beyond"); calendar (5 new component tests: beyond-window slots styled
as past with no "Ocupado" chip, a selection there names the last open date,
the hint is always shown, › enabled up to the last open day and disabled on
it in both views while ‹/Hoje/Dia/Semana stay live); `bookingErrorMessage`
maps the 400 to "Só é possível reservar com 30 dias de antecedência, no
máximo. Escolha uma data até <data>." (1 test). Vitest 487; tsc clean.
Playwright `booking-window.spec.ts` on the seeded stack: the week view walks
to the week holding day 30, › is disabled there and the hint names the date;
the same session gets 400 from `POST /bookings` one day past the window and
201 from `POST /admin/bookings` (then cancels it). The dashboard cancel dialog
(C07) was verified unchanged. **DECISIONS:** (1) the boundary is inclusive —
`start_time > now + N days` is refused, `==` allowed — per the assignment's
own "later than"; the availability hint therefore names the day of that
instant, and the hours of that day after it read `beyond_window`. Alternative:
end-of-day granularity. Reverse: `>=` in `create_booking` and
`booking_window_end`. (2) `reason` precedence past → beyond_window → booked →
blocked, so the region past the horizon reads uniformly and an operator's
booking out there is not advertised; a block never overlaps a live booking
(A02). (3) `NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS` unset means the backend's
default (30); set-but-invalid throws (§9). Alternative: throw when unset —
would break `next build` and Vitest on a fresh checkout. (4) The calendar's
toolbar is a same-markup replacement of react-big-calendar's (same class
names), the only way to render › disabled. **Scope (as assigned):** Customers may cancel only up to 24h before
start (C07, kept) and — new — may book at most `BOOKING_MAX_ADVANCE_DAYS`
(default 30) days ahead. Admins have no window either way (cancel already;
the new rule must not touch the admin endpoints).
**Scope:** `BOOKING_MAX_ADVANCE_DAYS` in `config.py`, `docker-compose.yml`,
`.env.example`, exposed to the frontend as `NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS`
(the API stays authoritative). Customer `POST /bookings`: a `start_time` later
than now + N days → 400 "start_time is beyond the booking window".
`GET /rooms/{id}/availability`: slots beyond the window come back
`available: false` with an additive `reason: "beyond_window"`; `reason:
"past"` / `"booked"` / `"blocked"` are added where the code already knows it
(existing shape untouched); the `date` param is capped at the window (400
beyond it) so a client cannot fan out requests for months. Calendar: › is
disabled once the visible day/week passes the window, slots beyond it are
styled like past ones (disabled, not "Ocupado") with a visible hint "Reservas
abertas até <data>"; BookingModal maps the new 400 to Portuguese; the
dashboard cancel dialog already explains the 24h rule (C07) — verified, not
rebuilt. **Validation:** real-PG boundary tests at exactly N days for a
customer (rejected) and an admin (accepted); availability reasons incl. the
capped date; component test for the disabled › and the hint; Playwright: the
customer cannot reach day N+1, the admin can create there.

### H02 — Hour bank: packs pooled, purchase history kept

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/booking-rules-hour-bank`, committed locally; DONE only once merged.
**Evidence (2026-09-22):** 13 real-PG tests in `tests/test_hour_bank.py`
(A=2h + B=10h: a 5h block draws 2 and 3, no money, confirmed at once, the
deprecated link stays NULL; 13h draws 12 from the packs and charges one hour
— Checkout "1h Sala A (12h pagas com o pack)"; `package` is all-or-nothing
across the bank with the balances untouched on refusal; an expired pack is
not in the bank; two concurrent 7h blocks against the 12h bank take exactly 12
between them, no purchase goes negative, each booking's rows add up to its
share; cancel restores 2 to A and 3 to B exactly and deletes the rows while
`package_hours_used` stays 5 for the record; a lapsed hold restores each
purchase; reinstating after A's hours went elsewhere re-debits the 5h from B
and the response shows the split; reinstating is refused, nothing moved, when
the bank cannot cover it; `GET /packages/me` sums the bank and names what
lapses first while pending/cancelled purchases stay out of it and the
history keeps all four rows; the admin user page shows the same balance; an
empty bank; the operator list carries `package_debits` and the customer list
does not; the migration's backfill SQL, run against a real schema, gives each
hour-holding pre-H02 booking one row, none to a cancelled or hourly one, and
rewrites no balance; the downgrade's link recovery picks the purchase drawn
on most and leaves an existing link alone). Re-specified for the owner's
pooled rule (not weakened): `test_the_sooner_expiring_pack_is_spent_first…`
(was "a whole-block pack wins", C13 decision 6) and
`test_packs_are_pooled_soonest_expiring_first_before_any_money` (was "the
soonest pack pays the partial share"); three others now read the debit rows
instead of the deprecated link; two shape pins gain `balance`. Migration
`0011_booking_package_debits` round trip: upgrade → check → downgrade -1 →
upgrade → downgrade base (no tables, no enum types left) → upgrade head →
check clean. Full backend 621 passed. Frontend:
`planPayment` pooled (14 unit tests incl. 2h+10h→8h, 3h+5h→8h outright,
2h+10h→13h = 12 + 1h money, `packsUsed` counts only packs drawn on);
BookingModal "Horas do pack − 3h (de 2 packs) (ficam 2h)" and never "de 1
packs" (2 tests, 30 in the file); packs page "Banco de horas — 12h
disponíveis · 2h expiram a 3 de out." above the unchanged history, empty bank,
the API's number wins over a client sum (3 tests); admin bookings table "5h
do pack" + "de 2 packs" with the split as a hover title, mixed keeps
"+ 2h do pack", no split when none (3 tests); admin sheet "Ver os 2 packs"
disclosure listing "2h · Pack 10h · expira 3 out" (1 test); admin user page
"Banco de horas: 3h disponíveis"; `lib/api.ts` `packagesApi.myPackages` and
`getUser` balance/split shape tests (3). tsc clean. Playwright
`hour-bank.spec.ts`: a fresh customer granted 5h (lapsing in a month) + 15h,
books a whole 08–20 day with "my pack" → `package`, confirmed, 12h, no
checkout; `/packages/me` shows 8h available and 8h expiring next; the admin
table row reads "12h do pack · de 2 packs" with "5h · … / 7h · …" behind it;
the customer's dashboard card reads "12h do pack" and the packs page bank
"8h disponíveis · 8h expiram a …" with "0h restantes de 5h" / "8h restantes
de 15h"; the operator's cancel puts 5 and 7 back (20h, 5h next). Vitest 500
(493 on the loaded machine — the seven that timed out pass in isolation and
are re-run in the branch's final verification); tsc clean. **DECISIONS:**
(1) the backfill writes a row only for bookings that still hold their hours
(`pending`/`confirmed`/`completed`); a cancelled/expired/paid-unfulfilled
booking already had its hours credited by the old code, so a row for it
would be a phantom debit a later reinstate would credit twice. Alternative:
a row for every linked booking. Reverse: drop the status filter in
`BACKFILL_SQL`. (2) `balance` on `GET /packages/me` spans organizations,
like the purchases list it rides with (one location, C11); `planPayment`
keeps filtering by org. Alternative: an `org_id` query parameter. (3) The
downgrade recovers `package_purchase_id` from the largest debit so the
pre-H02 code can credit one purchase; other draws stay spent (lossy, stated
in the migration). (4) The bank card's expiry reads "d 'de' MMM." — date-fns
`pt` abbreviates without the dot the assignment's text carries. **Scope (as assigned):** Today a booking points at ONE purchase
(`package_purchase_id`) and `redeem_up_to` debits only the soonest-expiring
pack, so with 2h left in pack A and 10h in pack B a 5h booking takes 2h from A
and charges 3h in money instead of taking 3h from B. **Wanted:** the customer
sees one balance (the sum of all active, unexpired packs), bookings draw it
down across packs soonest-expiring first, and money kicks in only when the
bank is empty. Purchase history (which packs, when, how many hours, expiry) is
kept exactly as today.

**Decision (the owner's, recorded before implementation):**
1. New table `booking_package_debits` (id, org_id, booking_id FK, purchase_id
   FK, hours Numeric > 0, created_at); unique (booking_id, purchase_id).
   `Booking.package_hours_used` stays as the cached total (= the sum of its
   debits; check constraint kept). `Booking.package_purchase_id` is
   deprecated: no longer written, kept nullable for one release; the migration
   backfills one debit row per existing booking that has it and hours > 0.
2. `package_hours.redeem_up_to` walks active unexpired purchases
   soonest-expiring first (same `FOR UPDATE` re-validation under lock as
   today) and debits from as many as needed, one debit row each, until `hours`
   is covered or the bank is empty. `redeem_hours` = the same walk with the
   all-or-nothing requirement. Cancellation / hold expiry / admin status
   changes (`settle_status_change`) credit each debit back to its own purchase
   (unconditional, as `credit_hours` is today) and delete the debit rows;
   reinstating re-debits through the same walk.
3. `GET /packages/me` gains a `balance` object `{hours_available,
   hours_expiring_next: {hours, expires_at}}` alongside the purchases list;
   the admin user page shows the same.
4. `mixed` split: pack share = min(duration, bank balance); money = the rest.

**Scope (frontend):** "Os meus packs" gets a top card "Banco de horas — 12h
disponíveis" with the soonest expiry ("2h expiram a 3 de out."), then the
purchase history list as today (remaining/total each). BookingModal's
breakdown uses the bank total; when the bank spans several packs one line
"Horas do pack − 5h (de 2 packs)". Dashboard rows unchanged in format ("5h do
pack + 11,00 €"). Admin bookings sheet/table show hours from pack (total) and,
on hover or expand, the per-pack split. **Validation (real PG):** A=2h +
B=10h, book 5h → debits 2 and 3, 0 money; book 13h → 12 from packs + 1h money;
cancel restores 2 to A and 3 to B exactly; hold expiry does the same; two
concurrent bookings against A+B cannot overdraw the sum; reinstating after
cancel re-debits from whatever is available; an expired pack is excluded from
the bank; migration backfill: existing pack/mixed bookings get a debit row
equal to `package_hours_used` and the sums match before/after. Component tests
for the bank card and the breakdown; Playwright: two purchases for the
customer, book 12h across them, dashboard shows the split and the bank shows
8h left.

### H03 — Admin "Alterar horário" fails: two real causes, fixed

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/booking-rules-hour-bank`, committed locally; DONE only once merged.
**Reproduced (2026-09-22), as failing tests first:** (a) 09:00–18:00 paid
with 9h of pack, moved to 09:00–15:00 → the CHECK constraint fired at flush
and — precisely — came back as a misleading `409 This time slot is already
booked` (`is_lost_slot_race` treated every IntegrityError as a lost slot),
which the sheet showed as "Este horário já está reservado ou bloqueado."; (b)
shortening a booking half an hour after it started → `400 start_time cannot
be in the past`. **Evidence:** 14 real-PG tests in
`tests/test_admin_reschedule.py` — the reproduction (2 from A + 7 from B → 6:
B gives 3 back, A's sooner-lapsing hours stay spent, `hours {9 → 6}`, no
`uncovered`, money untouched); shrinking past the last-drawn purchase frees
the earlier one too; a mixed booking keeps its 11,00 € and returns only the
pack hours past the new end; growing draws the extra from the bank; what the
bank cannot cover is `hours.uncovered` with no charge; an hourly booking is
reported as before and touches no pack; a booking in progress: end change
and room change succeed, a new end behind now is `400 end_time cannot be in
the past`, a start earlier than now is still refused, a start between the
original and now is allowed, the customer path stays strict, a conflict is
still 409; a constraint the settle could not prevent (forced by monkeypatch)
is `409 The change violates a constraint (ck_bookings_…)` with nothing
written. Full backend 635; `alembic check` clean (no schema change). Frontend:
`adminBookingErrorMessage` tells a moved-back start from an end behind now,
names an end before the start, the conflict, the pack-settle constraint and
any other refused constraint (4 unit tests); the sheet reports "9h → 6h. As
horas a mais voltaram ao banco de horas do cliente. Nenhum dinheiro foi
movido." / "…saíram do banco de horas…" / "O banco de horas do cliente não
cobre 1h; acerte essas horas com o cliente fora da plataforma." and, for a
money booking, the previous settle-outside line; a refused move keeps the
room/date/time values and the button enabled (3 sheet tests); `lib/api.ts`
carries `hours.uncovered` (2 shape tests). Vitest 507; tsc clean. Playwright
`admin-reschedule.spec.ts`: 9h granted, 09:00–18:00 booked with the pack,
the sheet's "Alterar horário" → 15:00 shows "9h → 6h … voltaram ao banco de
horas", the sheet reads 09:00–15:00 / 6h do pack, the bank is back up by 3,
the operator list shows 6h with a split summing to 6; an end before the
start is refused with "O fim tem de ser depois do início." and the form
keeps "08:00". The sheet's copy also moved to the formal register ("acerte",
missed by W05e). **DECISIONS:** (1) `is_lost_slot_race` now says no for a
CHECK/UNIQUE violation (sqlstate 23514/23505), so a refused write is never
reported as someone taking the slot; the admin route answers 409 naming the
constraint, the customer route re-raises as before (it cannot trip one).
(2) An hourly booking that grows draws nothing from the bank — its money
stays what it was and the extra is reported as before (A01); only a booking
that already holds pack hours settles its share. Alternative: draw for every
method. Reverse: drop the `package_hours_used <= 0` early return in
`settle_moved_booking`. (3) A booking that holds no hours (cancelled,
expired) only has its recorded share capped at the new length — nothing is
credited twice or drawn for a booking that is not live. (4) Debit rows are
read in the walk's order (purchase expiry) rather than `created_at`, which
one flush shares across rows. **Scope (as assigned):** Reproduced with the seeded stack, then fixed:
(a) Shrinking a booking that used pack hours (09:00–18:00 paid with 9h of
pack, moved to 09:00–15:00): `admin_update_booking` recomputes
`duration_hours` but not `package_hours_used`, so
`ck_bookings_package_hours_used_within_duration` fires at flush → 500. Fix: on
a move, settle the pack share to the new duration through the H02 ledger —
shrinking credits the surplus back (reverse debit order, so soonest-expiring
hours stay spent); growing debits the extra from the bank if available and
reports any uncovered hours in the existing `hours` response object as
`uncovered` (no money movement, as today). Money paid never changes here. Any
remaining constraint violation at flush → 409 with detail, never a 500.
(b) `_validate_slot` rejects `start < now`, so any edit to a booking that has
already started fails with "start_time cannot be in the past" even when only
the end changes. Fix: for admins the past-start rule applies only when the
START is moved to a time earlier than both `now` and the original start;
keeping the original start (even in the past) and changing the end/room is
allowed; the new end must still be > now. The customer path stays strict.
(c) The sheet's "Alterar horário" form shows a generic error; it now shows the
API `detail` mapped to Portuguese (past start, outside hours, conflict, pack
settle failure) and keeps the form values so the operator can adjust.
**Validation (real PG):** both reproductions as failing tests first; shrink of
a pack booking credits back; grow debits; in-progress end change succeeds;
moving the start earlier than now still rejected; conflict with another
booking still 409; component test for the error mapping; Playwright: the admin
shortens the seeded pack booking from the calendar sheet without error and the
customer's bank shows the returned hours.

### Q-H04 — Price mismatch: the static site says 12/15/18 €/h, the app 11 €/h

**Priority: P3. State: QUEUED — owner decision.** `flowspace-site/index.html`
prices the rooms at 12€, 15€ and 18€ per hour (and "12–18€/hora" in the
pricing block); the app's seed and the landing price every room at 11,00 €/h.
Recorded by the H/V assignment; nothing changed. Links W06/W07.

## Photos, room copy, map and contacts (V-series) — owner assignment 2026-09-22 (PR 2)

Branch `feat/photos-mosaic-map-contacts`, created from the finished PR 1
branch. One commit per task, V01 → V07, on BOTH the app and the static site.
**Photos:** the four illustrated room scenes in
`flowspace-site/assets/img/room-photos/` (`sala-01..04.svg` source,
`sala-01..04.webp` 1600×1200, `sala-01..04-thumb.webp` 480×360; twelve files,
verified present and committed in the docs commit) are used on both sites,
the same four for every room. No other placeholders are generated and no real
photos are asked for: replacing the illustrations is Q-V08. **Links:** C16
(the carousel and the seeded placeholders this replaces), C15 (the admin room
form), C10 (the space location and map), C09 (the contact address), A03 (the
admin calendar's opening-hours residual), R01 (rules still evaluated in UTC).

**Integrated verification (2026-09-23, final code state `aeb13a4` plus this
evidence commit, stub mode, no credentials, isolated stack rebuilt from an
empty database with the illustrations mounted):** backend pytest 645 passed
(635 at PR 1's HEAD); migration round trip clean at
`0011_booking_package_debits` (no schema change in PR 2); ruff check + format
clean; `tsc` clean; Vitest 539 (507 at PR 1's HEAD); `next build` OK; full
app Playwright 46 passed on the freshly seeded stack (the same 46 files as
PR 1; `photos` and `single-space` extended); flowspace-site smoke 26 passed
(22 at PR 1's HEAD) and Code.gs 38. Screenshots in `pr-screenshots/`
(uncommitted): the mosaic at 1280px, the carousel at 390px, the gallery open,
"Onde estamos" on the app and on the static site, the site's room cards.
`PR2_DRAFT.md` (uncommitted) has the per-section summary, the decisions with
reversals, the open questions (Q-H04 prices, Q-V08 real photos, V03's seed
notes, V05's UTC hours, V07's static hours line) and the local reproduction
commands.

### V01 — Room photo mosaic and gallery (app), seeded illustration photos

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally; DONE only once merged.
**Evidence (2026-09-23):** `PhotoMosaic` — 13 component tests (0 → the given
placeholder, no region, no button; 1 → hero; 2 → halves; 3 → big + 2; 4 → big
+ 3; 5 and 8 → big + 4 with five tiles; the first photo is the big tile, every
tile a sized cover-fitted `<img>` with alt "<sala> — fotografia N de M",
eager then lazy; a `region` "<sala> — fotografias"; the <1024px branch is the
carousel with a counter and no dots; the gallery opens on the button with the
full images, a counter, a thumbnail `tablist` and a close button and closes on
Escape; a tapped tile opens the gallery on that photo and a thumbnail moves
it; arrow keys move it, "Fechar" closes; a tap on the small-screen carousel
opens it on that photo). `PhotoCarousel` gained `size='full'`,
`indicator='counter'`, `initialIndex`/`onIndexChange`, `onPhotoClick`, a
`regionLabel` and "N de M" alts; its 16 tests unchanged. The card
carousel's dots sit on their dark pill inside the frame — nothing to fix.
Seed: 7 real-PG tests in `test_media.py` (each demo room gets the four
illustrations in order, 1600×1200, the very bytes the site ships for main
and thumbnail, WebP; the public shape carries no seed mark; a re-seed
replaces its own photos and keeps an operator's, in front, without
duplicates; the unmarked 960×720 gradients an earlier seed generated are
replaced too; a second seed with nothing to do rewrites nothing; a missing
illustration fails loudly naming `SEED_PHOTOS_DIR`; the gradient generator is
gone). Vitest 520; tsc clean. Playwright `photos.spec.ts` (2): the landing
card carousel as before; the room being booked shows the mosaic at 1280px
("big + 3", four `/media` files, ~2:1), "Mostrar todas as fotos" opens the
gallery (1 / 4 → 2 / 4, Escape closes), and at 390px the carousel fills the
content width with its counter and no mosaic. **DECISIONS:** (1) both the
mosaic and the carousel are in the DOM and CSS (`lg:`) picks one, so the
server render is right on every screen; the hidden branch's lazy images do
not load. Alternative: a `matchMedia` hook (hydration mismatch risk).
(2) Seed photos carry a `seed: "sala-0N"` mark in the stored JSON (never in
`PhotoOut`), which is how a re-seed tells its own rows from an operator's;
the pre-V01 gradients are recognised by their shape (2–3 unmarked photos,
all exactly 960×720) so an existing dev database is cleaned up too. Reverse:
drop `_is_legacy_placeholder_set`. (3) The illustrations reach the
container by a read-only bind mount in both Compose files rather than a
`COPY` into the image (the test image's context is `backend/` alone).
**Scope (as assigned):** The booking area (`SpaceRoomsView`, above
"Disponibilidade — <sala>") shows the card-size 4:3 carousel left-aligned in a
wide container. **Scope:** a `PhotoMosaic` for the selected room spanning the
content width. ≥1024px: 2 columns × 2 rows, the first photo spanning both rows
on the left (½ width), the others a 2×2 on the right; overall aspect ~2:1; 8px
gaps; 12px outer radius; `object-fit: cover`; width/height on every `<img>`.
By count: 5+ → big + 4; 4 → big + 3 (one right cell spans two rows); 3 → big +
2 stacked; 2 → two halves; 1 → single 2:1 hero; 0 → the existing placeholder
at the same size. Bottom-right "Mostrar todas as fotos" (only when > 1) opens a
full-screen gallery dialog: the existing `PhotoCarousel` at `size='full'` with
counter, arrows, keyboard, Escape/close, focus trap, body scroll lock and a
thumbnail strip on desktop — the project's Radix Dialog, no new dependency.
<1024px: the existing carousel at full content width (frame fills the
container; counter pill instead of dots); a tap opens the same gallery. Alt
"<sala> — fotografia N de M"; the container is a `region` labelled "<sala> —
fotografias". Room CARDS keep the compact carousel (dots fixed if they overlap
the image edge). Seed: the Pillow gradient generator goes; at seed time
`sala-0N.webp` + `sala-0N-thumb.webp` are copied from
`flowspace-site/assets/img/room-photos/` (path resolved from the repo root,
overridable with `SEED_PHOTOS_DIR`; the directory is mounted into the backend
container in `docker-compose.yml` so the seed works in Compose and natively)
into `MEDIA_ROOT` and registered as each room's photos (same four, same order,
all three rooms) in the existing `{id, url, thumb_url, width, height}` shape;
idempotent: re-seeding replaces, never duplicates. **Validation:** component
tests for 0/1/2/3/4/5+ layouts, gallery open/close, keyboard; seed tests;
Playwright: select a room, mosaic at 1280px, carousel at 390px, "Mostrar todas
as fotos" opens the gallery.

### V02 — Static site: room cards with photo galleries and a manifest

**Priority: P2. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally. **Evidence
(2026-09-23):** `assets/js/room-gallery.js` (vanilla, ~150 lines) reads
`assets/img/room-photos/manifest.json` and fills each `.room-gallery[data-room]`
with the app's carousel semantics (region "<sala> — fotografias", a
"diapositivo" per photo, "Fotografia anterior/seguinte", a dot `tablist`,
arrow keys, a polite live region that speaks only after a move, no
autoplay; scroll-snap, swipes followed silently); CSS in `site.css` bleeds
the 4:3 frame to the card's edges; the three `.desc` paragraphs are gone,
the intro sentence, names, prices and tags stay; the script tag sits next to
the form's. Smoke spec +2 (structural: three cards, each a gallery with one
image per manifest entry, alt "<sala> — fotografia N de 4", width/height,
eager then lazy, a dot each, no `p.desc`, price and tags present; "next"
moves to photo 2 and the announcer says so, the previous button is hidden at
the start, ArrowLeft comes back, the last dot hides "next"): 24 passed.
README: a "Room photos" section documenting the manifest as the one place
real photos go. **DECISION:** the manifest is fetched over HTTP and the
galleries are built by the script (no-JS visitors see name, price and tags
and no pictures) — the alternative, four static `<img>` tags per card, would
make real photos an HTML edit in three places instead of a manifest edit.
**Scope (as assigned):** `flowspace-site/index.html` "Salas" cards
have name, price, a description paragraph and tags. **Scope:** each card gets
a photo carousel at the top (vanilla JS in `assets/js/room-gallery.js`,
scroll-snap, prev/next, dots as a tablist, no autoplay, the app's aria,
keyboard; CSS in `site.css`; no dependency). Each card shows the four SVGs in
order via `<img>` with width/height, alt "<sala> — fotografia N de 4", first
eager, rest lazy; SVGs served directly. `assets/img/room-photos/manifest.json`
({room slug: [files]}) is what the gallery JS reads, so real photos later are
a manifest edit — documented in the README. `.desc` paragraphs removed (V03);
name, price, tags kept. **Validation:** the smoke spec, structurally (cards
have a gallery; next advances the counter/dots).

### V03 — Room copy: photos instead of descriptions

**Priority: P2. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally. **Evidence
(2026-09-23):** `RoomCard` no longer renders `room.description` (the selected
-room header never did); the admin room forms (new and edit) label the field
"Notas internas (não visíveis ao cliente)"; API_SPEC says so on the create
body and the `Room` type. The static site's `.desc` went with V02 and its
intro sentence stays. Tests: a `RoomCard` component test (name, amenities
rendered, the description not); the admin rooms test types into the relabelled
field and asserts no "Descrição" label; the site smoke asserts no `p.desc`.
The seed still writes the W04 room lines into `description` — now internal
notes; left as they are (harmless, and W04's re-seed rule still holds).
**Scope (as assigned):** `RoomCard` and the selected-room
header stop rendering `room.description`; the field stays in the model, API
and admin form, relabelled in admin "Notas internas (não visíveis ao
cliente)" and noted in API_SPEC. Static site: `.desc` removed (V02); the
"Salas" intro sentence stays. Tests that assert on description text become
structural. **Validation:** component tests; site smoke.

### V04 — Remove the hero pill

**Priority: P2. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally. **Evidence
(2026-09-23):** `hero.badge` deleted from `pt.json` and `en.json` (the parity
test keeps both catalogs equal), its render and the `Clock` import gone from
`Hero.tsx`; the static site's `<span class="hero-badge">` and its CSS rule
gone. Tests, structural: the hero's first text is the headline and no pill
element exists (Hero.test.tsx +1); the site hero has no `.hero-badge` and
its first child is the `<h1>` (smoke +assertions). Vitest targeted 21; site
smoke 24. **Scope (as assigned):** the "Disponível à hora …" badge
goes from both heroes: app i18n key `hero.badge` (PT and EN, deleted, not
emptied) and its render in `Hero.tsx`; static site `<span class="hero-badge">`.
Hero tests updated structurally. **Validation:** Vitest incl. the catalog
parity test; site smoke.

### V05 — Opening hours: 08:00–22:00 every day

**Priority: P2. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally. **Evidence
(2026-09-23):** `seed.py` writes `SEED_RULES` (7 days × 08:00–22:00) and, on
a re-seed, replaces exactly what earlier seeds wrote (`_PREVIOUS_SEED_RULES`,
Mon–Sat 08:00–20:00) while leaving an operator's own hours alone — 4 real-PG
tests in `test_space_location.py::TestSeedOpeningHours` (fresh seed: 21 rules;
the pre-V05 set is replaced; an operator's kept; a second seed rewrites no
row). Verified, not rebuilt: the customer calendar's visible range derives
from the returned slots (B34, `visibleRange`, its unit tests unchanged) and
the loop stack serves 14 slots 08:00–22:00 UTC after the re-seed. The admin
calendar (A03) shades 08–22 instead of 08–20 and shows until 23:00 so the
last hour stays visible in summer; its rooms-union residual stands. The
e2e specs that skipped Sundays keep doing so (harmless) and `hour-bank`
counts the 08–20 slots it needs rather than the day's total. Playwright
`booking`, `week-view`, `admin-calendar`, `hour-bank` 16 passed on the
re-seeded stack. **Known limitation, recorded (R01) — resolved on
`fix/local-opening-hours` (2026-09-23):** rules were evaluated in UTC, so
Lisbon read 09:00–23:00 in summer; they are the space's wall clock now.
**DECISION:** the re-seed replaces only the exact set an earlier seed wrote
(any other set is an operator's), the same rule W04 applies to descriptions
and V01 to photos.
**Scope (as assigned):** `backend/app/seed.py` gives every
room 08:00–22:00 on all seven days (idempotent update of existing rules);
tests pinning 08–20 updated; the customer calendar's visible range follows the
rules (B34 derived it from the slots — verified, fixed if not). **Known
limitation, recorded not fixed:** rules are evaluated in UTC (R01), so the
displayed local range is shifted by one hour in summer. **Validation:** seed
tests; the Playwright specs that walk the day.

### V06 — "Onde estamos" block (app): location, contact and hours

**Priority: P1. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally; DONE only once merged.
**Evidence (2026-09-23):** backend: the public `GET /spaces/{id}` carries each
room's active `availability_rules` (`{day_of_week, open_time, close_time}`,
never the rule id) — 1 real-PG test (an inactive rule stays out; the list
endpoint carries none) and the S19 allowlist names the field and the
window's fields. Frontend: `lib/openingHours` (10 unit tests: all days the
same → "Todos os dias 08:00–22:00"; Mon–Fri + Sat + closed Sun → "Seg–Sex …",
"Sáb …", "Dom Encerrado"; only consecutive days fold; union across rooms with
`differsByRoom`; identical rooms do not differ; a lunch break becomes the
day's outer span; the Lisbon clock reads an hour later in summer; no rules →
"Encerrado"); `mapEmbedUrl` takes the frame's aspect and builds the box in
ground distance around the pin (3 unit tests); `WhereWeAre` replaces
`SpaceLocation` (14 component tests: labelled section with the name and the
address lines; directions link; the one mailto and no `tel:` line, a phone
line only when `NEXT_PUBLIC_CONTACT_PHONE` is set; the four hours cases;
the placeholder holds the address and the button at the map's size and no
third-party request leaves; the iframe is lazy, referrer-free, titled,
centred on the point, then "Abrir o mapa completo"; no map column without
coordinates; partial and empty locations). `SpaceCards` (landing) and
`SpaceRoomsView` (rooms page header) render it with the space's rooms.
`CONTACT_PHONE` in `.env.example`/Compose → `NEXT_PUBLIC_CONTACT_PHONE`,
empty. Catalog keys `location.contact/hours/hours_per_room` (PT/EN). Vitest
targeted 39 + 25 + 10; tsc clean. Playwright `single-space.spec.ts`
extended: the block on the landing with the mailto, no `tel:`, "Todos os
dias …" hours, a ≥280px placeholder, the map's bbox centred on the pin and
the frame's size unchanged after loading, the full-map link; the block again
on the rooms page. **DECISIONS:** (1) opening windows travel on the public
room shape rather than a new endpoint — one read, already cached by the
landing and the rooms page. (2) The hours are the union of the rooms'
windows per day, and two windows on one day fold into the day's outer span
("Seg 08:00–20:00" for 08–12 + 14–20); the per-room note covers the
difference. (3) The line under the map is always there (the privacy note
before the click, the full-map link after) so the frame never changes
height. (4) The phone is a frontend env value (`CONTACT_PHONE` →
`NEXT_PUBLIC_CONTACT_PHONE`), not a backend setting: nothing server-side
uses it. **Scope (as assigned):** One component on the landing page
(single-space mode) and the rooms/booking page header. **Scope:** two columns
at ≥768px, stacked below. LEFT (40%): "Onde estamos"; space name; address
lines; "Como chegar" (existing directions URL); divider; "Contacto": the email
(mailto, from the single contact constant), no phone line — an optional
`CONTACT_PHONE` setting exposed to the frontend, empty by default, rendered
only when set, left empty; "Horário": derived from the space's rooms'
availability rules (union across rooms) grouped into ranges — "Todos os dias
08:00–22:00" when every day is the same, else "Seg–Sex 08:00–20:00 · Sáb
09:00–13:00", "Encerrado" for days with no rule, and a note "horário por sala
no calendário" when rooms differ; times shown in Europe/Lisbon (display
only). RIGHT (60%): the map filling the column height (min 280px), the marker
centred: OSM bbox symmetric around (lat, lng) with the frame's aspect (≈
±0.006° lat, width scaled by aspect/cos(lat)); click-to-load ("Ver mapa")
kept, the placeholder shows the address and the button at the same size so
the layout does not jump; "Abrir no mapa" below. Footer keeps the short
address line. **Validation:** component tests for the hours grouping
(all-days-same, Mon–Fri + Sat, closed day, differing rooms), phone absent,
placeholder before click, bbox centred; Playwright: the block on the landing
and on the rooms page.

### V07 — "Onde estamos" block (static site)

**Priority: P2. State: IN PROGRESS** — implemented on
`feat/photos-mosaic-map-contacts`, committed locally. **Evidence
(2026-09-23):** `#localizacao` is now one "Onde estamos" section with the
app's two-column layout: address (two lines), "Como chegar" (the existing
Google Maps URL, renamed from "Abrir no Google Maps"), a divider, "Contacto"
with the mailto, no phone, "Horário" as "Todos os dias, 08:00–22:00"; on the
right a map frame (min 280px) whose placeholder shows the address and "Ver
mapa"; `assets/js/where-map.js` mounts the OpenStreetMap iframe on click
(lazy, referrer-free, bbox in ground distance around the pin with the frame's
aspect) and swaps the privacy note under it for "Abrir no mapa". The contact
form stays below under "Envie-nos uma mensagem" with its JS and ids
untouched; `#contacto` is that form block (every "Reservar"/"Falar
connosco" button leads there, as before) and the nav's "Como chegar" now
reads "Onde estamos". Smoke +2 (the block's content and anchors; no iframe
and no third-party request until the click, then the centred, same-height
map and the link; stacked below 768px) and the renamed link test: 26
passed; Code.gs 38. README documents the section and the two data
attributes. **DECISION:** `#contacto` stays on the form (its meaning for
every CTA), `#localizacao` on the new section — both resolve. **Scope (as assigned):** the separate "Como chegar" and
"Contacto" sections of `flowspace-site/index.html` become one "Onde estamos"
section with the same two-column layout and content: address, "Como chegar"
(existing Google Maps URL), geral@flowspace.pt, no phone, hours as static text
"Todos os dias, 08:00–22:00", and an OSM embed iframe centred the same way,
lazy-loaded on click so the site stays free of third-party requests by
default. The contact FORM stays below under its own "Envie-nos uma mensagem"
heading (JS/IDs untouched — the Apps Script depends on them). `#contacto` and
`#localizacao` still resolve. **Validation:** the smoke spec, structurally.

### Q-V08 — Replace the illustrations with real room photos

**Priority: P3. State: QUEUED — owner.** The four illustrated scenes are
stand-ins used on both sites for every room. When real photos exist: the app
takes them through the admin photo manager (C15) per room; the static site
takes them as a `manifest.json` edit plus the files (V02). No code change
expected.

## Landing parity and "Onde estamos" rework (L-series) — owner assignment 2026-09-23 (PR 2)

Branch `feat/landing-parity-where-we-are`, from the finished PR 1 follow-up
branch (`fix/local-opening-hours-dst`; PR 1 itself merged as #61). The
sections below apply to BOTH the app and the static site. The specification
first reached the loop cut off (recorded 2026-09-23 morning as BLOCKED); the
owner resent it the same afternoon and the three tasks are now specified in
full. Out of scope for every item: prices (Q-H04 stays recorded), refunds,
recurring bookings, photos (the illustrations stay), any new dependency.
Links: W01–W05 (the copy and register they touch), V01–V07 (the photos and
"Onde estamos" they build on).

### L02 — One hero message, no separate "O espaço" section (both sites)

**Priority: P1. State: TODO.** The "O espaço" section (W03's two paragraphs)
duplicates the hero and sits centred under it. Fold its message into the hero
and remove the section on both sites. **Copy, verbatim, identical on both
sites (formal register):** H1 "O seu espaço, no seu tempo." (the existing
emphasis on "no seu tempo." exactly as the app renders it today); lede
"Gabinetes tranquilos e bem equipados para profissionais de saúde e
bem-estar. Reserve à hora e trabalhe à sua maneira."; support "Um espaço
partilhado onde cada profissional mantém a sua autonomia e a sua forma de
trabalhar."; benefits row, same four in the same order: "Reserva online em
segundos · Sem caução · Cancelamento até 24h antes · Pagamento seguro". EN
(app catalog only): "Your space, on your time." / "Calm, well-equipped
consulting rooms for health and wellbeing professionals. Book by the hour and
work your own way." / "A shared space where every professional keeps their
autonomy and their own way of working." **App:** update `hero.description` /
`hero.support` (PT+EN); delete `components/landing/TheSpace.tsx`, its i18n
keys and its render in the landing page; keep the pills row; the nav/footer
must not link to a removed anchor. **Static site:** the same copy in the
hero, character for character; drop the extra sentence "Reserva à hora, sem
contratos nem compromissos."; add the four-benefit row styled like the app's
(dot + text, muted, wraps on mobile); remove `<section id="espaco">` and its
nav link "O espaço" (nav becomes Salas · Como funciona · Preços · Onde
estamos + the CTA); the hero badge is already gone on main (V04) — do not
re-add. **Tests:** Hero/landing tests structural (headline present, two
CTAs, four benefits; no prose snapshots); static smoke: nav links resolve,
no `#espaco`; one static-vs-app copy check — a test that the hero lede and
support strings in `flowspace-site/index.html` equal `hero.description` /
`hero.support` in `frontend/lib/i18n/pt.json`, so the two sites cannot drift
silently. Links W01, W03, V04.

### L03 — Static site looks like the app

**Priority: P1. State: TODO.** The static site is the marketing twin of the
app's landing page and should be visually indistinguishable where the
content is the same. Today its section heads and prose are centred
(`.section-head`, `.prose` in `site.css`) while the app's landing lives in a
max-w-7xl container with its own heading scale. **First, the parity table**
(below, filled in this task before the CSS changes) walking the APP landing
page section by section at 1280px and 390px: container width and padding,
section vertical spacing, heading sizes/weights/alignment, card
radius/border/shadow, button sizes, benefits row, footer columns. The app is
the reference; the static site changes to match, never the other way. **Then
apply it** in `site.css`/`index.html`: section heads with the app's heading
scale and alignment; the same container (80rem, 1rem/1.5rem/2rem side
padding); the same section rhythm; room cards matching the app's `RoomCard`
(photo carousel, name, price, tags — same order and sizes); "Como funciona"
and "Preços" cards matching the app's HowItWorks/Pricing look (content
stays; prices untouched); footer with the same three-column structure and the
same address line. Reuse `tokens.css` values; add tokens there if the app has
one the static site lacks. Fonts/colours already match; the palette does not
change. **Mobile:** same stacking order as the app at 390px, no horizontal
scroll. **Validation:** screenshots of both sites at 1280px and 390px side by
side in `PR2_DRAFT.md`; static smoke updated structurally. Links F01, W01,
V02, V07.

**Parity table (app = reference; read from the app's Tailwind classes, then
checked on screenshots at 1280px and 390px):** to be filled by the task.

### L04 — "Onde estamos" rework (both sites)

**Priority: P1. State: TODO.** Current app block (V06): left column with
heading, space name, address, "Como chegar", a divider, "CONTACTO" label +
email, "HORÁRIO" label + hours; right column a click-to-load map placeholder.
**Change to — left column,** in this order, no divider and no uppercase
labels, each line icon + text: (1) hours "Todos os dias 08:00–22:00" (from
R01; grouped ranges when days differ, as today), (2) email (mailto), (3)
address on two lines, then the "Como chegar" button directly under the
address. Heading "Onde estamos" stays; the space name stays as a subtitle.
**Right column:** the map loads IMMEDIATELY on render — no "Ver mapa" step.
Keep the iframe `loading="lazy"` (below the fold on the landing page, so the
browser defers it anyway), `title`, `referrerpolicy="no-referrer"`, the
centred bbox computation from V06/V07 and the "Abrir o mapa completo" link.
Remove the placeholder and the "só é carregado quando o pedir" sentence. Add
one privacy line to the site's privacy page/notice: the map is an
OpenStreetMap embed (openstreetmap.org receives the request). **Same block,
same order and behaviour** on the rooms/booking page header and on the static
site's `#localizacao` section (static: hours as text "Todos os dias,
08:00–22:00", eager iframe, the same bbox math in a tiny inline script or a
precomputed URL). **Mobile:** left column first, map below at 16:10, min
240px. **Tests:** component tests for the line order, no labels/divider,
iframe present on first render with the centred bbox, phone absent;
Playwright on both pages; static smoke asserts the iframe exists without a
click. Links V06, V07, R01, C09.

## Deferred scope

| ID | Previous work | Reactivation condition |
|---|---|---|
| D01 | Epic 6: RLS | Before onboarding another operator. Design policies for public reads, user-owned multi-org data and worker access; verify with a non-bypass DB role that omission of a route filter cannot leak data. Do not mechanically apply the old single-org setting design to every request. |
| D02 | Epic 9: further i18n | A product need after the single-location journey is reliable. Q29/Q30 only complete/dispose of existing marketing/layout work; full booking/admin translation is not implicitly authorized. |
| D03 | Additional multi-operator/multi-space UX | Explicit expansion decision; existing tenant isolation and org-cache correctness remain mandatory now. |
| D04 | B13: daily booking products/monthly recurrence | Explicit customer/product requirement; these are new products, not regressions of hourly or weekly booking. Owner decision 2026-09-19: hourly booking is the only product (C12); half-day, full-day, multi-date and monthly booking stay deferred, as do R02/R03/R99. |
| D05 | Epic 5: pagination beyond existing admin bookings | Demonstrated list growth. Q20 owns existing work; add further list coverage only when needed (O05's bounded audit listing is part of that task). |
| D06 | Admin handling of special requests (recurring arrangements, longer bookings, questions) raised through the booking contact note (C12). First slice assigned 2026-09-22: C17 stores requests in `support_requests`, C19 lists them at `/admin/support`; answering, assignment and history stay deferred here. | Stub only. **Scope:** somewhere in the admin panel for an operator to see, answer and close requests that today arrive by email at the C09 contact address; tenant-scoped, no customer-facing request form implied. **Acceptance (to be written when reactivated):** an operator can list, read and resolve a request for their own organization only, with real-PG happy/failure tests and a Playwright admin flow. Reactivate on demonstrated request volume or an explicit owner decision; until then the mailbox is the process. |

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
