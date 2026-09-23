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
  edited in the admin space form. Customers get a "Como chegar" link and an
  OpenStreetMap preview that loads only when they press "Ver mapa".
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
  database, which keeps the two consistent.

## Third-party integrations (stub/live)

Stripe, Resend (email), and Seam (smart locks) sit behind credential-free stub
interfaces. `STRIPE_MODE`, `EMAIL_MODE` and `SEAM_MODE` default to `stub`; all tests
run without third-party accounts or network access.

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
Compose hands the same value to the frontend as
`NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS`; outside Compose set both.

```bash
# Try a short horizon: › stops after a week and day 8 answers 400.
BOOKING_MAX_ADVANCE_DAYS=7 docker compose up -d --build backend frontend
```

---

## Testing

The project has three layers of automated tests plus a pre-commit hook system.

### Backend (pytest)
Run the isolated backend test stack via Docker (recommended):
```bash
docker-compose -f docker-compose.test.yml up --abort-on-container-exit --build
```
This spins up a throwaway Postgres and runs the full pytest suite against it.

Or run locally (requires Postgres on `localhost:5432` with a `spacerental_test` DB):
```bash
cd backend
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql+asyncpg://spacerental:spacerental@localhost:5432/spacerental_test pytest
```

Backend tests run automatically on every push and PR via `.github/workflows/backend-tests.yml`.

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
Requires the full app stack running locally (`docker-compose up`) plus seeded data (`docker-compose exec backend python -m app.seed`).
```bash
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
```
The E2E suite exercises auth (sign-up, sign-in, protected routes), space browsing, and the admin dashboard. Set `E2E_BASE_URL` if your stack runs on a non-default URL.

The suite assumes the seeded stack: **exactly one public space**, which is what
puts the app in single-space mode (`single-space.spec.ts` skips itself
otherwise). Every browser shares one backend rate-limit budget (120 public reads
a minute), so a few spec files deliberately wait out a 60-second window at their
boundary; the full run takes several minutes and those pauses are not hangs.
The help form is throttled at 5 requests an hour per client and the suite sends
four, so restart the backend (`docker compose restart backend`) before running
it a second time within an hour, or the fifth request answers 429.
CI runs this suite with `RECURRING_BOOKINGS_ENABLED=true` (the weekly-series
spec only runs its full body then), so before opening a PR run it that way too:
start the stack with that variable set and pass it to `npm run test:e2e`.
On a laptop, keep it awake for the run (`caffeinate -i npm run test:e2e` on
macOS): a machine that sleeps mid-run produces timeouts that look like failures.

### Pre-commit hooks
The repo ships with a `.pre-commit-config.yaml` that runs trailing-whitespace fixes, YAML linting, ruff on `backend/`, and frontend `tsc --noEmit` on every commit. Backend pytest and frontend Vitest run on push.

```bash
pip install pre-commit
pre-commit install              # installs the pre-commit hook
pre-commit install -t pre-push  # installs the pre-push hook
```

### CI
GitHub Actions (`.github/workflows/frontend-tests.yml` and `e2e.yml`) run unit tests on every frontend change and full E2E tests against a Dockerized stack on every PR. Failing E2E runs upload the Playwright HTML report as a build artifact.

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
