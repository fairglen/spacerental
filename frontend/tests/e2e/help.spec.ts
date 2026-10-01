import { test, expect } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const API_ROOT = API_URL.replace(/\/api\/v1$/, '')

/**
 * C17 — "Ajuda": a visitor who is not signed in reports a problem from the
 * navbar and gets a reference back. The row's arrival is checked from the
 * operator side in admin-support.spec.ts (C19).
 *
 * The help form is throttled at 5 requests an hour per client. The whole
 * suite sends four (two here, two in admin-support.spec.ts), so a full run
 * fits in one window; restart the backend before running it twice within an
 * hour, or the fifth request answers 429.
 */
test('a signed-out visitor sends a help request and gets a reference, and both emails go out', async ({ page, request }) => {
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
  await expect(status).toContainText('Enviámos uma cópia para visitante-e2e@example.com')
  await expect(status).toContainText('respondemos por email')
  const reference = (await status.textContent())!.match(/#([0-9A-F]{8})/)![1]
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(dialog).toHaveCount(0)

  // K03: the inbox copy (answerable to the visitor) and the visitor's own copy
  // (answerable to the inbox), both from the stub mailbox.
  const mailbox = await request.get(`${API_ROOT}/__test__/emails`)
  expect(mailbox.ok(), await mailbox.text()).toBeTruthy()
  const { emails } = (await mailbox.json()) as { emails: Array<{ to: string; subject: string; reply_to: string | null; links: string[] }> }
  const inbox = emails.find((m) => m.subject === `[Ajuda] Problema técnico — #${reference}`)
  expect(inbox, 'the inbox copy reached the stub mailbox').toBeTruthy()
  expect(inbox!.to).toBe('geral+support@flowspace.pt')
  expect(inbox!.reply_to).toBe('visitante-e2e@example.com')
  expect(inbox!.links.some((l) => l.includes('/admin/support/'))).toBe(true)
  const copy = emails.find((m) => m.subject === `[FlowSpace] Recebemos o seu pedido #${reference}`)
  expect(copy, 'the requester copy reached the stub mailbox').toBeTruthy()
  expect(copy!.to).toBe('visitante-e2e@example.com')
  expect(copy!.reply_to).toBe('geral+support@flowspace.pt')
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
  // A previous run that failed before its cleanup may still hold this slot.
  const mine = (await (await api.get(`${API}/bookings/me`, { headers: auth })).json()).bookings
  for (const b of mine) {
    if (b.start_time === start.toISOString().replace('.000Z', 'Z') && !['cancelled', 'expired'].includes(b.status)) {
      await api.delete(`${API}/bookings/${b.id}`, { headers: auth })
    }
  }
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
    await cancelDialog.getByRole('button', { name: /Fale connosco/ }).click()

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
