import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/**
 * Land on a space's rooms view, whichever way the stack is seeded (C11).
 *
 * With exactly one public space `/spaces` IS the rooms view; with several it
 * is the list, and the first space is opened from it. The seeded stack has
 * one, but a spec that only wants a calendar should not care.
 */
export async function openSpaceRooms(page: Page) {
  await page.goto('/spaces')
  const bookButtons = page.getByRole('button', { name: /Reservar Esta Sala/i })
  const openSpace = page.getByRole('button', { name: /Ver Salas e Reservar/i }).first()
  await expect(bookButtons.first().or(openSpace)).toBeVisible({ timeout: 15000 })
  if (await openSpace.isVisible()) {
    await openSpace.click()
    await page.waitForURL('**/spaces/**', { timeout: 10000 })
  }
  await expect(bookButtons.first()).toBeVisible({ timeout: 15000 })
}

/**
 * Start a session as a customer who already chose "Dia" (C12).
 *
 * A desktop-width browser opens the calendar on "Semana", which reads seven
 * days of availability per mount instead of one. Specs that are about the day
 * view would spend that on every fresh context and push the suite past the
 * public request budget (TODO.md B18: the real limits stay, the specs pace
 * themselves). This is the customer's own remembered choice, set before the
 * first page loads; the week view has its own spec.
 */
export async function preferDayView(target: BrowserContext | Page) {
  await target.addInitScript(() => {
    try {
      window.sessionStorage.setItem('espacohora.calendarView', 'day')
    } catch {
      // Storage unavailable on this document (about:blank); the next one has it.
    }
  })
}

/**
 * Put the open calendar on the day view.
 *
 * A desktop-width browser now opens on "Semana" (C12). Specs that step day by
 * day with "›" and address the grid's only column ask for "Dia" first — which
 * is also the customer's manual choice, so it sticks for the rest of the run.
 */
export async function useDayView(page: Page) {
  const toolbar = page.locator('.rbc-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 15000 })
  const dayButton = toolbar.getByRole('button', { name: 'Dia', exact: true })
  // Only when it is not already the view (preferDayView usually made it so):
  // the section is still smooth-scrolling into place right after a room is
  // picked, and a needless click would wait on a moving button.
  if (!(await dayButton.getAttribute('class'))?.includes('rbc-active')) {
    await dayButton.click()
  }
  await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(1)
}

/**
 * Wait out one public rate-limit window before a spec file starts.
 *
 * Compose sees every browser and API client as one peer, so the suites share
 * a single 120-reads-a-minute budget (TODO.md B18). The specs before these
 * spend most of it, and since C11 every full page load also reads the spaces
 * list once. The real limits stay as they are: a spec that adds traffic paces
 * itself at its file boundary, outside any assertion, exactly as auth.spec.ts
 * and packages.spec.ts already do. Call it from `test.beforeAll`.
 */
export async function waitOutPublicRateWindow() {
  test.setTimeout(75_000)
  await delay(60_000)
}
