import { test, expect, API_URL, at, auth, buyPack, contextAs, createBooking, createCustomer, freshDay, packageByHours } from './fixtures'

/**
 * I07 as a customer: "Faturação" in the signed-in menu, the billing details
 * form (a bad NIF is refused inline, a good one is saved without spaces),
 * and "As minhas faturas" — the invoice the operator registered, with its
 * PDF — while another customer sees nothing and gets a 404 on the PDF.
 */
test.use({ viewport: { width: 1280, height: 900 } })

const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
const iso = (d: Date) => d.toISOString().slice(0, 10)

test('customer: billing details with NIF validation, and the registered invoice with its PDF', async ({ browser, contextOptions, api, admin, room, customer }) => {
  // The operator's side, through the API: a pack sale and a paid booking,
  // then the invoice registered against them with a PDF.
  const pack = await packageByHours(api, customer.orgId, 10)
  await buyPack(api, customer, pack.id)
  const day = freshDay(4)
  await createBooking(api, customer, { roomId: room.id, start: at(day, 10), end: at(day, 11), pay: true })
  const today = new Date()
  const period = { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))) }
  const statement = await api.get(`${API_URL}/admin/billing/statement`, { headers: auth(admin.token), params: { org_id: admin.orgId, ...period } })
  expect(statement.ok()).toBeTruthy()
  const line = ((await statement.json()).statement.lines as Array<{ user: { email: string }; amount: string; hours: string; transactions: Array<{ kind: string; id: string }> }>).find((l) => l.user.email === customer.email)
  expect(line, 'the customer has a statement line').toBeTruthy()
  const number = `FT E2E/${Date.now()}`
  const form = new FormData()
  form.append('user_id', customer.id)
  form.append('number', number)
  form.append('issued_at', period.to)
  form.append('period_from', period.from)
  form.append('period_to', period.to)
  form.append('amount', line!.amount)
  form.append('hours', line!.hours)
  for (const t of line!.transactions) form.append('transaction_ids', `${t.kind}:${t.id}`)
  form.append('pdf', new Blob([PDF], { type: 'application/pdf' }), 'fatura.pdf')
  const registered = await api.post(`${API_URL}/admin/billing/invoices`, { headers: auth(admin.token), params: { org_id: admin.orgId }, multipart: form })
  expect(registered.status(), await registered.text()).toBe(201)

  const context = await contextAs(browser, customer, contextOptions)
  const page = await context.newPage()
  await page.goto('/dashboard')
  await page.getByRole('link', { name: 'Faturação' }).first().click()
  await page.waitForURL('**/dashboard/billing')
  await expect(page.getByRole('heading', { name: 'Faturação', exact: true })).toBeVisible()

  await page.getByLabel('NIF').fill('123 456 780')
  await page.getByRole('button', { name: 'Guardar' }).click()
  // Not `getByRole('alert')`: Next's route announcer is one too.
  await expect(page.getByText('NIF inválido')).toBeVisible()
  await page.getByLabel('NIF').fill('123 456 789')
  await page.getByLabel('Nome de faturação').fill('Clínica E2E, Lda.')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Dados de faturação guardados.')).toBeVisible({ timeout: 10000 })
  await page.reload()
  await expect(page.getByLabel('NIF')).toHaveValue('123456789', { timeout: 10000 })
  await expect(page.getByLabel('Nome de faturação')).toHaveValue('Clínica E2E, Lda.')

  const row = page.getByTestId('my-invoice').filter({ hasText: number })
  await expect(row).toBeVisible()
  await expect(row).toContainText('11h')
  const download = page.waitForEvent('download')
  await row.getByRole('button', { name: `Transferir PDF ${number}` }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^fatura-FT-E2E-\d+\.pdf$/)
  await context.close()

  // Another customer: nothing listed, and the PDF is a 404, not a 403.
  const other = await createCustomer(api, { tag: 'other' })
  const mine = await api.get(`${API_URL}/invoices/me`, { headers: auth(other.token) })
  expect(await mine.json()).toEqual({ invoices: [] })
  const invoiceId = (await registered.json()).invoice.id as string
  const forbidden = await api.get(`${API_URL}/invoices/${invoiceId}/pdf`, { headers: auth(other.token) })
  expect(forbidden.status()).toBe(404)
})
