import { test, expect, API_URL, auth } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * A05 as an operator: find a customer by email in /admin/users, open their
 * page, give them 3 complimentary hours with a reason, and see the pack
 * appear at 0 € — the customer's own packs page shows the hours — then
 * extend it (A06).
 */
test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

test('users: search, open a customer, grant hours, and the customer can spend them', async ({ page, api, customer }) => {
  const query = customer.email.split('@')[0]

  // G06: the list is "Clientes" on the kit — search in the toolbar, a row opens the page.
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible()
  await page.getByLabel('Pesquisar').fill(query)
  // The search lands in the URL after a debounce; wait for it like a person
  // watching the list settle would, rather than clicking the unfiltered row.
  await expect(page).toHaveURL(new RegExp(`q=${query}`))
  const row = page.getByRole('row').filter({ hasText: customer.email })
  await expect(row).toBeVisible({ timeout: 10000 })
  await expect(row).toContainText('Cliente')
  await row.getByText(customer.email).click()

  await expect(page.getByRole('heading', { name: customer.name })).toBeVisible({ timeout: 10000 })
  await expect(page.getByText('Sem packs.')).toBeVisible()
  await page.getByRole('button', { name: 'Atribuir horas' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Horas').fill('3')
  await dialog.getByLabel('Motivo').fill('Compensação por avaria do ar condicionado')
  await dialog.getByRole('button', { name: 'Atribuir horas' }).click()
  await expect(dialog).toBeHidden({ timeout: 10000 })

  const packs = page.getByRole('table', { name: 'Packs do cliente' })
  await expect(packs).toContainText('3h de 3h')
  await expect(packs).toContainText('Oferta')
  await expect(packs).toContainText('Compensação por avaria do ar condicionado')

  // The customer sees the hours as an active pack, spendable like any other.
  const mine = await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })
  const purchases = (await mine.json()).purchases
  expect(purchases).toHaveLength(1)
  expect(purchases[0]).toMatchObject({ status: 'active', hours_remaining: '3.00', amount_paid: '0.00' })
  expect(purchases[0]).not.toHaveProperty('admin_note')

  // A06: extend the granted pack by a year; the customer sees the new date.
  const before = purchases[0].expires_at as string
  await page.getByRole('button', { name: /Prolongar validade Pack/ }).click()
  const extend = page.getByRole('dialog')
  await expect(extend.getByRole('heading', { name: 'Prolongar validade' })).toBeVisible()
  const target = new Date(before); target.setUTCFullYear(target.getUTCFullYear() + 1)
  await extend.getByLabel('Nova validade').fill(target.toISOString().slice(0, 10))
  await extend.getByLabel('Motivo').fill('Esteve de baixa')
  await extend.getByRole('button', { name: 'Prolongar' }).click()
  await expect(extend).toBeHidden({ timeout: 10000 })
  await expect(packs).toContainText('Esteve de baixa')
  const after = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases[0]
  expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(before).getTime() + 300 * 24 * 3600 * 1000)

  // The role buttons: a member can be made admin, with a confirm step.
  await page.getByRole('button', { name: 'Tornar admin' }).click()
  await expect(page.getByRole('heading', { name: 'Tornar administrador' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar' }).click()
  await expect(page.getByRole('button', { name: 'Tornar admin' })).toBeVisible()
})
