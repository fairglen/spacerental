# FlowSpace — Space Rental Platform

> Formerly EspaçoHora: the product was renamed FlowSpace on 2026-09-22 (W02) to match the marketing site and `geral@flowspace.pt`. Internal identifiers (repo, package, database, env var and Compose service names) keep their old names on purpose.

> **Early proof of concept.** Hourly checkout, prepaid packs, admin tools and local email/access-code flows are implemented. The product is not production-ready: payment recovery, durable notifications/access and other outcome gates remain open. See [roadmap.md](roadmap.md) for the agreed outcome order and [TODO.md](TODO.md) for executable tasks; roadmap delivery has resumed with customer enrollment (C01).

## Stack
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + NextAuth.js
- **Backend**: FastAPI (Python) + SQLAlchemy async + PostgreSQL
- **Auth**: Self-hosted — FastAPI issues JWTs after email/password verification (Argon2id password hashing). NextAuth manages the session cookie. No external auth service.
- **Smart locks**: Local stub access-code lifecycle; live Seam operation gated until durable storage

## Setup

### 1. Create your `.env`
```bash
cp .env.example .env
# Generate strong secrets:
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(48))" >> .env
python -c "import secrets; print('NEXTAUTH_SECRET=' + secrets.token_urlsafe(48))" >> .env
# Then delete the placeholder lines in .env so the generated ones win.
```

For local dev you can also just keep the placeholder values from `.env.example` — they work fine, just don't use them in production.

### 2. Run with Docker
```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

No external accounts needed. The backend container runs `alembic upgrade head`
before starting uvicorn, so the schema is built and up to date on first boot —
there is no separate migration step to remember.

### 3. Seed demo data
```bash
docker-compose exec backend python -m app.seed
```
Creates: 1 space (Espaço Calmo — R. 12 de Julho de 1997 5, Loja 1, 2745-841 Queluz, with map coordinates), 3 rooms at €11/h, 2 packages, and a demo admin user. Re-running it is safe: it never duplicates, and it moves a demo space seeded before it had a real location to the current address.

**Demo login:** `admin@demo.com` / `admin123`

### 4. Register your own user
Visit http://localhost:3000/sign-up — any email/password (min 8 chars) works locally.

To promote an existing user to admin (owner by default):
```bash
docker-compose exec backend python -m app.promote_admin YOUR_EMAIL
```
This adds `YOUR_EMAIL` as `owner` of the seeded demo org (slug `demo-space`). Pass `--role admin` for a non-owner admin, or `--org-slug` to target a different org. Unlike hand-written SQL, an unknown email or org slug fails loudly with a non-zero exit instead of silently doing nothing.

Then re-login — the Admin link will appear in the navbar.

---

## Running locally (without Docker)

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env  # the repo root holds the single env template
# Start Postgres separately (e.g. via OrbStack or brew)
alembic upgrade head     # the app does not create tables; migrations do
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local  # fill in values
npm run dev
```

`NEXTAUTH_SECRET` must be explicitly configured in `frontend/.env.local` (or the
process environment), including for `npm run build`. Missing or blank values
stop the frontend with a configuration error. The example value is for local
development only; generate a private value for deployments.

---

## Project Structure

```
spacerental/
├── backend/              # FastAPI app
│   └── app/
│       ├── models/       # SQLAlchemy models (multi-tenant with org_id)
│       ├── schemas/      # Pydantic v2 schemas
│       ├── routers/      # API routes
│       ├── auth.py       # JWT issuance + Argon2id password hashing
│       └── seed.py       # Demo data
├── frontend/             # Next.js 14 app
│   ├── app/              # App Router pages
│   │   ├── (auth)/       # Sign-in / sign-up pages
│   │   ├── spaces/       # Public space browsing + booking
│   │   ├── dashboard/    # User bookings & packages
│   │   └── admin/        # Admin panel
│   ├── components/       # UI, layout, landing, booking, admin
│   ├── lib/              # API client, utils
│   └── types/            # TypeScript types
├── docker-compose.yml
└── API_SPEC.md           # Full API contract
```

## Multi-tenancy
Every table has `org_id`. Adding a second space operator = new row in `organizations` + membership. No code changes needed.

## Database migrations

Alembic owns the schema everywhere except the test suite. The application never
creates tables: `backend/docker-entrypoint.sh` runs `alembic upgrade head`
before uvicorn starts, so `docker-compose up` on a fresh clone comes up
migrated. Only `backend/tests/conftest.py` builds tables straight from
`Base.metadata`, because each test wants a throwaway schema in milliseconds.

A retained database from before Alembic ownership can contain tables without a
matching migration history. The entrypoint recognizes duplicate-object errors
and prints diagnostic guidance; that error alone does not prove a missing
`alembic_version` table or that stamping is safe. Back up retained data and inspect
its schema and migration state before reconciliation. Do not stamp a revision
unless every schema change in that revision is already present. Do not delete a
retained volume to silence migration errors.

After changing a model:

```bash
docker-compose exec backend alembic revision --autogenerate -m "what changed"
# review the generated file, then:
docker-compose restart backend        # the entrypoint applies it
```

Check model drift on the development database with:

```bash
docker-compose exec backend alembic check
```

The `Migrations` workflow verifies upgrade → check → downgrade → upgrade → check
against its own empty PostgreSQL database, including no leftover tables/enums.
Never run `alembic downgrade base` against retained development or production
data to perform this check. A failed `alembic check` indicates schema/model drift;
inspect the diff before deciding whether a migration or metadata repair is needed.

## Implemented foundations and remaining work

- Stripe checkout and signed completion handling exist for hourly bookings and
  pack purchases, with a walkable local stub checkout. Abandoned holds, payment
  recovery and refunds remain C03/O02.
- Pack redemption confirms immediately and restores hours on eligible
  cancellation. Customer signup joins the configured location as a member (C01).
  The complete isolated package redemption/cancellation journey remains C02.
- **Booking is hourly only**: one or more contiguous hours, picked on a day
  ("Dia") or week ("Semana") calendar view. The week is the default from 1024px
  up, the day below; the customer's own choice sticks for the browser session.
  There are no half-day, full-day, monthly or recurring products. Anything else
  goes through the contact note on the booking page and in the confirm dialog,
  which mails the public contact address (`frontend/lib/contact.ts`).
- **One space, no "choose a space" step**: while exactly one active space is
  public, the landing page lists its rooms, `/spaces` is that space's rooms
  view, and navigation says "Salas". A room card deep-links to
  `/spaces/<id>?room=<roomId>`, which opens that room's calendar. Add a second
  space and the spaces list comes back with no code change
  (`frontend/lib/hooks/useSingleSpace.ts` is the one place that decides).
- **A space has a real location**: address, postcode and optional coordinates,
  edited in the admin space form. Customers get the hours, the contact email,
  the address with a "Como chegar" link, and an OpenStreetMap map that is on
  the page from the start (L04).
- Weekly series are an explicit opt-in pending UTC foundation, parked by the
  owner on 2026-09-19 (flag off, code left in place; R02/R03/R99 DEFERRED).
- Opening hours are the space's wall clock (R01, opening-hours slice):
  `spaces.timezone` (Europe/Lisbon for the pilot) is the clock every room's
  availability rules are read on, so "08:00–22:00" is 08:00–22:00 on the door
  in summer and winter; bookings and slots stay UTC instants. The recurrence
  slice of R01 stays with the parked series work.
- Email confirmation/cancellation uses stub/live gateways and in-process
  background tasks. Durable jobs/retries remain O01.
- Smart-lock stub lifecycle is Q28; live startup is gated until durable
  identifiers and retry state exist (O04).
- Admin booking pagination and PT/EN marketing/layout translation are present.
  Booking and admin copy remain Portuguese. Further pagination/i18n are deferred.

**Rate limiting is per backend process.** The limiter (`backend/app/ratelimit.py`)
keeps its sliding windows in memory, so its budgets are correct for one
replica: with two or more backend processes each counts on its own and the
effective limit multiplies. Move the counters to a shared store (Redis or the
database) before scaling the API out; until then run one replica (Q55).

## Room and space photos

Operators upload photos from the admin (rooms and spaces); customers see them in
a carousel on the room cards and, for the room being booked, as a mosaic
(≥1024px: the first photo big on the left, the rest in a grid; below that a
full-width carousel) with a full-screen gallery behind "Mostrar todas as
fotos". Storage sits behind a gateway (`backend/app/media.py`) like payments,
email and locks. `MEDIA_STORAGE=local` is the default and the only implementation
today: processed photos (WebP, metadata stripped, 1600px + a 480px thumbnail) live
in the `media` Docker volume and the API serves them read-only at `/media`. No
account or credentials. The module marks the seam for S3/R2; any other value stops
the backend at startup rather than quietly writing to local disk.

- `MEDIA_BASE_URL` (default `http://localhost:8000/media`) is the browser-facing
  URL of that directory; change it with the API's public origin.
- Without Docker, files go to `backend/media/` (gitignored).
- `python -m app.seed` gives each demo room the four illustrated room scenes
  from `flowspace-site/assets/img/room-photos/` (`sala-01..04.webp` and their
  thumbnails — the same four for every room, until real photos replace them),
  copied through the same storage as uploads. Compose mounts that folder into
  the backend container and sets `SEED_PHOTOS_DIR=/app/seed-photos`; a native
  run finds the repo's copy by itself, and any other location can be given
  with `SEED_PHOTOS_DIR`. Re-seeding replaces the seed's own photos (and the
  gradients an older seed generated) and leaves an operator's uploads alone.
- Removing the volume (`docker compose down -v`) removes the photos with the
  database, which keeps the two consistent — it is for a disposable stack, not
  a migration.
- The backend image runs as a non-root user (Q53). A `media` volume created by
  an earlier, root-running image makes uploads fail with `EACCES`; fix it once,
  in place, without touching the database:
  `docker compose run --rm --user root backend chown -R app:app /var/lib/spacerental/media`

## Third-party integrations (stub/live)

Stripe, Resend (email), and Seam (smart locks) sit behind credential-free stub
interfaces. `STRIPE_MODE`, `EMAIL_MODE` and `SEAM_MODE` default to `stub`; all tests
run without third-party accounts or network access.

**Email** (`backend/app/email.py`): with `EMAIL_MODE=stub` (the default)
every message is logged and kept in process memory, and — with the explicit
opt-in `TEST_HOOKS_ENABLED=true` (the dev Compose stack sets it; the app's
default is off) outside `APP_ENV=production` — listed by `GET
/__test__/emails` (the last 20: to, subject, reply_to, links). That hook is how the
password-reset browser test follows the link nobody can otherwise receive
locally; the route does not exist without the opt-in or on a production
app, and `tests/test_password_reset.py` proves both. The reset
flow itself: `POST /auth/password-reset/request` always answers 202 with the
same sentence (nobody learns whether an email has an account); the link in
the email is single-use and lives 60 minutes; `POST /auth/password-reset/
confirm` sets the password and signs every earlier session out (`users.
token_version`, carried in the JWT as `tv`; in the signed-in areas the app
also ends the NextAuth session on the first 401 and the dashboard layout
checks the token server-side, so a stale browser lands on
`/sign-in?session=expired`; public pages keep B14's "Entrar e continuar a
compra"). An
operator can send the same
link from the customer's page or set a password directly (`/admin/users/
{id}/password-reset`, `/set-password`); a suspended account
(`users.disabled_at`) can do none of it.

**Smart locks** (`backend/app/locks.py`): webhook/stub checkout confirmation,
admin confirmation and prepaid pack redemption issue an access code. Individual,
admin and recurring-series cancellations revoke it. Failed revocations retain
the identifier for a retry, and cancelled bookings no longer expose the code.
A failed series edit keeps the original codes valid. Stub codes are held in
process memory and disappear on restart. **Live Seam startup is rejected even
with an API key** until persistent identifiers and retry handling ship (O04).
This is a locally testable foundation, not production door access.

To exercise the complete lifecycle locally:

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec -T backend python -m app.seed
# Sign in at http://localhost:3000, book a future slot and pay on stub checkout.
# GET /api/v1/bookings/me with that user's Bearer token exposes access_code.
# Cancel the booking; the subsequent response has no access_code.
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit
```

Unpaid hourly bookings hold their slot for `BOOKING_HOLD_MINUTES` (default
15) while the customer is on Checkout (C03). After that the row reads as
`expired`, the hour is bookable again, and the customer can retry from the
dashboard ("Pagar agora" / "Tentar pagar de novo") if it is still free.
Pressing **Cancelar** on the stub checkout page expires the hold at once.
Expiry is evaluated when availability, conflicts or the customer's bookings
are read; there is no background sweeper yet. A payment that arrives after
the slot was taken by someone else is kept as `paid_unfulfilled` (visible to
the customer and in the admin table) until refunds exist (O02).

```bash
# Walk it locally: book, leave the stub page without paying, then
# open http://localhost:3000/dashboard -> "Pagar agora" -> "Pagar".
# Or press "Cancelar" on the stub page and watch the hour turn green again.
# Shorten the hold to see expiry quickly:
BOOKING_HOLD_MINUTES=1 docker compose up -d backend
```

"Onde estamos" (landing page in single-space mode, and the top of the rooms
page) shows the address, "Como chegar", the contact email, the opening hours
derived from the rooms' availability rules (union across rooms, read as the
space's wall clock, R01) and a click-to-load OpenStreetMap frame
centred on the pin. `CONTACT_PHONE` in `.env` (Compose hands it to the
frontend as `NEXT_PUBLIC_CONTACT_PHONE`) adds a phone line when set; it is
empty by default and no line is rendered.

A customer may book at most `BOOKING_MAX_ADVANCE_DAYS` days ahead (default
30, H01): a later `start_time` is refused, `GET /rooms/{id}/availability`
reports those hours with `reason: "beyond_window"` (and `"past"`, `"booked"`,
`"blocked"` for the others) and refuses a `date` past the window, and the
calendar disables › once the next day/week lies past it, with the hint
"Reservas abertas até <data>". Operators have no horizon: the admin calendar
and `POST /admin/bookings` / `PUT /admin/bookings/{id}` work at any date.
The operator's move and block forms show and take the room's space clock
(`Space.timezone`, R01; `frontend/lib/spaceClock.ts`), not the browser's,
and a new space starts on the organisation's timezone from `/admin/settings`
with its own override.
Compose hands the same value to the frontend as
`NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS`; outside Compose set both.

```bash
# Try a short horizon: › stops after a week and day 8 answers 400.
BOOKING_MAX_ADVANCE_DAYS=7 docker compose up -d --build backend frontend
```

Cancelling a paid booking never refunds money (K01): the paid hours —
`total_amount / hourly_rate` — go to the customer's hour bank as a
"Crédito — cancelamento de <data>" row that spends like any pack, valid for
`CANCELLATION_CREDIT_VALIDITY_DAYS` (default 365; Compose hands it to the
frontend as `NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS` for the cancel
dialog's wording). The customer's cancel dialog and the cancellation email
say so; the operator's cancel dialog has "Creditar as horas ao cliente"
ticked by default and needs a reason when unticked. Reinstating a cancelled
booking takes the credit back unless some of it was already spent (409).

```bash
# As a customer (stub gateways): book 2h hourly, pay on the stub page, then
# cancel from /dashboard — "Os seus packs" lists the 2h credit; book 2h
# again with "Usar horas do pack": confirmed, no checkout.
cd frontend && npx playwright test tests/e2e/cancellation-credit.spec.ts
```

When the hour bank cannot cover a booking (K02), the booking modal offers
"Comprar um pack" next to paying by the hour — first for a customer who
never bought one — with the packs on sale inline. "Comprar" starts the
purchase with `return_to` = the booking page and its slot
(`/spaces/<id>?room=&start=&end=`), so Checkout (Stripe or the stub) lands
back on that slot: the page shows the outcome, reopens the modal with the
new pack preselected if the hours are still free, or the "já está
reservada" notice if someone took them meanwhile. The slot is not held
during the detour.

```bash
# As a fresh customer: pick 2h → "Comprar um pack" → "Comprar" → "Pagar" on
# the stub page → back on the same slot, "Usar horas do pack" preselected.
cd frontend && npx playwright test tests/e2e/pack-upsell.spec.ts
```

---

## Testing

The project has three layers of automated tests plus a pre-commit hook system.

### Backend (pytest)
Run the isolated backend test stack via Docker (recommended):
```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit --build
```
This spins up a throwaway Postgres and runs the full pytest suite against it,
in parallel: `pytest -n auto` (pytest-xdist) starts one worker per CPU and
`tests/conftest.py` gives each worker its own database
(`spacerental_test_gw0`, `gw1`, …), created before its first test and dropped
after its last, so the workers never truncate each other's tables. The
PostgreSQL user must be allowed to `CREATE DATABASE` (the Compose and CI users
own their cluster). A plain `pytest` run stays serial on the configured
database.

Or run locally (requires Postgres on `localhost:5432` with a `spacerental_test` DB):
```bash
cd backend
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental_test pytest -n auto
```

Backend tests run on every PR that touches `backend/**` via `checks.yml` →
`.github/workflows/backend-tests.yml` (see "CI" below).

### Frontend unit tests (Vitest + Testing Library)
```bash
cd frontend
npm install
npm test           # one-shot
npm run test:watch # watch mode
```
Covers `lib/api.ts` response-shape extraction, utility helpers, and key components (Hero, Pricing, SignInForm).

### End-to-end tests (Playwright)

> After changing `frontend/package-lock.json`, recreate the frontend container
> with `docker compose up -d --build -V frontend`: its `node_modules` live in
> an anonymous volume that a plain `--build` keeps, so the browser would still
> be testing the old dependencies.
The suite runs against the **e2e stack** — the dev Compose file plus the
`docker-compose.e2e.yml` overlay — not the dev server:
```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.e2e.yml exec -T backend python -m app.seed
cd frontend
npx playwright install --with-deps chromium
RECURRING_BOOKINGS_ENABLED=true npm run test:e2e
```
The overlay is **for the test stack only**: the frontend is the production
build (`frontend/Dockerfile` target `runner`, `next start`, so pages are not
compiled on first visit mid-test), the backend runs without `--reload`, the
weekly-series flag is on (as in CI; the Playwright process needs
`RECURRING_BOOKINGS_ENABLED=true` too, which is why it is on the command), and
the rate limits are raised to values a parallel suite cannot reach. The
product defaults (10 auth requests and 120 public reads a minute, 5 help
requests an hour) are unchanged in `app/config.py`, `docker-compose.yml` and
`.env.example`, and `backend/tests/test_ratelimit.py` still proves them;
against the plain dev stack the parallel suite would be throttled on the
second worker.

Every test owns its data (`tests/e2e/fixtures.ts`): a room of its own in the
seeded space (the seeded rooms are read-only for the suite), a fresh customer,
and a day shifted per worker, so files and tests run `fullyParallel` and the
whole suite takes about a minute locally. Set `E2E_BASE_URL` if your stack
runs on a non-default URL, and `E2E_API_URL` (default
`http://localhost:8000/api/v1`) when the backend does too — the specs call
the API directly for setup and read the stub mailbox at
`<API root>/__test__/emails`. The suite still assumes **exactly one public
space** (single-space mode; `single-space.spec.ts` and one `photos.spec.ts`
test skip themselves otherwise, TODO.md Q43). Each help request sends two
emails (K03): one to `SUPPORT_INBOX_EMAIL` (default
`geral+support@flowspace.pt`, Reply-To the requester, with a link to the
request in the admin inbox) and a copy to the requester (Reply-To the inbox);
`help.spec.ts` reads both from the stub mailbox.
On a laptop, keep it awake for the run (`caffeinate -i npm run test:e2e` on
macOS): a machine that sleeps mid-run produces timeouts that look like failures.

### Performance harness

Three measurements, all local, none needing credentials (TODO.md P1.1). Every
performance claim in the P-series is a before/after taken with these.
```bash
# Browser: per page TTFB, FCP, LCP, requests by type, bytes on the wire and the
# API waterfall, median of 3 cold loads (PERF_RUNS). Needs the e2e stack above
# (production build); writes frontend/perf-results/<page>.json and summary.md.
cd frontend && npm run perf:web
# Bundles: gzipped first-load JavaScript per route from the manifests of a build.
npm run build && npm run perf:sizes          # frontend/perf-results/sizes.json
npm run analyze                              # @next/bundle-analyzer treemaps in .next/analyze/
# API: the three key reads on a 10 000-booking organisation — bytes per row,
# statements per request (and how many write), the planner's choice, in-process
# latency. Deselected from the default run; writes backend/perf-results/api.json.
docker compose -f docker-compose.test.yml run --rm backend-tests pytest -m perf
```
The Playwright project is `perf` (`playwright.perf.config.ts`), separate from
the e2e suite so neither runs the other; it honours `E2E_BASE_URL` and
`E2E_API_URL` like the e2e specs. Budgets live in `frontend/perf-budget.json`
(asserted when the file exists) and in `BUDGET` in
`backend/tests/perf/test_read_paths.py`.

### Pre-commit hooks
The repo ships with a `.pre-commit-config.yaml` that runs trailing-whitespace fixes, YAML linting, ruff on `backend/`, and frontend `tsc --noEmit` on every commit. Backend pytest and frontend Vitest run on push.

```bash
pip install pre-commit
pre-commit install              # installs the pre-commit hook
pre-commit install -t pre-push  # installs the pre-push hook
```

### CI

One workflow, `checks.yml`, runs on every pull request and on pushes to
`main`. Its `changes` job classifies the diff and calls the real workflows as
reusable workflows only where their area changed: `lint.yml` (Ruff check +
format, ESLint, `tsc`), `backend-tests.yml` (`pytest -n auto`),
`migrations.yml` (upgrade → check → downgrade → upgrade on an empty
PostgreSQL), `frontend-tests.yml` (Vitest + `next build`), `e2e.yml` (two
shards of the Playwright suite, 4 workers each, against the e2e stack built
with `docker buildx bake` and the Actions layer cache; `merge-reports` joins
the shards into one HTML report, uploaded on every run, with stack logs and
traces on a failure) and `docs-sync.yml` (AGENTS.md = CLAUDE.md). It ends in
**`required-checks`**, which passes when every area either succeeded or was
skipped because its paths did not change — so a docs-only PR is never blocked
by a status that will not be reported.

**Branch protection:** require the single status check `required-checks`
(Settings → Branches → the `main` rule → "Require status checks to pass" →
add `required-checks`). Nothing else needs to be required; the per-area
checks are its inputs. `security.yml` (CodeQL on `main` and weekly;
`pip-audit` and `npm audit --audit-level=high` on PRs, reporting until
2026-10-19) and the Pages deploy run on their own and are not required.
Every `uses:` is pinned to a commit SHA, with the version in a trailing
comment; `.github/dependabot.yml` keeps the pins and both dependency trees
current weekly. `.github/CODEOWNERS` asks the owner to review workflow,
auth, payment and migration changes.

### Experimental weekly series

Weekly recurrence is a foundation for local testing, disabled by default. Set
`RECURRING_BOOKINGS_ENABLED=true` in `.env` and recreate both services with
`docker compose up -d --build backend frontend` to opt in. The API creates pending occurrences
without checkout; an administrator must handle them manually. Keep this disabled
for customer use until series payment and local-time scheduling are complete.
Times recur in UTC and therefore shift in Lisbon at daylight-saving changes.

Edit/cancel operations lock the rule and affected bookings, preserve history and
apply the same 24-hour cancellation window and notification/credit behavior as
individual bookings. A rejected edit changes no bookings and sends no emails.
The test suite explicitly enables the foundation and also verifies the disabled
API, concurrent edits, cancellation policy and all-or-nothing conflicts.

### Experimental weekly-series UI

Recurring booking controls are hidden by default. Set `RECURRING_BOOKINGS_ENABLED=true`
in `.env` and recreate both services; Compose forwards the same switch to the API
and `NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED` in Next.js. Outside Compose, set both
explicitly and rebuild the frontend when changing a public environment variable.
The preview uses a fixed UTC cadence (local hours can shift at daylight-saving
changes). Creating a series leaves every occurrence **pending**, with no checkout
or pack debit. The modal requires acknowledgement of manual confirmation/payment.
Paid series, local-time scheduling and full management remain roadmap R01–R03 work.

```bash
RECURRING_BOOKINGS_ENABLED=true docker compose up -d --build
# After seeding as above, sign in and select a room and future slot.
# Toggle “Repetir semanalmente”, choose an end date, then confirm the series.
cd frontend
RECURRING_BOOKINGS_ENABLED=true npm run test:e2e
```


### Customer enrollment and operator setup (C01)

`/sign-up` creates a customer in exactly `CUSTOMER_ENROLLMENT_ORG_SLUG` with the
`member` role. In the local template this is `demo-space`; run the normal seeder
before signup. Set the actual operator slug explicitly elsewhere. An empty or
unknown slug returns 503 without creating an account; setting
`CUSTOMER_ENROLLMENT_ENABLED=false` returns 403 and closes both new signup and
existing-account enrollment. Existing sign-ins and memberships continue working.
Customer signup never creates an organization or grants admin access.

```bash
# From a fresh checkout (preserve existing config on reruns):
if [ ! -e .env ]; then cp .env.example .env; fi
docker compose up -d --build
docker compose exec -T backend python -m app.seed
# Open http://localhost:3000/sign-up and create a unique customer.
# Browse rooms, drag across two free future hours, confirm, then click Pagar
# on the local checkout page. The dashboard shows the confirmed reservation.
cd frontend
npm ci
npx playwright install chromium
npm run test:e2e -- tests/e2e/auth.spec.ts tests/e2e/packages.spec.ts
```

Operator creation is deliberate: `POST /api/v1/auth/register/operator` takes
`{email, password, name}` and creates a new organization owned by that user.
It does not enroll them in any existing location. It uses the same password
validation and shared auth rate limit as customer signup and login. Example
for local stub development only (choose a unique local email on reruns):

```bash
curl --fail-with-body http://localhost:8000/api/v1/auth/register/operator \
  -H 'Content-Type: application/json' \
  -d '{"email":"operator@example.com","password":"local-password123","name":"Local Operator"}'
```

Accounts created by the old signup flow keep their empty organizations and
owner roles. There is no automatic migration or enrollment on login. To join
the configured location explicitly, authenticate and call `POST /auth/enroll`.
The following local script prompts for the existing account and prints only the
resulting membership (requires the backend dependencies):

```bash
docker compose exec backend python -c '
import getpass, httpx
with httpx.Client(base_url="http://127.0.0.1:8000/api/v1") as client:
    login = client.post("/auth/login", json={"email": input("Email: "), "password": getpass.getpass()})
    login.raise_for_status()
    joined = client.post("/auth/enroll", headers={"Authorization": "Bearer " + login.json()["access_token"]})
    joined.raise_for_status()
    print(joined.json())
'
```

Reload the dashboard afterwards, then choose the enrolled location in the
"Organização ativa" selector. Existing accounts may still default to their
original owner organization; membership checks read the database. Repeating
this operation is safe, including concurrent requests: existing member/admin/
owner roles and memberships in other organizations are preserved. No SQL or
schema migration is needed. This explicit API recovery path is intended for
legacy accounts; ordinary new customers use signup.

## flowspace-site

This repo also contains an unrelated static marketing site for the real
flowspace.pt business in `flowspace-site/`, fully decoupled from the
FlowSpace app in `frontend/`/`backend/` (no shared build, no shared server;
they share the brand since W02). See `flowspace-site/README.md`.

**Brand set (B50).** `flowspace-site/assets/img/brand/` is the one source
of the logo, favicons, Open Graph card and email logo (its `README.md` lists
each file). The app serves a byte-for-byte copy from `frontend/public/brand/`
— `tests/lib/brandParity.test.ts` fails if the two drift, so change the
static site's folder and copy it over. Both sites render the horizontal
lockup through `<svg><use href="…/logo-horizontal.svg#lockup">` so the
file's `currentColor` follows the CSS `color` of its link (green in the
header, white in the footer) with one asset; HTML emails open with
`<FRONTEND_URL>/brand/logo-email.png`. `metadataBase` comes from
`NEXTAUTH_URL`, so Open Graph image URLs are absolute on a deployed app
(Next 14 always uses `localhost` in `next dev`).
