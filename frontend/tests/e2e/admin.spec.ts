import { randomUUID } from 'node:crypto'
import { test, expect, API_URL, auth, contextAs, createCustomer } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

// Pre-authenticated via global-setup.ts, not a real sign-in per test: these
// tests only need to *be* an admin, not exercise the login UI (auth.spec.ts
// does that), so they skip it.
test.use({ storageState: ADMIN_STORAGE_STATE })

test.describe('Admin', () => {
  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
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
    // The assertion is that NOTHING happens: give any late redirect effect
    // the chance to fire before reading the URL.
    await page.waitForTimeout(1500)
    expect(new URL(page.url()).pathname).toBe('/admin')
  })

  test('a cold deep link to /admin/bookings stays in admin', async ({ page }) => {
    await page.goto('/admin/bookings')
    await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1500)
    expect(new URL(page.url()).pathname).toBe('/admin/bookings')
  })

  test('a plain member is still redirected away from /admin', async ({ browser, api }) => {
    const member = await createCustomer(api, { tag: 'member-b22', name: 'Membro B22' })
    const { memberships } = await (await api.get(`${API_URL}/auth/memberships`, { headers: auth(member.token) })).json()
    expect(memberships[0].role).toBe('member')

    // A NextAuth session for that member, same handshake as global-setup.ts.
    const context = await contextAs(browser, member)
    const page = await context.newPage()
    try {
      await page.goto('/admin')
      await page.waitForURL('**/dashboard', { timeout: 15000 })
      expect(new URL(page.url()).pathname).toBe('/dashboard')
    } finally {
      await context.close()
    }
  })
})

// C06: an operator's price change must reach the landing page and the amount
// charged. The pack is this test's own (Q41): more hours than the seeded 20h
// pack so it sorts last on the landing and the other specs' "first pack card"
// stays the seeded 10h one, and priced so it never becomes the best €/h
// (the highlighted card) either.
test.describe('Pricing follows the operator (C06)', () => {
  test('a price change reaches the landing card and the checkout amount', async ({ page, api, admin }) => {
    const headers = auth(admin.token)
    const org = { org_id: admin.orgId }
    const name = `Pack E2E 30h ${randomUUID().slice(0, 4)}`
    const created = await api.post(`${API_URL}/admin/packages`, { headers, params: org, data: { name, hours: 30, price: '330.00', validity_days: 365 } })
    expect(created.status(), await created.text()).toBe(201)
    const pkg = (await created.json()).package

    try {
      const updated = await api.put(`${API_URL}/admin/packages/${pkg.id}`, { headers, params: org, data: { price: 300 } })
      expect(updated.ok(), await updated.text()).toBeTruthy()

      await page.goto('/#precos')
      const card = page.locator('div.rounded-xl').filter({ hasText: name })
      await expect(card).toContainText('300,00', { timeout: 15000 })
      // 30h × 11 € = 330 € → the saving is computed from real numbers.
      await expect(card).toContainText('30,00')

      await card.getByRole('button', { name: /Comprar Pack/i }).click()
      await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
      await expect(page.getByText('300,00 €')).toBeVisible()
      // Back out: the purchase stays unpaid and grants no hours.
      await page.getByRole('button', { name: /^Cancelar$/ }).click()
      await page.waitForURL(/\/dashboard/, { timeout: 20000 })
    } finally {
      // The backed-out purchase references the pack, so it cannot be hard
      // deleted (G02); off the landing is what matters.
      const off = await api.put(`${API_URL}/admin/packages/${pkg.id}`, { headers, params: org, data: { is_active: false } })
      expect(off.ok(), await off.text()).toBeTruthy()
    }
  })
})
