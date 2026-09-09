# EspaçoHora — Space Rental Platform

> **Early proof of concept.** Hourly checkout, prepaid packs, admin tools and local email/access-code flows are implemented. The product is not production-ready: customer enrollment, payment recovery, durable notifications/access and other outcome gates remain open. See [roadmap.md](roadmap.md) for the agreed outcome order and [TODO.md](TODO.md) for executable tasks; broader implementation is on hold.

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
Creates: 1 space (Espaço Calmo, Lisboa), 3 rooms at €11/h, 2 packages, and a demo admin user.

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
  cancellation. Fresh customer enrollment and an isolated complete customer
  journey remain C01/C02; signup currently creates a new operator organization.
- Weekly series are an explicit opt-in pending UTC foundation. Paid series,
  Lisbon wall-clock scheduling and full series management remain R01–R03.
- Email confirmation/cancellation uses stub/live gateways and in-process
  background tasks. Durable jobs/retries remain O01.
- Smart-lock stub lifecycle is Q28; live startup is gated until durable
  identifiers and retry state exist (O04).
- Admin booking pagination and PT/EN marketing/layout translation are present.
  Booking and admin copy remain Portuguese. Further pagination/i18n are deferred.


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
Requires the full app stack running locally (`docker-compose up`) plus seeded data (`docker-compose exec backend python -m app.seed`).
```bash
cd frontend
npx playwright install --with-deps chromium
npm run test:e2e
```
The E2E suite exercises auth (sign-up, sign-in, protected routes), space browsing, and the admin dashboard. Set `E2E_BASE_URL` if your stack runs on a non-default URL.

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
`RECURRING_BOOKINGS_ENABLED=true` in `.env` and recreate the backend with
`docker compose up -d backend` to opt in. The API creates pending occurrences
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
Paid series and local-time scheduling remain roadmap R02/R03 work.

```bash
RECURRING_BOOKINGS_ENABLED=true docker compose up -d --build
# After seeding as above, sign in and select a room and future slot.
# Toggle “Repetir semanalmente”, choose an end date, then confirm the series.
cd frontend
RECURRING_BOOKINGS_ENABLED=true npm run test:e2e
```
