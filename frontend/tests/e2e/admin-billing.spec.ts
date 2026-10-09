import { test, expect, API_URL, at, auth, buyPack, createBooking, freshDay, packageByHours } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * I06 as an operator: a customer buys a pack and pays an hourly booking; the
 * billing page shows the two on one line for "Este mês", "Registar fatura
 * emitida" records the fatura with a tiny PDF, the line reads "Faturada", the
 * record is in "Faturas registadas", and the customer's own API sees it with
 * the PDF.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
const money = (value: number) => new RegExp(`${value.toFixed(2).replace('.', ',')}\\s?€`)

test('billing: the statement line, register an invoice with a PDF, see it registered', async ({ page, api, room, customer }) => {
  const pack = await packageByHours(api, customer.orgId, 10)
  await buyPack(api, customer, pack.id)
  const day = freshDay(3)
  await createBooking(api, customer, { roomId: room.id, start: at(day, 10), end: at(day, 11), pay: true })
  const expected = Number(pack.price) + 11

  await page.goto('/admin/billing')
  await expect(page.getByRole('heading', { name: 'Faturação' })).toBeVisible()
  await expect(page.getByLabel('Período')).toHaveValue('this_month')
  await page.getByLabel('Pesquisar cliente').fill(customer.email)
  const line = page.getByTestId('statement-line').filter({ hasText: customer.email })
  await expect(line).toHaveCount(1, { timeout: 15000 })
  await expect(line).toContainText('2')
  await expect(line).toContainText('11h')
  await expect(line).toContainText(money(expected))

  await line.getByRole('button', { name: 'Ver transações' }).click()
  const transactions = page.getByRole('table', { name: `Transações de ${customer.email}` })
  await expect(transactions).toContainText('Pack')
  await expect(transactions).toContainText('Reserva à hora')
  await expect(transactions).toContainText('Por faturar')

  await line.getByRole('button', { name: 'Registar fatura emitida' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('invoice-amount')).toContainText(money(expected))
  await expect(dialog.getByTestId('invoice-hours')).toContainText('11h')
  const number = `FT E2E/${Date.now()}`
  await dialog.getByLabel('Nº da fatura').fill(number)
  await dialog.getByLabel('PDF da fatura').setInputFiles({ name: 'fatura.pdf', mimeType: 'application/pdf', buffer: PDF })
  await dialog.getByLabel('Nota').fill('Registada no teste')
  await expect(dialog.getByLabel('Avisar o cliente por email')).toBeChecked()
  await dialog.getByRole('button', { name: 'Registar fatura' }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })

  await expect(line).toContainText('Faturada', { timeout: 15000 })
  await expect(transactions).toContainText(number)

  await page.getByRole('tab', { name: /Faturas registadas/ }).click()
  const row = page.getByTestId('invoice-row').filter({ hasText: number })
  await expect(row).toBeVisible()
  await expect(row).toContainText(customer.email)
  await expect(row).toContainText(money(expected))
  await expect(row.getByRole('button', { name: `Transferir PDF ${number}` })).toBeVisible()

  // The customer's side: the record is theirs, with the PDF, and nobody else's.
  const mine = await api.get(`${API_URL}/invoices/me`, { headers: auth(customer.token) })
  expect(mine.ok()).toBeTruthy()
  const invoices = (await mine.json()).invoices as Array<{ id: string; number: string; has_pdf: boolean; amount: string }>
  expect(invoices).toHaveLength(1)
  expect(invoices[0]).toMatchObject({ number, has_pdf: true, amount: expected.toFixed(2) })
  const pdf = await api.get(`${API_URL}/invoices/${invoices[0].id}/pdf`, { headers: auth(customer.token) })
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
  // The same file is not reachable through the public media mount.
  const admin = await api.get(`${API_URL}/admin/billing/invoices/${invoices[0].id}`, { headers: auth((await api.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } }).then((r) => r.json())).access_token), params: { org_id: customer.orgId } })
  expect(admin.ok()).toBeTruthy()
  const blocked = await api.get(`${new URL(API_URL).origin}/media/private/invoices/${customer.orgId}/${invoices[0].id}.pdf`)
  expect(blocked.status()).toBe(404)
})
