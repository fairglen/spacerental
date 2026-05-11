import { test, expect } from '@playwright/test'

test.describe('Admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('admin123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
  })

  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByText('Dashboard')).toBeVisible()
  })

  test('admin can view spaces list', async ({ page }) => {
    await page.goto('/admin/spaces')
    await expect(page.getByText('Espaços')).toBeVisible()
  })
})
