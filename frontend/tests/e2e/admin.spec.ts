import { test, expect, request as playwrightRequest } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

// Pre-authenticated via global-setup.ts, not a real sign-in per test — see
// that file (and TODO.md T3) for why: repeated logins through the real form
// share the backend's auth-tier rate limit with every other spec, and the
// resulting 429 used to masquerade as a wrong-password error, hanging
// `waitForURL('**/dashboard')` until timeout. These tests only need to *be*
// an admin, not exercise the login UI, so they skip it.
test.use({ storageState: ADMIN_STORAGE_STATE })

test.describe('Admin', () => {
  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
    // 15s: first visit pays for the dev server's cold compile of /admin.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  })

  test('admin can view spaces list', async ({ page }) => {
    await page.goto('/admin/spaces')
    await expect(page.getByRole('heading', { name: 'Espaços' })).toBeVisible({ timeout: 15000 })
  })
})

// B22: an operator's admin session must survive a reload and a cold deep
// link. The bounce came from OrgContext resolving the current org in a
// later effect, so one render saw memberships loaded but no current
// membership and redirected to /dashboard.
test.describe('Admin session persistence (B22)', () => {
  test('reload on /admin keeps the operator in admin', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
    // Give any late redirect effect the chance to fire before asserting.
    await page.waitForTimeout(1500)
    expect(new URL(page.url()).pathname).toBe('/admin')
  })

  test('a cold deep link to /admin/bookings stays in admin', async ({ page }) => {
    await page.goto('/admin/bookings')
    await expect(page.getByRole('heading', { name: 'Todas as Reservas' })).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1500)
    expect(new URL(page.url()).pathname).toBe('/admin/bookings')
  })

  test('a plain member is still redirected away from /admin', async ({ browser, baseURL }) => {
    const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
    const email = `member-b22-${Date.now()}@example.com`
    const password = 'password123'
    const api = await playwrightRequest.newContext({ baseURL })
    try {
      const registered = await api.post(`${API_URL}/auth/register`, {
        data: { email, password, name: 'Membro B22' },
      })
      expect(registered.status(), await registered.text()).toBe(201)
      expect((await registered.json()).role).toBe('member')

      // NextAuth session for that member, same handshake as global-setup.ts.
      const { csrfToken } = await (await api.get('/api/auth/csrf')).json()
      const signedIn = await api.post('/api/auth/callback/credentials', {
        form: { csrfToken, email, password, callbackUrl: new URL('/dashboard', baseURL!).href, json: 'true' },
      })
      expect(signedIn.ok()).toBeTruthy()
      const state = await api.storageState()
      const context = await browser.newContext({ storageState: state })
      const page = await context.newPage()
      try {
        await page.goto('/admin')
        await page.waitForURL('**/dashboard', { timeout: 15000 })
        expect(new URL(page.url()).pathname).toBe('/dashboard')
      } finally {
        await context.close()
      }
    } finally {
      await api.dispose()
    }
  })
})
