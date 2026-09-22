import { test, expect } from '@playwright/test'

/**
 * C17 — "Ajuda": a visitor who is not signed in reports a problem from the
 * navbar and gets a reference back. The row's arrival is checked from the
 * operator side in admin-support.spec.ts (C19).
 *
 * The help form is throttled at 5 requests an hour per client: this file
 * sends exactly one, and the loop stack's backend is restarted before a
 * full run so a previous run's requests do not count.
 */
test('a signed-out visitor sends a help request and gets a reference', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: /^Ajuda$/ }).click()

  const dialog = page.getByRole('dialog', { name: /Ajuda/ })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Email')).toBeEditable()
  await expect(dialog.getByLabel(/Reserva/)).toHaveCount(0)

  // What is captured is disclosed, collapsed by default.
  const details = dialog.locator('details')
  await expect(details).not.toHaveAttribute('open', '')
  await dialog.getByText('O que enviamos com o pedido').click()
  await expect(details).toContainText(/browser/i)

  await dialog.getByLabel('Assunto').selectOption('technical')
  await dialog.getByLabel('Email').fill('visitante-e2e@example.com')
  await dialog.getByLabel('Mensagem').fill('E2E: o calendário não carrega na primeira visita, só depois de recarregar.')
  await dialog.getByRole('button', { name: /^Enviar$/ }).click()

  const status = dialog.getByRole('status')
  await expect(status).toBeVisible({ timeout: 10000 })
  await expect(status).toContainText(/#[0-9A-F]{8}/)
  await expect(status).toContainText('Respondemos por email')
  await expect(status).toContainText('visitante-e2e@example.com')
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(dialog).toHaveCount(0)
})

// C18: from the cancel dialog of a paid booking, the money question goes to a
// person through the help dialog, with the booking preselected.
test('a customer opens the help dialog from the cancel dialog and submits about that booking', async ({ page, request, browser }) => {
  const api = request
  const login = await api.post(`${process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  expect(login.ok()).toBeTruthy()
  const token = (await login.json()).access_token
  const API = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
  const auth = { Authorization: `Bearer ${token}` }

  // A confirmed hourly booking a week out, made through the stub gateways.
  const { spaces } = await (await api.get(`${API}/spaces`)).json()
  const { rooms } = await (await api.get(`${API}/spaces/${spaces[0].id}`)).json()
  const room = rooms[0]
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 8)
  while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1)
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 15))
  const created = await api.post(`${API}/bookings`, {
    headers: auth,
    data: { room_id: room.id, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3_600_000).toISOString(), payment_method: 'hourly' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { booking, checkout_url } = await created.json()
  const sessionId = new URL(checkout_url).pathname.split('/').pop()
  expect((await api.post(`${new URL(API).origin}/checkout/stub/${sessionId}/pay`, { maxRedirects: 0 })).status()).toBe(303)

  try {
    const context = await browser.newContext({ storageState: 'tests/e2e/.auth/admin.json' })
    const customer = await context.newPage()
    await customer.goto('/dashboard')
    const card = customer.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ has: customer.getByText('Confirmado') }).first()
    await card.getByRole('button', { name: /^Cancelar$/ }).click()

    const cancelDialog = customer.getByRole('dialog', { name: /Cancelar reserva/ })
    await expect(cancelDialog).toBeVisible()
    await expect(cancelDialog.getByRole('button', { name: /Sim, cancelar/ })).toBeEnabled()
    await expect(cancelDialog).not.toContainText(/reembols/i)
    await cancelDialog.getByRole('button', { name: /Fala connosco/ }).click()

    const help = customer.getByRole('dialog', { name: /Ajuda/ })
    await expect(help).toBeVisible()
    await expect(help.getByLabel('Assunto')).toHaveValue('payment')
    await expect(help.getByLabel(/Reserva/)).toHaveValue(booking.id)
    await expect(help.getByLabel('Email')).toHaveValue('admin@demo.com')
    await help.getByLabel('Mensagem').fill('E2E: tenho uma dúvida sobre o valor desta reserva antes de a cancelar.')
    await help.getByRole('button', { name: /^Enviar$/ }).click()
    await expect(help.getByRole('status')).toContainText(/#[0-9A-F]{8}/, { timeout: 10000 })
    await context.close()
  } finally {
    await api.delete(`${API}/bookings/${booking.id}`, { headers: auth })
  }
})
