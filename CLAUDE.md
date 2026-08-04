# CLAUDE.md — Guidance for AI agents (and humans) working on this codebase

This document captures the *why* behind the architecture, the non-obvious gotchas, and the conventions every contributor should follow. If you read only one file before changing code, read this one.

---

## 1. What this project is

**EspaçoHora** is a multi-tenant SaaS for renting professional spaces (therapy rooms, consultation offices, coworking) by the hour. It started as a POC to evaluate a single physical location in Lisbon and is designed to grow into a platform other space operators can use.

**Status:** WIP / early POC. Architecture is in place; payments, smart-lock integration, and email notifications are deliberately stubbed for now.

**Reference UI:** [flowspace.pt](https://flowspace.pt/) — a Portuguese therapy space rental site. Our UI intentionally mirrors its structure and tone (Portuguese copy, soft sage-green palette, hour-based pricing).

---

## 2. Architecture at a glance

```
┌──────────────┐       Bearer JWT         ┌──────────────┐
│  Next.js 14  │ ───────────────────────► │   FastAPI    │
│  (frontend)  │                          │   (backend)  │
│              │ ◄─── session cookie ──── │              │
│  NextAuth.js │      (NextAuth-managed)  │  Argon2id PW │
└──────┬───────┘                          └──────┬───────┘
       │                                          │
       │                                  ┌───────▼───────┐
       │                                  │  PostgreSQL   │
       │                                  │  (multi-tenant│
       │                                  │   via org_id) │
       │                                  └───────────────┘
       │
       └─► future: Seam API for smart-lock access codes
```

**Two distinct auth flows you must understand:**

1. **NextAuth session** (browser ↔ Next.js): an encrypted httpOnly cookie containing the FastAPI-issued JWT plus user metadata. Managed entirely by `next-auth` v4 with `CredentialsProvider`. Used to gate Next.js routes via `middleware.ts` and to know "is the user logged in?" in components.

2. **FastAPI JWT** (Next.js ↔ FastAPI): an HS256 JWT signed with `SECRET_KEY`, issued by `POST /auth/login` and `POST /auth/register`. Stored inside the NextAuth session as `session.accessToken`. Used as a Bearer header for every API call.

The two are linked: `authorize()` in `app/api/auth/[...nextauth]/route.ts` calls FastAPI's `/auth/login`, stashes the returned JWT in the NextAuth JWT callback, then surfaces it via the session callback.

---

## 3. Tech stack and why

| Layer | Choice | Why this and not something else |
|---|---|---|
| Frontend framework | **Next.js 14 App Router** | Battle-tested, SSR-friendly, huge ecosystem. Rejected Remix (smaller community), SvelteKit (less mature for SaaS dashboards). |
| Styling | **Tailwind + shadcn-style primitives** | Fast iteration, no CSS-in-JS overhead, components live in our repo (not a dependency). |
| Frontend auth | **NextAuth.js v4** + CredentialsProvider | Self-hosted, SOC2-compatible, no external dependency. v4 (stable) chosen over v5 (beta) for now. |
| Backend framework | **FastAPI** (async) | Type hints, auto-generated OpenAPI docs, async-first. |
| ORM | **SQLAlchemy 2.0 async** + asyncpg | Mature, declarative, supports complex multi-tenant queries. |
| Password hashing | **Argon2id** via `argon2-cffi` | OWASP #1 recommendation, no length limit (unlike bcrypt). Parameters: `m=64MB, t=3, p=4`. |
| JWT | **python-jose** HS256 | Stateless, easy to verify, shared `SECRET_KEY`. |
| DB | **PostgreSQL 16** | Required (uses `uuid-ossp`, `ARRAY`, `JSONB`, `TIMESTAMPTZ`). Not SQLite-compatible. |
| Tests (backend) | **pytest + pytest-asyncio + httpx** | Real PostgreSQL fixtures, no mocks for the DB layer. |
| Tests (frontend) | **Vitest + Testing Library** | Faster than Jest, native ESM. |
| E2E | **Playwright** | Best browser automation, single tool for all browsers. |
| Pre-commit | **pre-commit framework** | Language-agnostic, runs Ruff + tsc + tests. |

---

## 4. Multi-tenancy — read this before touching the data model

**Every business entity has `org_id`.** This is non-negotiable. The intent is:

- A new space operator = a new row in `organizations`, nothing else changes.
- Users can belong to multiple organizations via `organization_members` (with a role: `owner`, `admin`, `member`).
- All admin endpoints take an `org_id` query parameter or path parameter — the admin check is *per-org*, not global.

**Implications when adding a new table:**

- It almost certainly needs `org_id` as a foreign key.
- Indexes should usually be on `(org_id, other_field)`, not just `other_field`.
- Queries must always filter by `org_id` for the current user's accessible orgs. There is no implicit tenant scoping at the ORM level (yet — we may add Row-Level Security later).

**Implications when adding a new endpoint:**

- Public endpoints can skip the org filter (e.g., listing all active spaces).
- User endpoints scope to the user's bookings/packages directly.
- Admin endpoints **must** call `require_admin(org_id=...)` from `app/auth.py`.

---

## 5. The API response contract — do not break this

**All list endpoints wrap their results in an object** keyed by the entity name:

```json
GET /api/v1/spaces       → {"spaces": [...]}
GET /api/v1/bookings/me  → {"bookings": [...]}
GET /api/v1/admin/users  → {"users": [...]}
```

**All single-resource endpoints similarly wrap:**

```json
POST /api/v1/bookings    → {"booking": {...}}
GET  /api/v1/spaces/{id} → {"space": {...}, "rooms": [...]}
```

**Frontend `lib/api.ts` is responsible for extracting** the wrapped field and returning the bare data to callers:

```typescript
list: (api) => api.get<{ spaces: Space[] }>('/spaces').then(r => r.data.spaces)
```

This contract exists so we can add metadata later (pagination, totals, cursors) without breaking clients. **If you add a new endpoint:**

1. Wrap the response on the backend.
2. Add the extraction layer to `lib/api.ts`.
3. Add a unit test in `tests/lib/api.test.ts` documenting the shape.

A bug from this pattern bit us once already — the dashboard crashed because `bookings` was `{bookings: []}` instead of `[]`. The `lib/api.test.ts` suite exists specifically to prevent recurrence.

---

## 6. Gotchas the test suite documents

These are subtle issues that already cost us time. Learn from them.

### 6.1 asyncpg + pytest-asyncio: connections leak across event loops
Symptom: `cannot perform operation: another operation is in progress`.

Cause: asyncpg connections are bound to the event loop that created them. With pytest-asyncio in `auto` mode, fixtures and tests can run in different loops, and a pooled connection from a previous loop blows up when reused.

Fix (in `tests/conftest.py`): use `poolclass=NullPool` on the test engine so each operation gets a fresh connection.

### 6.2 SQLAlchemy identity map serving stale objects
Symptom: a test fixture creates a parent and a child; the route loads the parent with `selectinload(parent.children)`; the route sees zero children.

Cause: the parent was already loaded into the session's identity map (by an earlier fixture), so `selectinload` returns the cached object without re-fetching its relationships.

Fix: the HTTP route handler uses a **different** session from the one used by fixtures. In `tests/conftest.py`, `client` fixture creates a new session per request via `session_factory()`.

### 6.3 Docker networking: `localhost` ≠ host machine
Symptom: NextAuth server-side code calls `http://localhost:8000` and gets connection refused inside Docker.

Cause: `localhost` inside the frontend container points to the container itself, not the backend container.

Fix: the NextAuth handler uses `INTERNAL_API_URL=http://backend:8000/api/v1` for server-side fetches and `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` for browser-side fetches. **Never use `localhost` for cross-service Docker calls.**

### 6.4 bcrypt has a 72-byte password limit
We don't use bcrypt anymore — we use Argon2id. If anyone tries to "simplify" by switching to bcrypt, they'll truncate or reject long passwords. Don't.

---

## 7. Project layout

```
spacerental/
├── backend/                          # FastAPI app
│   ├── app/
│   │   ├── main.py                   # FastAPI app factory + CORS + router includes
│   │   ├── config.py                 # pydantic-settings Settings class
│   │   ├── database.py               # Async engine + session factory + Base
│   │   ├── auth.py                   # Argon2 hashing + JWT issuance + dependencies
│   │   ├── seed.py                   # Idempotent demo data seeder
│   │   ├── models/                   # SQLAlchemy 2.0 models — always include org_id
│   │   ├── schemas/                  # Pydantic v2 schemas (request/response shapes)
│   │   └── routers/                  # One file per resource: auth, spaces, bookings, packages, admin
│   ├── tests/
│   │   ├── conftest.py               # Fixtures: engine, session, client, users, org, space, room
│   │   ├── test_auth.py              # Register, login, JWT, password rules
│   │   ├── test_spaces.py            # Listing, detail, availability
│   │   ├── test_bookings.py          # Create, overlap, isolation, cancel
│   │   ├── test_packages.py          # List, purchase, redemption
│   │   └── test_admin.py             # Role gating, CRUD, dashboard
│   ├── alembic/                      # Migrations (only generate manually for now)
│   ├── Dockerfile                    # Dev image (uvicorn --reload)
│   ├── Dockerfile.test               # Test runner image
│   ├── requirements.txt
│   └── requirements-dev.txt          # Adds pytest, httpx, pytest-asyncio
│
├── frontend/                         # Next.js 14 App Router
│   ├── app/
│   │   ├── layout.tsx                # Root layout — wraps with <Providers>
│   │   ├── providers.tsx             # SessionProvider + QueryClientProvider
│   │   ├── page.tsx                  # Landing page (Hero, Pricing, etc.)
│   │   ├── api/auth/[...nextauth]/   # NextAuth handler — CredentialsProvider → FastAPI
│   │   ├── (auth)/                   # Sign-in / sign-up routes (auth route group)
│   │   ├── spaces/                   # Public space browsing + booking calendar
│   │   ├── dashboard/                # User bookings & packages (auth required)
│   │   └── admin/                    # Admin panel (admin role required)
│   ├── components/
│   │   ├── ui/                       # shadcn-style primitives (Button, Card, Dialog, …)
│   │   ├── layout/                   # Navbar, Footer
│   │   ├── landing/                  # Hero, Pricing, HowItWorks, SpaceCards, ValueProps
│   │   ├── spaces/                   # RoomCard
│   │   ├── booking/                  # BookingCalendar (react-big-calendar), BookingModal
│   │   └── admin/                    # StatsCard, BookingsTable
│   ├── lib/
│   │   ├── api.ts                    # Axios client + typed wrappers per endpoint (extracts wrapped responses)
│   │   └── utils.ts                  # cn(), formatCurrency, STATUS_LABELS
│   ├── types/
│   │   ├── index.ts                  # Domain types: Space, Room, Booking, User, …
│   │   └── next-auth.d.ts            # Augments Session with accessToken + role
│   ├── middleware.ts                 # NextAuth route protection for /dashboard + /admin
│   └── tests/
│       ├── setup.ts                  # jest-dom + mocks for next/navigation & next-auth/react
│       ├── lib/                      # Unit tests for api.ts and utils.ts
│       ├── components/               # Component tests (Hero, Pricing, SignInForm)
│       └── e2e/                      # Playwright specs (auth, booking, admin)
│
├── docker-compose.yml                # Dev stack (db + backend + frontend)
├── docker-compose.test.yml           # Test stack (throwaway db + pytest runner)
├── .pre-commit-config.yaml           # Ruff, tsc, fast tests
├── .github/workflows/                # backend-tests, frontend-tests, e2e, lint
├── .env.example                      # Template; copy to .env (gitignored)
├── README.md                         # User-facing setup
├── CLAUDE.md                         # ← you are here
└── API_SPEC.md                       # Endpoint reference
```

---

## 8. Common tasks

### 8.1 Adding a new API endpoint

1. **Route**: add a function in the appropriate `backend/app/routers/<resource>.py`.
2. **Schema**: add Pydantic request/response models in `backend/app/schemas/<resource>.py` and export from `schemas/__init__.py`.
3. **Response shape**: wrap the result — `return {"items": [...]}` or `return {"item": {...}}`.
4. **Frontend wrapper**: add a typed function in `frontend/lib/api.ts` that extracts the wrapped field.
5. **Tests**: add a happy-path and a failure-path test in `backend/tests/test_<resource>.py`.
6. **Optional unit test**: add a shape-extraction test in `frontend/tests/lib/api.test.ts` if the new endpoint is complex.

### 8.2 Adding a new database model

1. Create the file under `backend/app/models/<name>.py`.
2. **Include `org_id` as a foreign key** unless this entity is genuinely tenant-agnostic (rare).
3. Import the model in `backend/app/models/__init__.py` so `Base.metadata` knows about it.
4. Generate a migration (when alembic is fully wired): `alembic revision --autogenerate -m "..."` then review.
5. Update `seed.py` if it makes sense to seed defaults.
6. Add a fixture in `tests/conftest.py` if the model is referenced from multiple test files.

### 8.3 Adding a new admin-only endpoint

```python
@router.get("/admin/something")
async def something(
    org_id: uuid.UUID = Query(...),
    _: User = Depends(require_admin),   # ← enforces admin/owner role in this org
    db: AsyncSession = Depends(get_db),
):
    ...
```

The `require_admin` dependency reads `org_id` from the query, looks up the user's `OrganizationMember` row, and 403s if they're not `admin` or `owner`.

### 8.4 Adding a new frontend page

- Public page → put it under `app/` directly.
- Authenticated user page → put under `app/dashboard/` (gated by `middleware.ts` + `dashboard/layout.tsx`).
- Admin page → put under `app/admin/` (additionally gated by `admin/layout.tsx` which checks `session.role`).

Always use `useSession()` to get the current user — never `useUser` (that was the old Clerk hook and is gone).

### 8.5 Running the tests

```bash
# Backend — full suite in a throwaway docker stack
docker-compose -f docker-compose.test.yml up --build

# Frontend — Vitest
cd frontend && npm test

# E2E — requires the dev stack running and seeded
cd frontend && npm run test:e2e
```

If you change the backend `Dockerfile.test` or `requirements-dev.txt`, you **must** pass `--build` to the test compose command, otherwise it reuses the old image.

### 8.6 Working with the database directly

```bash
docker-compose exec db psql -U spacerental -d spacerental
```

Useful queries:
- `\dt` — list tables
- `SELECT id, email, name FROM users;` — find users
- `INSERT INTO organization_members (org_id, user_id, role) VALUES (...)` — manually promote a user

---

## 9. Conventions

### Backend
- Always use **async** route handlers and SQLAlchemy sessions.
- Always use **Pydantic v2 syntax** (`model_config = ConfigDict(...)`, `from_attributes=True`).
- Status codes: 201 for creates, 204 for deletes with no body, 404 for missing, 403 for forbidden, 401 for unauthenticated.
- Use UUID primary keys generated server-side via `func.uuid_generate_v4()`.
- Decimals (`hourly_rate`, `total_amount`) — never use floats for money.
- Times in UTC, stored as `TIMESTAMPTZ`.

### Frontend
- No `any` types. If you need to escape the type system, comment why.
- Use shadcn-style component primitives from `components/ui/` — don't add a second UI library.
- All UI copy is **Portuguese** (this is a Portugal-targeted product). Don't mix English in.
- Use `useSession()` for auth state, never reach into cookies directly.
- API calls go through `lib/api.ts` — don't call `axios` or `fetch` directly from components.
- Currency formatting via `formatCurrency()`, dates via `date-fns` with `locale: pt`.

### Both sides
- Prefer **fewer, larger PRs** over many tiny ones for related changes — easier to review and revert.
- Don't add comments that restate the code. Only comment **why**, not **what**.
- No silent fallbacks. If `process.env.X` is missing, fail loudly.

---

## 10. Workflow — worktrees, branching, and testing

### 10.1 Never work on `main`

- **All work happens on a feature branch.** Branch from an up-to-date `main`, named `feat/…`, `fix/…`, `chore/…`, `test/…`, or `docs/…`.
- **Never commit directly to `main`.** `main` only advances through a reviewed PR merge. If you find yourself on `main` with changes staged, branch first, then commit.
- **Always work in a git worktree**, not the primary checkout:
  ```bash
  git worktree add ../spacerental-<slug> -b feat/<slug> main
  ```
  This keeps the main checkout clean and lets parallel workstreams (and parallel agents) coexist without stepping on each other's uncommitted files. Remove it when the branch merges: `git worktree remove ../spacerental-<slug>`.
- One branch = one coherent change. Per §9, prefer fewer, larger PRs for related work over a scatter of tiny ones.

### 10.2 Every contribution ships with tests

No code change merges without test coverage appropriate to what changed. Pick the *right* level — over-testing at the wrong level is as much a problem as no tests at all.

| Level | Use it for | Where it lives | Do **not** use it for |
|---|---|---|---|
| **Unit** | Pure logic with no I/O: pricing/duration math, Pydantic schema validation, `lib/utils.ts` helpers, `lib/api.ts` response-shape extraction. | `backend/tests/test_*.py` (plain functions), `frontend/tests/lib/`, `frontend/tests/components/` | Anything that needs a DB or a live route — that's an integration test. |
| **Integration** | **The default for any new or changed endpoint.** A real route hit through the `client` fixture against a real PostgreSQL: auth gating, `org_id` isolation, status codes, response wrapping. | `backend/tests/test_<resource>.py` | Standing in for unit tests of pure helpers — it's slower and hides the actual failure. |
| **E2E** | User-visible flows that cross frontend *and* backend: sign-in, browse → book → see it on the dashboard, admin CRUD. | `frontend/tests/e2e/*.spec.ts` (Playwright) | Per-endpoint coverage. E2E is for flows, not for enumerating API cases — that's what integration tests are for. |

Concretely, when you touch:

- **A backend endpoint** → integration test with at least one happy path *and* one failure path (403 for wrong role, 404 for missing, 409 for conflict). Never mock the DB.
- **A backend model or migration** → integration test proving the constraint/index actually does what it claims (e.g. an overlapping insert raises).
- **A frontend component** → component test for rendered behavior and interaction, not for pinning marketing copy (we deleted those once already — don't reintroduce them).
- **`lib/api.ts`** → a shape-extraction unit test in `frontend/tests/lib/api.test.ts`. This suite exists specifically to stop the wrapped-response bug from §5 recurring.
- **A user-facing flow** → extend or add a Playwright spec.

Run the full suite (§8.5 — backend pytest, frontend Vitest, Playwright E2E) before opening a PR. CI runs all three; a red pipeline is not "someone else's problem."

### 10.3 Everything must be runnable and testable locally

**No feature may require a real external account, a paid service, or a deployed environment in order to run or be tested.** If you can't exercise it on a laptop with no credentials, it isn't done.

This applies hardest to the integrations in §11 (Stripe, Seam, Resend/Postmark). For each one:

- **Put the third party behind a thin interface in its own module** (e.g. `app/payments.py`, `app/locks.py`, `app/email.py`) with two implementations: the real client and a local fake. Nothing else in the codebase imports the vendor SDK directly.
- **Select the implementation with an explicit env var** — `STRIPE_MODE=stub|live`, `SEAM_MODE=stub|live`. Per §9, the switch is explicit and loud: in `live` mode a missing API key raises at startup. **Never silently fall back to the fake** — a stub quietly running in production is worse than a crash.
- **The full test suite must pass with zero third-party credentials configured**, and tests must never touch the network.
- **Prefer a real local emulator over a hand-rolled fake** where one exists — `stripe listen --forward-to` for webhooks, Mailpit/Mailhog for email. They catch integration mistakes a fake never will.
- **The local dev stack (`docker-compose up`) must come up clean on a fresh clone** with only `.env.example` copied to `.env`. If your feature adds a required env var, give it a working default for stub mode and document it in `.env.example`.

**Every PR that adds a feature must include a "How to test this locally" section** with the exact commands — start the stack, seed, hit the endpoint, observe the result. Not a description; runnable commands. If the feature introduces a lasting local workflow (a new service, an emulator, a seeding step), add it to `README.md` too.

---

## 11. What's intentionally not done yet

These are deferred for a reason — don't quietly add them without a discussion:

- **Stripe payments**: `Booking.total_amount` exists, the model is ready. Wire on demand.
- **Seam API smart-lock integration**: booking timestamps are perfectly shaped for issuing time-scoped access codes. One Seam call inside `POST /bookings`.
- **Email notifications**: should go via a queue (probably Resend or Postmark + a worker), not synchronous in the request.
- **Pagination**: the wrapped response shape supports adding it without breaking clients.
- **Row-level security (RLS)** in PostgreSQL: would replace the manual `org_id` filters in every query.
- **Rate limiting**: needed before exposing to the public internet.
- **Audit log**: who-did-what for booking cancellations, role changes, etc.
- **i18n**: copy is hardcoded Portuguese. If we go multi-region, extract to a translation file.

---

## 12. Things you should never do

- **Never commit directly to `main`** — branch, PR, merge. See §10.1.
- **Never merge code without tests** at the right level (unit / integration / E2E). See §10.2.
- **Never commit `.env`** — only `.env.example` is committed.
- **Never store passwords in plaintext or with reversible encryption** — always Argon2id via `app.auth.hash_password()`.
- **Never bypass `require_admin`** in admin endpoints by checking the user directly. Use the dependency.
- **Never use `localhost` for backend ↔ backend calls inside Docker** — use the service name (`backend`, `db`).
- **Never return SQLAlchemy model instances directly** from a route — always go through a Pydantic schema (`SomeOut.model_validate(model)`).
- **Never break the wrapped-response contract** without updating `lib/api.ts` in the same PR.
- **Never disable a test** to make CI green. Fix it or delete it with an explanation.
