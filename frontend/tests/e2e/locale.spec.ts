import { expect, test } from '@playwright/test'

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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your space,')

  await page.getByRole('navigation').getByRole('link', { name: 'Spaces', exact: true }).click()
  await expect(page).toHaveURL(/\/spaces$/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Spaces', exact: true })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your space,')
  await page.getByRole('button', { name: 'PT', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('O teu espaço,')
  expect(hydrationErrors).toEqual([])
})
