import { chromium, type FullConfig } from '@playwright/test'

// Authenticates once, before any spec runs, and saves the resulting session
// (cookies + localStorage) to disk so specs that only need to *be* an admin
// user — not exercise the sign-in form itself — can skip the real login.
//
// Why this exists (see TODO.md T3): admin.spec.ts used to sign in via the
// real UI in a `beforeEach`, once per test. `POST /auth/login` sits behind
// the backend's auth-tier rate limiter (10 req/60s, shared across every
// spec file because they all funnel through the same Next.js server-side
// `authorize()` call, which is a single client identity to the limiter).
// Across a full `--repeat-each` or CI run, accumulated logins from admin,
// auth, booking and packages specs eventually cross that threshold; the
// login that trips it gets back a 429, which next-auth's authorize()
// treats exactly like a wrong password, so the sign-in page shows "Email
// ou password incorretos." and the test's `waitForURL('**/dashboard')`
// hangs until timeout. It isn't a client-side session/redirect race — the
// backend genuinely refused the login. Confirmed via
// `test-results/**/error-context.md` on a reproduced failure: the page
// snapshot showed the sign-in form still on screen with that exact error
// text, not a stuck loading state.
//
// Logging in once here — guaranteed to be the very first auth request of
// the run — sidesteps that shared bucket entirely for specs (admin.spec.ts)
// that don't need to test the login flow itself.
export const ADMIN_STORAGE_STATE = 'tests/e2e/.auth/admin.json'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL })
  const page = await context.newPage()

  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill('admin@demo.com')
  await page.getByLabel('Password').fill('admin123')
  await page.getByRole('button', { name: /Entrar/i }).click()
  // 30s: this is the very first page load of the run, so it also pays for
  // the dev server's cold compile of /sign-in and /dashboard.
  await page.waitForURL('**/dashboard', { timeout: 30000 })

  await context.storageState({ path: ADMIN_STORAGE_STATE })
  await browser.close()
}
