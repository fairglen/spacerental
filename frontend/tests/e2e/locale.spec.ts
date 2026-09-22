import { expect, test } from '@playwright/test'
import pt from '../../lib/i18n/pt.json'
import en from '../../lib/i18n/en.json'

test('language choice survives navigation and a full reload without hydration errors', async ({ page }) => {
  const hydrationErrors: string[] = []
  page.on('pageerror', error => hydrationErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /hydration|did not match|server-rendered/i.test(message.text())) {
      hydrationErrors.push(message.text())
    }
  })

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'PT', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(en.hero.headline_start)

  // "Rooms" while the stack has one public space, "Spaces" with several (C11).
  const browse = page.getByRole('navigation').getByRole('link', { name: /^(Rooms|Spaces)$/ })
  await browse.click()
  await expect(page).toHaveURL(/\/spaces$/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(browse).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(en.hero.headline_start)
  await page.getByRole('button', { name: 'PT', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(pt.hero.headline_start)
  expect(hydrationErrors).toEqual([])
})
