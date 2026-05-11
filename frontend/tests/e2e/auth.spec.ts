import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/O teu espaço/i)).toBeVisible()
  })

  test('sign-up flow creates account', async ({ page }) => {
    const email = `test-${Date.now()}@example.com`
    await page.goto('/sign-up')
    await page.getByLabel('Nome').fill('Test User')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByLabel('Confirmar password').fill('password123')
    await page.getByRole('button', { name: /Criar Conta/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByText(/Olá/i)).toBeVisible()
  })

  test('sign-in with seeded admin works', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('admin123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
  })

  test('sign-in with wrong password shows error', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('wrongpass')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await expect(page.getByText(/incorretos/i)).toBeVisible({ timeout: 10000 })
  })

  test('protected route redirects to sign-in', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/dashboard')
    await page.waitForURL('**/sign-in**', { timeout: 10000 })
  })
})
