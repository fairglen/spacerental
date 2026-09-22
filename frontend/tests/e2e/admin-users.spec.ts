import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/**
 * A05 as an operator: find a customer by email in /admin/users, open their
 * page, give them 3 complimentary hours with a reason, and see the pack
 * appear at 0 € — and the customer's own packs page shows the hours.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

test('users: search, open a customer, grant hours, and the customer can spend them', async ({ page, request }) => {
  const stamp = Date.now()
  const email = `e2e-users-${stamp}@example.com`
  const password = 'Password123!'
  const registered = await request.post(`${API_URL}/auth/register`, { data: { email, password, name: `Cliente Horas ${stamp}` } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  const customerToken = (await registered.json()).access_token

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Utilizadores' })).toBeVisible()
  await page.getByLabel('Procurar').fill(`e2e-users-${stamp}`)
  const row = page.getByRole('row').filter({ hasText: email })
  await expect(row).toBeVisible({ timeout: 10000 })
  await expect(row).toContainText('Cliente')
  await row.getByRole('link', { name: `Ver ${email}` }).click()

  await expect(page.getByRole('heading', { name: new RegExp(`Cliente Horas ${stamp}`) })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Sem packs.')).toBeVisible()
  await page.getByRole('button', { name: 'Atribuir horas' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Horas').fill('3')
  await dialog.getByLabel('Motivo').fill('Compensação por avaria do ar condicionado')
  await dialog.getByRole('button', { name: 'Atribuir horas' }).click()
  await expect(dialog).toBeHidden({ timeout: 10000 })

  const packs = page.getByRole('table').first()
  await expect(packs).toContainText('3h de 3h')
  await expect(packs).toContainText('Oferta')
  await expect(packs).toContainText('Compensação por avaria do ar condicionado')

  // The customer sees the hours as an active pack, spendable like any other.
  const mine = await request.get(`${API_URL}/packages/me`, { headers: { Authorization: `Bearer ${customerToken}` } })
  const purchases = (await mine.json()).purchases
  expect(purchases).toHaveLength(1)
  expect(purchases[0]).toMatchObject({ status: 'active', hours_remaining: '3.00', amount_paid: '0.00' })
  expect(purchases[0]).not.toHaveProperty('admin_note')

  // The role buttons: a member can be made admin, with a confirm step.
  await page.getByRole('button', { name: 'Tornar admin' }).click()
  await expect(page.getByRole('heading', { name: 'Tornar administrador' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('button', { name: 'Tornar admin' })).toBeVisible()
})
