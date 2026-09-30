import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'

// G03: forgot → the link from the stub mailbox → a new password → sign in.
// The backend's /__test__/emails hook exists only with EMAIL_MODE=stub outside
// production, which is exactly the stack this suite runs against.
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const API_ROOT = API_URL.replace(/\/api\/v1\/?$/, '')

test.describe('Password reset', () => {
  test('a customer who forgot the password gets a link, sets a new one and signs in', async ({ page, request }) => {
    const email = `reset-${randomUUID().slice(0, 8)}@example.com`
    const registered = await request.post(`${API_URL}/auth/register`, {
      data: { email, password: 'antiga-123', name: 'Cliente Reset' },
    })
    expect(registered.status(), await registered.text()).toBe(201)

    await page.context().clearCookies()
    await page.goto('/sign-in')
    await page.getByRole('link', { name: 'Esqueceu-se da password?' }).click()
    await page.waitForURL('**/forgot-password')
    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: 'Enviar ligação' }).click()
    await expect(page.getByRole('status')).toContainText('Se existir uma conta com este email')

    // The link, from the stub mailbox rather than a real inbox.
    const mailbox = await request.get(`${API_ROOT}/__test__/emails`)
    expect(mailbox.ok(), await mailbox.text()).toBeTruthy()
    const { emails } = (await mailbox.json()) as { emails: Array<{ to: string; subject: string; links: string[] }> }
    const mine = [...emails].reverse().find((m) => m.to === email)
    expect(mine, 'the reset email reached the stub mailbox').toBeTruthy()
    const link = mine!.links.find((l) => l.includes('/reset-password/'))
    expect(link).toBeTruthy()
    const token = link!.split('/reset-password/')[1]

    await page.goto(`/reset-password/${token}`)
    await page.getByLabel('Nova password', { exact: true }).fill('nova-pass-123')
    await page.getByLabel('Confirmar a nova password').fill('nova-pass-123')
    await page.getByRole('button', { name: 'Guardar a nova password' }).click()
    await page.waitForURL('**/sign-in?password=reset')
    await expect(page.getByRole('status')).toContainText('A sua password foi alterada')

    // The old password is gone, the new one works, and the link is spent.
    await page.getByLabel(/Email/i).fill(email)
    await page.getByLabel('Password').fill('antiga-123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await expect(page.getByText(/incorretos/i)).toBeVisible({ timeout: 10000 })
    await page.getByLabel('Password').fill('nova-pass-123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })

    const spent = await request.post(`${API_URL}/auth/password-reset/confirm`, {
      data: { token, password: 'outra-pass-123' },
    })
    expect(spent.status()).toBe(400)
  })

  test('an expired or made-up link says so and offers a new request', async ({ page }) => {
    await page.goto('/reset-password/not-a-real-token')
    await page.getByLabel('Nova password', { exact: true }).fill('nova-pass-123')
    await page.getByLabel('Confirmar a nova password').fill('nova-pass-123')
    await page.getByRole('button', { name: 'Guardar a nova password' }).click()
    // Next's route announcer is a second role="alert" on the page.
    await expect(page.getByText('A ligação é inválida ou já expirou')).toBeVisible()
    await page.getByRole('link', { name: 'Pedir nova ligação' }).click()
    await page.waitForURL('**/forgot-password')
  })
})
