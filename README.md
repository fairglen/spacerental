# EspaçoHora — Space Rental Platform

> ⚠️ **Work in Progress** — this is an early proof-of-concept. The architecture is in place (auth, bookings, admin, smart-lock-ready data model) and a test suite exists, but the product is not production-ready. Expect breaking changes, rough edges, and missing features (payments, email notifications, smart-lock integration). Feedback and contributions welcome.

## Stack
- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS + NextAuth.js
- **Backend**: FastAPI (Python) + SQLAlchemy async + PostgreSQL
- **Auth**: Self-hosted — FastAPI issues JWTs after email/password verification (Argon2id hashing, NIST SP 800-63B + OWASP compliant). NextAuth manages the session cookie. No external auth service.
- **Smart locks**: Architecture ready for Seam API integration (not wired yet)

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

No external accounts needed.

### 3. Seed demo data
```bash
docker-compose exec backend python -m app.seed
```
Creates: 1 space (Espaço Calmo, Lisboa), 3 rooms at €11/h, 2 packages, and a demo admin user.

**Demo login:** `admin@demo.com` / `admin123`

### 4. Register your own user
Visit http://localhost:3000/sign-up — any email/password (min 8 chars) works locally.

To promote an existing user to admin:
```bash
docker-compose exec db psql -U spacerental -d spacerental -c \
  "INSERT INTO organization_members (org_id, user_id, role)
   SELECT (SELECT id FROM organizations LIMIT 1), id, 'owner'
   FROM users WHERE email='YOUR_EMAIL';"
```
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

## What's not wired yet
- **Payments** (Stripe): booking model has `payment_method` and `total_amount` ready; add Stripe checkout before going live
- **Smart locks** (Seam API): booking model has all timestamps needed; wire `POST /bookings` to issue a time-scoped access code via Seam
- **Email notifications**: add on booking confirmation

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
