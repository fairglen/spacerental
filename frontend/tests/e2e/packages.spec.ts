import { createHmac } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { decode, encode } from 'next-auth/jwt'
import { request as playwrightRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
import {
  API_URL,
  adminSession,
  at,
  auth,
  createCustomer,
  createRoom,
  expect,
  freshDay,
  loginAs,
  packageByHours,
  removeRoom,
  test,
  type Admin,
  type Customer,
  type Room,
} from './fixtures'

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
 * Serial + one shared signed-in page, same as booking.spec.ts: the tests
 * build on the packs the one before bought. The buyer is a customer of this
 * file's own (Q41), so the balance it reads is only what it bought here.
 */

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

/** Click "Pagar" on the stub Checkout page the browser is currently on. */
async function payOnStubCheckoutPage(page: Page) {
  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })
}

test.describe.configure({ mode: 'serial' })

test.describe('Comprar pacotes — fluxos reais (B12)', () => {
  let api: APIRequestContext
  let admin: Admin
  let customer: Customer
  let room: Room
  let token: string
  let page: Page
  let context: BrowserContext

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    api = await playwrightRequest.newContext()
    admin = await adminSession(api)
    // The redemption at the end of the visitor test books in a room of this
    // file's own.
    room = await createRoom(api, admin, { name: `E2E packages ${Date.now().toString(36)}` })
    customer = await createCustomer(api, { tag: 'packages' })
    token = customer.token

    context = await browser.newContext({ storageState: await loginAs(customer) })
    page = await context.newPage()
  })

  test.afterAll(async () => {
    if (api && admin && room) await removeRoom(api, admin, room.id)
    if (context) await context.close()
    if (api) await api.dispose()
  })

  test('an existing member buys a package from the landing page and sees the right hours_remaining (B12)', async () => {
    const orgId = customer.orgId
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
    const orgId = customer.orgId
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

  test('an expired backend token in an active browser session can reauthenticate and buy the selected pack (B14)', async () => {
    // Local fixture only: create an expired, correctly signed backend JWT
    // inside a genuine NextAuth cookie. Neither API response is intercepted.
    expect(new URL(API_URL).hostname).toBe('localhost')
    const envText = readFileSync(existsSync('../.env') ? '../.env' : '../.env.example', 'utf8')
    function localSecret(key: string): string {
      const value = process.env[key] ?? envText.match(new RegExp(`^${key}=(.+)$`, 'm'))?.[1].trim().replace(/^['"]|['"]$/g, '')
      if (!value) throw new Error(`Local E2E configuration requires ${key}`)
      return value
    }
    const cookies = await page.context().cookies()
    const cookie = cookies.find(c => c.name === 'next-auth.session-token')
    expect(cookie, 'Expected one local NextAuth session cookie').toBeTruthy()
    const nextAuthSecret = localSecret('NEXTAUTH_SECRET')
    const current = await decode({ token: cookie!.value, secret: nextAuthSecret })
    if (!current || typeof current.accessToken !== 'string') throw new Error('No backend token in the active session')
    const [header, payload] = current.accessToken.split('.')
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    function signedToken(exp: number): string {
      const body = `${header}.${Buffer.from(JSON.stringify({ ...claims, exp })).toString('base64url')}`
      return `${body}.${createHmac('sha256', localSecret('SECRET_KEY')).update(body).digest('base64url')}`
    }
    const now = Math.floor(Date.now() / 1000)
    const valid = await api.get(apiUrl('/auth/memberships'), { headers: auth(signedToken(now + 300)) })
    expect(valid.status(), 'Fixture must use the running backend signing key').toBe(200)
    const expired = signedToken(now - 60)
    const expiredCookie = await encode({ token: { ...current, accessToken: expired }, secret: nextAuthSecret })
    await page.context().addCookies([{ ...cookie!, value: expiredCookie }])
    const sessionResponse = await page.request.get('/api/auth/session')
    const activeSession = await sessionResponse.json()
    expect(activeSession.user.email).toBe(customer.email)
    expect(activeSession.accessToken).toBe(expired)
    const orgId = customer.orgId
    const pkg = await packageByHours(api, orgId, 20)
    const before = await myPurchases(api, token)
    await page.goto('/#precos')
    const rejected = page.waitForResponse(r => r.url().endsWith(`/packages/${pkg.id}/purchase`) && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Comprar Pack/i }).nth(1).click()
    expect((await rejected).status()).toBe(401)
    await expect(page.getByRole('alert').filter({ hasText: /sessão deixou de ser válida/ })).toBeVisible()
    expect(await myPurchases(api, token)).toHaveLength(before.length)
    await page.getByRole('link', { name: 'Entrar e continuar a compra' }).click()
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?packageId=${pkg.id}`))
    await page.getByLabel('Email').fill(customer.email)
    await page.getByLabel('Password').fill(customer.password)
    await page.getByRole('button', { name: /^Entrar$/ }).click()
    await page.waitForURL(new RegExp(`/dashboard/packages\\?packageId=${pkg.id}`))
    const targetCard = page.locator('div.rounded-xl').filter({ hasText: `${pkg.hours}h ·` })
    await targetCard.getByRole('button', { name: /Comprar Pack/i }).click()
    await page.waitForURL(/\/checkout\/stub\/cs_stub_/)
    const { purchaseId } = decodeCheckoutUrl(page.url())
    await payOnStubCheckoutPage(page)
    const purchases = await myPurchases(api, token)
    expect(purchases).toHaveLength(before.length + 1)
    expect(purchases.find(p => p.id === purchaseId)).toMatchObject({ package_id: pkg.id, status: 'active' })
  })

  test('a signed-out visitor\'s chosen package survives sign-up and lands them on a highlighted card (B12)', async ({ browser }) => {
    const orgId = customer.orgId
    const pkg10h = await packageByHours(api, orgId, 10)

    // A fresh, signed-out context — the shared `page` above is signed in as
    // this file's customer and must stay that way for the tests around it.
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

      const session = await (await visitor.request.get('/api/auth/session')).json()
      expect(session.role).toBe('member')
      await visitor.locator('div.rounded-xl').filter({ hasText: pkg10h.name })
        .getByRole('button', { name: 'Comprar Pack', exact: true }).click()
      await visitor.waitForURL(/\/checkout\/stub\/cs_stub_/)
      const { purchaseId } = decodeCheckoutUrl(visitor.url())
      const pending = await myPurchases(api, session.accessToken)
      expect(pending).toHaveLength(1)
      expect(pending[0].status).toBe('pending')
      await payOnStubCheckoutPage(visitor)
      const active = await myPurchases(api, session.accessToken)
      expect(active).toHaveLength(1)
      expect(active[0].id).toBe(purchaseId)
      expect(active[0].status).toBe('active')
      expect(Number(active[0].hours_remaining)).toBe(10)

      // Two hours in this file's own room, three days out: free by construction.
      const day = freshDay(3)
      const bookingResponse = await visitor.request.post(`${API_URL}/bookings`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        data: {
          room_id: room.id,
          start_time: at(day, 10).toISOString(),
          end_time: at(day, 12).toISOString(),
          payment_method: 'package',
        },
      })
      expect(bookingResponse.status()).toBe(201)
      const redeemed = await myPurchases(api, session.accessToken)
      expect(Number(redeemed.find(p => p.id === purchaseId)?.hours_remaining)).toBe(8)
      const booking = (await bookingResponse.json()).booking
      const cancelled = await visitor.request.delete(`${API_URL}/bookings/${booking.id}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      expect(cancelled.status()).toBe(204)
      const restored = await myPurchases(api, session.accessToken)
      expect(Number(restored.find(p => p.id === purchaseId)?.hours_remaining)).toBe(10)
    } finally {
      await visitorContext.close()
    }
  })
})
