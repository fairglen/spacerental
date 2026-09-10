# EspaçoHora roadmap

Agreed on 2026-09-09, following the assessment of main (`bc3112b`) and the open PRs.

Our near-term goal is to validate one Lisbon location with several rooms. The
multi-tenant architecture supports later expansion, but the next milestones
focus on complete customer and operator journeys at that location.

The desired outcomes below are prioritized in exactly this order. Existing PRs
are starting points, not proof that an outcome is complete. Check their current
state before implementation, integrate related work, and verify the resulting
journey. Keep `TODO.md` aligned with this roadmap as work lands.

**Delivery resumed 2026-09-10.** Gate 0 is complete: documentation PR #23 merged
as `49433c3`, and the open PR queue is empty. The user resumed the TODO backlog.
C01 customer enrollment is in progress on `feat/customer-enrollment`; then C02
completes the package-holder journey. Later outcomes retain their entry gates.
New bugs and follow-ups are recorded and prioritized in `TODO.md` before work
starts; discovery alone does not expand the active task.

**Reported purchase blocker:** [TODO.md B14](TODO.md#b14--pack-purchase-fails-credential-validation-reported-as-monthly-booking)
tracks the user's monthly/pack purchase failure (`Could not validate credentials`
from `POST /packages/{id}/purchase`). Authentication recovery was delivered in Gate 0: the selected package survives
sign-in and the completed local purchase is verified. The reported endpoint
does not establish a separate monthly-recurrence defect; reproduce any remaining
scheduling problem independently. The expired-session failure mode and successful recovery through local checkout are verified and merged in PR #32 (`c8b4913`).

## 1. First customer can reliably pay and book

A person arriving without a demo account can register, book a room, pay, and see
the correct reservation and payment state without manual database changes.

### Work

- [ ] **Start with customer enrollment and a fresh-user booking E2E test.**
  Separate customer enrollment from operator creation. Give customers an
  explicit path to membership in the location's organization without granting
  admin privileges. Preserve tenant isolation.
- [ ] **Then complete the package-holder journey** using redemption from
  [PR #22](https://github.com/fairglen/spacerental/pull/22), merged on 2026-09-09.
  Cover purchase,
  activation, redemption, insufficient balance, and cancellation restoring
  hours, using an isolated customer fixture for E2E coverage.
- [ ] Complete abandoned-checkout handling: define hold expiry, release unpaid
  slots, allow payment resumption or retry, and handle late payment events
  without overbooking or duplicate charges.
- [ ] Upgrade vulnerable dependencies to appropriate patched releases and
  verify the production build and authentication/booking flows.
- [ ] Fix the multi-conflict lookup so a requested interval overlapping several
  reservations returns 409 rather than a server error. Enforce bookable times
  on the backend, including opening hours and rejection of past bookings.
- [ ] Display actual package prices and validity from the API, matching checkout.
- [ ] Explain cancellation eligibility and show failed-action feedback in
  Portuguese instead of leaving the customer without an explanation.
- [x] Repair E2E setup failures and retain traces, backend logs and booking
  coverage through merged [PR #25](https://github.com/fairglen/spacerental/pull/25)
  and [PR #31](https://github.com/fairglen/spacerental/pull/31). Further diagnostics
  and authentication error feedback remain C08.
- [x] Reconcile README, TODO, and architecture guidance with merged code in
  this documentation delivery (#23), distinguishing implemented foundations
  from remaining gaps. Keep these current during later delivery.

### Done when

- A new customer can complete signup → browse → multi-hour booking → local
  checkout → confirmed reservation, with no demo privileges or manual setup.
- The same customer can buy and redeem prepaid hours; concurrent requests
  cannot overspend the balance or claim the same room interval.
- Abandonment, conflicts, payment retry, and cancellation have tested outcomes
  and understandable feedback. Expired unpaid holds release availability.
- Relevant integration and E2E tests, the full required suites, migration
  checks where applicable, and the production build pass on the integrated
  changes. The full journey is runnable locally with no external credentials.

## 2. Regular customers can manage their schedule

A therapist can reserve the same weekly local-time slot, pay for it, and manage
individual dates or future occurrences without rebuilding the schedule by hand.

### Work

- [x] Integrate the explicitly gated recurring backend
  [PR #26](https://github.com/fairglen/spacerental/pull/26) and its dependent UI
  [PR #27](https://github.com/fairglen/spacerental/pull/27). Both are merged as an
  opt-in pending UTC foundation; paid local-time series remain below.
- [ ] Define and implement series payment and package-redemption behavior.
  Resolve checkout, confirmation, expiry, and partial-failure semantics;
  creating indefinitely pending occurrences is not a complete booking flow.
- [ ] Anchor recurrence and opening hours to the location's timezone. A weekly
  09:00 appointment must remain at 09:00 in Lisbon across daylight-saving
  changes, while stored booking instants remain UTC.
- [ ] Provide dashboard controls to identify a series, cancel one occurrence,
  cancel future occurrences, and edit the future schedule. Preserve past records.
- [ ] Integrate series changes with payment/hour accounting and notifications,
  and ensure the later lock integration handles the same transitions.
- [ ] Add E2E coverage for series preview, payment, conflicts, editing, and
  cancellation, plus integration tests for concurrency and timezone boundaries.

### Done when

- A customer can create and pay for a weekly series and see confirmed dates.
- A conflicting series creates no partial reservation or unintended charge.
- Editing or cancelling affects exactly the intended occurrences, balances,
  and notifications; past bookings remain intact.
- Weekly local times remain stable across both daylight-saving transitions.
- The complete series journey passes locally using stub integrations.

## 3. The location can operate reliably

The operator can trust notifications, cancellations, financial reporting, and
physical access, including when processes restart or external services fail.

### Work

- [ ] Make email delivery durable, with persisted jobs, retries, and visible
  failures. Current in-process background tasks are the starting point.
- [ ] Define and implement cancellation/refund handling for paid bookings,
  packages, and series, including duplicate events and failed provider calls.
- [ ] Make revenue reporting reflect money collected and refunded, including
  package sales, without counting redemption as another payment.
- [ ] Complete smart-lock integration from
  [PR #28](https://github.com/fairglen/spacerental/pull/28): persist room/device
  mappings and issued-code identifiers; retain failed revocations for retry;
  expose access information to the authorized customer and operator.
- [ ] Cover every confirmation/cancellation path, including package bookings
  and series, with consistent access issuance and revocation.
- [ ] Add tenant-scoped audit history for consequential actions, including
  booking changes, cancellations, refunds, and role changes.

### Done when

- A restart does not lose queued notifications or the ability to revoke access.
- Provider failures are visible and recoverable; retries do not duplicate
  refunds, notifications, or access codes.
- Operators can reconcile collected revenue, refunds, and package balances,
  and inspect who performed consequential actions.
- Failure and recovery scenarios can be exercised locally without paid services
  or real third-party credentials.

## Deferred until the single-location journey is reliable

- Further i18n expansion beyond the existing work.
- PostgreSQL RLS implementation, revisited before onboarding another operator;
  existing tenant isolation remains mandatory throughout.
- Additional multi-operator or multi-space UX.
- Daily booking products and monthly recurrence without an explicit product need.

Small existing improvements such as migration diagnostics and admin pagination
can be reviewed and integrated when ready. They do not change the outcome order
or substitute for completing the customer journeys above.
