import { expect, type Page } from '@playwright/test'

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
