import type { Page } from '@playwright/test'
import { test, expect, contextAs } from './fixtures'
import { openSpaceRooms } from './helpers/rooms'

/**
 * D-series visual gate for the Tailwind 4 / tailwind-merge 3 bump (D16):
 * five screens at 1280 and 390, compared pixel-for-pixel against snapshots
 * taken on Tailwind 3 (`--update-snapshots` on the pre-bump stack, then a
 * plain run on the bumped one; `maxDiffPixelRatio: 0.005`). Animations are
 * frozen and the clock-driven calendar is pinned by `freshDay` so the only
 * thing that can differ is the CSS.
 */
// Opt-in: the snapshots are taken on the machine that runs the comparison
// (font rendering differs per OS; the committed ones are chromium-darwin),
// so CI's Linux runners would have nothing to compare against.
test.skip(!process.env.VISUAL_GATE, 'local, opt-in: VISUAL_GATE=1 npx playwright test tests/e2e/visual-gate.spec.ts')

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

// The calendars draw a "now" line that moves between the baseline capture and
// the comparison; it is masked so only the layout is compared.
const shot = (page: Page) => ({
  animations: 'disabled' as const,
  maxDiffPixelRatio: 0.005,
  fullPage: true,
  mask: [page.locator('.rbc-current-time-indicator')],
})

for (const vp of VIEWPORTS) {
  test.describe(`visual gate @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, timezoneId: 'UTC' })

    test('landing', async ({ page }) => {
      await page.goto('/')
      await settle(page)
      await expect(page).toHaveScreenshot(`landing-${vp.name}.png`, shot(page))
    })

    test('space and booking calendar', async ({ page }) => {
      await openSpaceRooms(page)
      await page.getByRole('button', { name: /Reservar Esta Sala/i }).first().click()
      await expect(page.locator('.rbc-time-content')).toBeVisible({ timeout: 15000 })
      await settle(page)
      await expect(page).toHaveScreenshot(`space-booking-${vp.name}.png`, shot(page))
    })

    test('dashboard', async ({ browser, contextOptions, customer }) => {
      const context = await contextAs(browser, customer, contextOptions)
      const page = await context.newPage()
      try {
        await page.goto('/dashboard')
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15000 })
        await settle(page)
        await expect(page).toHaveScreenshot(`dashboard-${vp.name}.png`, shot(page))
      } finally {
        await context.close()
      }
    })

    test('admin calendar and admin bookings', async ({ browser, contextOptions }) => {
      const context = await contextAs(browser, null, contextOptions)
      const page = await context.newPage()
      try {
        await page.goto('/admin/calendar')
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20000 })
        await settle(page)
        await expect(page).toHaveScreenshot(`admin-calendar-${vp.name}.png`, shot(page))
        await page.goto('/admin/bookings')
        await expect(page.getByRole('heading', { name: /Reservas/i }).first()).toBeVisible({ timeout: 20000 })
        await settle(page)
        await expect(page).toHaveScreenshot(`admin-bookings-${vp.name}.png`, shot(page))
      } finally {
        await context.close()
      }
    })
  })
}
