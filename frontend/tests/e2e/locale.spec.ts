import { mkdirSync } from 'node:fs'
import { request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { API_URL, SEEDED_ROOMS, auth, createCustomer, expect, loginAs, test } from './fixtures'
import en from '../../lib/i18n/en.json'

/**
 * B65: with the locale cookie set to EN (B64), the whole customer journey is
 * English — landing, rooms, a room's calendar, the auth pages, the dashboard,
 * the packs and billing pages, the 404, the help dialog — and the stub
 * Checkout page follows `Accept-Language`. None of it leaks the Portuguese
 * words the tester met. UI_EVIDENCE_DIR, when set, receives a screenshot of
 * each page (docs/ui-evidence/B63-B70/).
 */

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'
const EN_COOKIE = { name: 'flowspace.locale', value: 'en', url: BASE_URL }
// The words the finding named, plus the ones every customer page used to carry.
const PORTUGUESE = /\b(Reservar|Comprar|Os meus|Os seus|Não tem|Entrar|Terminar sessão|Faturação|Pagamento|Ajuda|Preços)\b/

async function expectEnglish(page: Page, shot: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const text = await page.locator('body').innerText()
  expect(text, `Portuguese on ${page.url()}`).not.toMatch(PORTUGUESE)
  if (process.env.UI_EVIDENCE_DIR) {
    mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true })
    await page.screenshot({ path: `${process.env.UI_EVIDENCE_DIR}/B65-en-${shot}.png`, fullPage: true })
  }
}

test('a visitor: landing, rooms, a room, sign-up, sign-in, recover, 404 — all English', async ({ browser }) => {
  const context = await browser.newContext()
  await context.addCookies([EN_COOKIE])
  const page = await context.newPage()
  try {
    await page.goto('/')
    await expect(page.getByText(en.hero.headline_start, { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('navigation').getByRole('link', { name: en.navbar.book })).toBeVisible()
    await expectEnglish(page, 'landing')

    await page.goto('/spaces')
    await expect(page.getByRole('heading', { name: SEEDED_ROOMS[0] })).toBeVisible()
    await expectEnglish(page, 'spaces')

    // Single-space mode: the card's CTA opens the room's calendar in place.
    await page.getByRole('button', { name: en.roomCard.cta }).first().click()
    await expect(page.getByText(en.spaces.calendar_help)).toBeVisible()
    await expect(page.getByRole('heading', { name: en.spaces.availability_heading.replace('{room}', SEEDED_ROOMS[0]) })).toBeVisible()
    await expectEnglish(page, 'room')

    await page.goto('/sign-up')
    await expect(page.getByRole('heading', { name: en.auth.sign_up_title })).toBeVisible()
    await expect(page.getByRole('button', { name: en.auth.sign_up_submit })).toBeVisible()
    await expectEnglish(page, 'sign-up')

    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { name: en.auth.sign_in_title })).toBeVisible()
    await expectEnglish(page, 'sign-in')

    await page.goto('/forgot-password')
    await expect(page.getByRole('heading', { name: en.auth.forgot_title })).toBeVisible()
    await expectEnglish(page, 'forgot-password')

    await page.goto('/this-page-does-not-exist')
    await expect(page.getByRole('heading', { name: en.notFound.title })).toBeVisible()
    await expectEnglish(page, '404')
  } finally {
    await context.close()
  }
})

test('a customer: dashboard, packs, billing and the help dialog — all English; the stub Checkout page too', async ({ browser }) => {
  const api: APIRequestContext = await playwrightRequest.newContext()
  const customer = await createCustomer(api, { tag: 'locale' })
  const context = await browser.newContext({ storageState: await loginAs(customer) })
  await context.addCookies([EN_COOKIE])
  const page = await context.newPage()
  try {
    await page.goto('/dashboard')
    await expect(page.getByText(en.dashboard.subtitle)).toBeVisible()
    await expectEnglish(page, 'dashboard')

    await page.goto('/dashboard/packages')
    await expect(page.getByRole('heading', { name: en.packs.page_title })).toBeVisible()
    // B70's line, in English, with the way to the rooms.
    await expect(page.getByRole('link', { name: en.packs.use_hours_cta }).first()).toHaveAttribute('href', '/spaces')
    await expectEnglish(page, 'packs')

    await page.goto('/dashboard/billing')
    await expect(page.getByRole('heading', { name: en.billing.title, level: 1 })).toBeVisible()
    await expectEnglish(page, 'billing')

    await page.getByRole('button', { name: en.navbar.help }).first().click()
    const dialog = page.getByRole('dialog', { name: en.help.title })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('link', { name: en.help.faq_link })).toHaveAttribute('href', 'https://flowspace.pt/#faq')
    expect(await dialog.innerText()).not.toMatch(PORTUGUESE)
    if (process.env.UI_EVIDENCE_DIR) {
      await page.screenshot({ path: `${process.env.UI_EVIDENCE_DIR}/B65-en-help-dialog.png` })
    }
    await page.keyboard.press('Escape')

    // The stub Checkout page a pack purchase lands on: English for an English
    // browser, Portuguese otherwise, and it says so with Vary.
    const packs = await api.get(`${API_URL}/packages?org_id=${customer.orgId}`, { headers: auth(customer.token) })
    expect(packs.ok()).toBeTruthy()
    const pkg = (await packs.json()).packages[0]
    const purchase = await api.post(`${API_URL}/packages/${pkg.id}/purchase`, { headers: auth(customer.token), data: { org_id: customer.orgId } })
    expect(purchase.ok(), `purchase: ${purchase.status()} ${await purchase.text()}`).toBeTruthy()
    const body = await purchase.json()
    const checkoutUrl: string = body.checkout_url ?? body.purchase?.checkout_url
    expect(checkoutUrl).toBeTruthy()
    const english = await api.get(checkoutUrl, { headers: { 'Accept-Language': 'en-GB,en;q=0.9,pt;q=0.8' } })
    expect(english.ok()).toBeTruthy()
    expect(english.headers()['vary']).toContain('Accept-Language')
    const englishHtml = await english.text()
    expect(englishHtml).toContain('<html lang="en">')
    expect(englishHtml).not.toContain('Pagar')
    const portuguese = await api.get(checkoutUrl, { headers: { 'Accept-Language': 'pt-PT,pt;q=0.9' } })
    expect(await portuguese.text()).toContain('<html lang="pt">')
  } finally {
    await context.close()
    await api.dispose()
  }
})
