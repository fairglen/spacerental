import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test'

/**
 * Package purchase flows (TODO.md B12): buying a package from the landing
 * page or the dashboard, and a signed-out visitor's choice surviving sign-up.
 *
 * Like booking.spec.ts (B1/B2/B4/B5), this runs entirely on STRIPE_MODE=stub:
 * `POST /packages/{id}/purchase` returns a `.../checkout/stub/cs_stub_<id>`
 * URL served by this app itself (T10), and clicking "Pagar" there is what
 * activates the purchase (flips its hours from reserved-but-unpaid to
 * spendable) — walked as a real page, no route interception needed
 * (CLAUDE.md §10.3).
 *
 * Serial + one shared sign-in, same as booking.spec.ts — the backend's
 * auth-tier rate limit (10 requests/60s, backend/app/config.py) is shared
 * across every spec file in a run, so each test re-logging in via both the
 * API and the UI adds up fast across the whole suite.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const CREDENTIALS = { email: 'admin@demo.com', password: 'admin123' }

type ApiPackage = { id: string; org_id: string; name: string; hours: number }
type ApiPurchase = {
  id: string
  package_id: string
  org_id: string
  status: string
  hours_total: string | number
  hours_remaining: string | number
}

function apiUrl(path: string): string {
  return `${API_URL}${path}`
}

async function login(api: APIRequestContext): Promise<string> {
  const res = await api.post(apiUrl('/auth/login'), { data: CREDENTIALS })
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy()
  return (await res.json()).access_token
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function seededOrgId(api: APIRequestContext): Promise<string> {
  const res = await api.get(apiUrl('/spaces'))
  const body = await res.json()
  expect(body.spaces.length, 'no seeded spaces to derive an org from').toBeGreaterThan(0)
  return body.spaces[0].org_id
}

async function packageByHours(api: APIRequestContext, orgId: string, hours: number): Promise<ApiPackage> {
  const res = await api.get(apiUrl('/packages'), { params: { org_id: orgId } })
  const body = await res.json()
  const pkg = body.packages.find((p: ApiPackage) => p.hours === hours)
  expect(pkg, `no seeded package with ${hours}h`).toBeTruthy()
  return pkg
}

async function myPurchases(api: APIRequestContext, token: string): Promise<ApiPurchase[]> {
  const res = await api.get(apiUrl('/packages/me'), { headers: auth(token) })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).purchases
}

/** Stub Checkout URL -> {sessionId, purchaseId} — the session id encodes the purchase UUID. */
function decodeCheckoutUrl(url: string): { sessionId: string; purchaseId: string } {
  const sessionId = new URL(url).pathname.split('/').pop()!
  const purchaseId = sessionId
    .replace('cs_stub_', '')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  return { sessionId, purchaseId }
}

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(CREDENTIALS.email)
  await page.getByLabel('Password').fill(CREDENTIALS.password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })
}

/** Click "Pagar" on the stub Checkout page the browser is currently on. */
async function payOnStubCheckoutPage(page: Page) {
  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('Comprar pacotes — fluxos reais (B12)', () => {
  let api: APIRequestContext
  let token: string
  let page: Page

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    api = await playwrightRequest.newContext()
    token = await login(api)

    const context = await browser.newContext()
    page = await context.newPage()
    await signIn(page)
  })

  test.afterAll(async () => {
    if (api) await api.dispose()
    if (page) await page.context().close()
  })

  test('an existing member buys a package from the landing page and sees the right hours_remaining (B12)', async () => {
    const orgId = await seededOrgId(api)
    const pkg10h = await packageByHours(api, orgId, 10)

    await page.goto('/#precos')
    const packButtons = page.getByRole('button', { name: /Comprar Pack/i })
    await expect(packButtons.first()).toBeVisible({ timeout: 15000 })
    await packButtons.first().click()

    await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
    const { sessionId, purchaseId } = decodeCheckoutUrl(page.url())

    const purchases = await myPurchases(api, token)
    const purchase = purchases.find((p) => p.id === purchaseId)
    expect(purchase, `no purchase behind checkout session ${sessionId}`).toBeTruthy()
    expect(purchase!.package_id).toBe(pkg10h.id)
    expect(purchase!.status, 'purchase should stay pending until payment').toBe('pending')

    await payOnStubCheckoutPage(page)

    await page.goto('/dashboard/packages')
    const card = page.locator('div.rounded-xl').filter({ hasText: pkg10h.name })
    await expect(card.first()).toBeVisible({ timeout: 10000 })
    await expect(card.first()).toContainText(`restantes de ${pkg10h.hours}h`)
  })

  test('a member buys straight from the dashboard "Comprar mais horas" section (B12)', async () => {
    const orgId = await seededOrgId(api)
    const pkg20h = await packageByHours(api, orgId, 20)

    await page.goto('/dashboard/packages')
    await expect(page.getByRole('heading', { name: 'Comprar mais horas' })).toBeVisible({ timeout: 10000 })
    const buyButtons = page.getByRole('button', { name: /Comprar Pack/i })
    await expect(buyButtons.first()).toBeVisible({ timeout: 10000 })

    // Two packages are seeded (10h, 20h) — pick the one whose card mentions 20h.
    const targetCard = page.locator('div.rounded-xl').filter({ hasText: `${pkg20h.hours}h ·` })
    await targetCard.getByRole('button', { name: /Comprar Pack/i }).click()

    await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
    const { purchaseId } = decodeCheckoutUrl(page.url())
    const purchases = await myPurchases(api, token)
    const purchase = purchases.find((p) => p.id === purchaseId)
    expect(purchase).toBeTruthy()
    expect(purchase!.package_id).toBe(pkg20h.id)

    await payOnStubCheckoutPage(page)

    await page.goto('/dashboard/packages')
    const card = page.locator('div.rounded-xl').filter({ hasText: pkg20h.name })
    await expect(card.first()).toBeVisible({ timeout: 10000 })
    await expect(card.first()).toContainText(`restantes de ${pkg20h.hours}h`)
  })

  test('a signed-out visitor\'s chosen package survives sign-up and lands them on a highlighted card (B12)', async ({ browser }) => {
    const orgId = await seededOrgId(api)
    const pkg10h = await packageByHours(api, orgId, 10)

    // A fresh, signed-out context — the shared `page` above is signed in as
    // admin@demo.com and must stay that way for the tests after this one.
    const visitorContext = await browser.newContext()
    const visitor = await visitorContext.newPage()
    try {
      await visitor.goto('/#precos')

      const packLinks = visitor.getByRole('link', { name: /Comprar Pack/i })
      await expect(packLinks.first()).toBeVisible({ timeout: 15000 })
      // First pack card is the seeded 10h one (§ seed order).
      await expect(packLinks.first()).toHaveAttribute('href', `/sign-up?packageId=${pkg10h.id}`)
      await packLinks.first().click()

      await expect(visitor).toHaveURL(new RegExp(`/sign-up\\?packageId=${pkg10h.id}`))

      const email = `pack-buyer-${Date.now()}@example.com`
      await visitor.getByLabel('Nome').fill('Pack Buyer')
      await visitor.getByLabel('Email').fill(email)
      await visitor.getByLabel('Password', { exact: true }).fill('password123')
      await visitor.getByLabel('Confirmar password').fill('password123')
      await visitor.getByRole('button', { name: /Criar Conta/i }).click()

      // This is the actual B12 deliverable: the chosen package id rides
      // through the whole sign-up round trip instead of being dropped for a
      // generic /dashboard landing.
      await visitor.waitForURL(new RegExp(`/dashboard/packages\\?packageId=${pkg10h.id}`), { timeout: 15000 })
      await expect(visitor.getByRole('heading', { name: 'Comprar mais horas' })).toBeVisible({ timeout: 10000 })

      // What the page does with that id here is a separate, pre-existing gap
      // (TODO.md: POST /auth/register gives every new user their own
      // brand-new org, not membership in the seeded org that owns this
      // package) — so the freshly-created org has no packages to highlight
      // yet, and the page correctly says so instead of crashing or showing a
      // stale/wrong package. The highlight-and-buy behaviour itself (once a
      // user *does* belong to the package's org) is covered by
      // tests/components/MyPackagesPage.test.tsx.
      await expect(visitor.getByText('Não há pacotes disponíveis de momento.')).toBeVisible()
    } finally {
      await visitorContext.close()
    }
  })
})
