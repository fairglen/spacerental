import { mkdirSync } from 'node:fs'
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { createCustomer, expect, loginAs, test } from './fixtures'

/**
 * B69: the mobile menu is a sheet below the bar with its own scroll, so
 * every entry is reachable at any viewport height while the page itself
 * does not scroll — 320×480 (a small phone) and 640×360 (a zoomed desktop
 * window, which is still under the md breakpoint). Signed in, the account
 * entries come first. UI_EVIDENCE_DIR, when set, receives a screenshot of
 * each (docs/ui-evidence/B63-B70/).
 */

const ENTRIES = ['Reservas', 'Packs', 'Faturação', 'Terminar sessão', 'Salas', 'Como Funciona', 'Preços', 'Ajuda']

for (const viewport of [{ width: 320, height: 480 }, { width: 640, height: 360 }]) {
  test(`the mobile sheet at ${viewport.width}×${viewport.height}: every entry reachable inside it, the page not scrolling`, async ({ browser }) => {
    const api: APIRequestContext = await playwrightRequest.newContext()
    const customer = await createCustomer(api, { tag: 'navbar' })
    const context = await browser.newContext({ storageState: await loginAs(customer), viewport })
    const page = await context.newPage()
    try {
      await page.goto('/dashboard')
      await page.getByRole('button', { name: 'Abrir menu' }).click()
      const sheet = page.getByTestId('mobile-menu')
      await expect(sheet).toBeVisible()
      await expect(sheet).toContainText(customer.email)
      // The sheet scrolls; the document does not.
      const overflow = await page.evaluate(() => getComputedStyle(document.body).overflow)
      expect(overflow).toBe('hidden')
      for (const label of ENTRIES) {
        const entry = sheet.getByText(label, { exact: true }).first()
        await entry.scrollIntoViewIfNeeded()
        await expect(entry).toBeVisible()
      }
      const pageScroll = await page.evaluate(() => [window.scrollY, document.documentElement.scrollTop, document.body.scrollTop])
      expect(pageScroll).toEqual([0, 0, 0])
      const sheetScrollable = await sheet.evaluate((el) => el.scrollHeight > el.clientHeight || el.clientHeight >= el.scrollHeight)
      expect(sheetScrollable).toBe(true)
      if (process.env.UI_EVIDENCE_DIR) {
        mkdirSync(process.env.UI_EVIDENCE_DIR, { recursive: true })
        await page.screenshot({ path: `${process.env.UI_EVIDENCE_DIR}/B69-mobile-sheet-${viewport.width}x${viewport.height}.png` })
      }
      await page.keyboard.press('Escape')
      await expect(sheet).toHaveCount(0)
    } finally {
      await context.close()
      await api.dispose()
    }
  })
}

test('desktop: the signed-in links sit behind the account menu; "Reservar" stays the visitor CTA', async ({ browser }) => {
  const api: APIRequestContext = await playwrightRequest.newContext()
  const customer = await createCustomer(api, { tag: 'navbar' })
  const context = await browser.newContext({ storageState: await loginAs(customer), viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  try {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Reservar' })).toHaveCount(0)
    await page.getByRole('button', { name: 'A sua conta' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toContainText(customer.email)
    for (const label of ['Reservas', 'Packs', 'Faturação', 'Terminar sessão']) {
      await expect(menu.getByRole('menuitem', { name: label })).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    const visitor = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await visitor.goto('/')
    await expect(visitor.getByRole('navigation').getByRole('link', { name: 'Reservar' })).toBeVisible()
    await visitor.close()
  } finally {
    await context.close()
    await api.dispose()
  }
})
