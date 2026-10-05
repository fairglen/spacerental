import { randomUUID } from 'node:crypto'
import { test, expect, API_URL, at, auth, createBooking, freshDay } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

// C19: what a visitor and a customer sent is in the operator's inbox, newest
// first, with the booking reference, and can be closed. Self-sufficient: it
// sends both requests through the API first, from a visitor address and a
// customer of its own (Q41), so help.spec.ts running at the same time shares
// no row with it.
test.use({ storageState: ADMIN_STORAGE_STATE })

test('the admin sees the requests in /admin/support with the booking, and can close one', async ({ page, api, room, customer }) => {
  const visitorEmail = `visitante-${randomUUID().slice(0, 8)}@example.com`

  // A confirmed booking to ask about, a week out, through the stub gateways.
  const day = freshDay(9)
  const { booking } = await createBooking(api, customer, { roomId: room.id, start: at(day, 17), end: at(day, 18), pay: true })

  const visitorSent = await api.post(`${API_URL}/support/requests`, {
    data: { category: 'technical', message: 'E2E (inbox): o calendário não carrega na primeira visita, só depois de recarregar.', contact_email: visitorEmail, context: {}, website: '' },
  })
  expect(visitorSent.status(), await visitorSent.text()).toBe(201)
  const customerSent = await api.post(`${API_URL}/support/requests`, {
    headers: auth(customer.token),
    data: { category: 'payment', message: 'E2E (inbox): tenho uma dúvida sobre o valor desta reserva antes de a cancelar.', booking_id: booking.id, context: { page_url: 'http://localhost:3000/dashboard', viewport: '1280x720', user_agent: 'Mozilla/5.0 (e2e)', app_version: 'e2e', timestamp: new Date().toISOString() }, website: '' },
  })
  expect(customerSent.status(), await customerSent.text()).toBe(201)

  await page.goto('/admin/support')
  await expect(page.getByRole('heading', { name: 'Pedidos de ajuda' })).toBeVisible({ timeout: 15000 })

  // The visitor's request (technical, no booking)…
  const visitor = page.getByRole('row').filter({ hasText: visitorEmail }).first()
  await expect(visitor).toBeVisible({ timeout: 15000 })
  await expect(visitor).toContainText('Problema técnico')
  await expect(visitor).toContainText('—')

  // …and the customer's, about a booking, with its room and time.
  const customerRow = page.getByRole('row').filter({ hasText: customer.email }).filter({ hasText: 'Pagamento' }).first()
  await expect(customerRow).toBeVisible()
  await expect(customerRow).toContainText(room.name)

  await customerRow.getByRole('button', { name: /Ver pedido/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('dúvida sobre o valor desta reserva')
  await expect(dialog).toContainText(/Browser/)
  await page.keyboard.press('Escape')

  await customerRow.getByRole('button', { name: /Marcar como fechada/ }).click()
  await expect(page.getByRole('row').filter({ hasText: customer.email }).filter({ hasText: 'Pagamento' }).first()).toContainText('Fechada')

  // The sidebar has the entry.
  await expect(page.getByRole('link', { name: 'Pedidos de ajuda' })).toBeVisible()
})
