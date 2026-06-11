import { test, expect } from '@playwright/test'

test.describe('Admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('admin123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    // 30s: the first login of a run pays for the dev server's cold compile.
    await page.waitForURL('**/dashboard', { timeout: 30000 })
  })

  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
    // 15s: first visit pays for the dev server's cold compile of /admin.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  })

  test('admin can view spaces list', async ({ page }) => {
    await page.goto('/admin/spaces')
    await expect(page.getByRole('heading', { name: 'Espaços' })).toBeVisible({ timeout: 15000 })
  })
})
