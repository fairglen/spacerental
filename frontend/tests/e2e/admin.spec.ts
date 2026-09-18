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

// C06: an operator's price change must reach the landing page and the amount
// charged. Lives here rather than in packages.spec.ts because this spec runs
// first: the landing page costs three public-tier requests, and by the time
// the packages spec runs the suite has little of that budget left.
test.describe('Pricing follows the operator (C06)', () => {
  const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

  test('a price change reaches the landing card and the checkout amount', async ({ page, baseURL }) => {
    const api = await playwrightRequest.newContext({ baseURL })
    try {
      const login = await api.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
      expect(login.ok(), await login.text()).toBeTruthy()
      const headers = { Authorization: `Bearer ${(await login.json()).access_token}` }
      const { memberships } = await (await api.get(`${API_URL}/auth/memberships`, { headers })).json()
      const orgId = memberships[0].org_id
      const { packages } = await (await api.get(`${API_URL}/admin/packages`, { headers, params: { org_id: orgId } })).json()
      const pkg20h = packages.find((p: { hours: number }) => p.hours === 20)
      expect(pkg20h, 'the seeded 20h pack is required').toBeTruthy()
      const originalPrice = Number(pkg20h.price)

      const updated = await api.put(`${API_URL}/admin/packages/${pkg20h.id}`, {
        headers, params: { org_id: orgId }, data: { price: 177.5 },
      })
      expect(updated.ok(), await updated.text()).toBeTruthy()
      try {
        await page.goto('/#precos')
        const card = page.locator('div.rounded-xl').filter({ hasText: pkg20h.name })
        await expect(card).toContainText('177,50', { timeout: 15000 })
        // 20h × 11 € = 220 € → the saving is computed from real numbers.
        await expect(card).toContainText('42,50')

        await card.getByRole('button', { name: /Comprar Pack/i }).click()
        await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
        await expect(page.getByText('177,50 €')).toBeVisible()
        // Back out: the purchase stays unpaid and grants no hours.
        await page.getByRole('button', { name: /^Cancelar$/ }).click()
        await page.waitForURL(/\/dashboard/, { timeout: 20000 })
      } finally {
        const restored = await api.put(`${API_URL}/admin/packages/${pkg20h.id}`, {
          headers, params: { org_id: orgId }, data: { price: originalPrice },
        })
        expect(restored.ok(), await restored.text()).toBeTruthy()
      }
    } finally {
      await api.dispose()
    }
  })
})
