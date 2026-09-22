import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

// C19: what a visitor and a customer sent is in the operator's inbox, newest
// first, with the booking reference, and can be closed. Self-sufficient: it
// sends both requests through the API first (Playwright runs files
// alphabetically, so it cannot lean on help.spec.ts).
test.use({ storageState: ADMIN_STORAGE_STATE })

test('the admin sees the requests in /admin/support with the booking, and can close one', async ({ page, request }) => {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  const token = (await login.json()).access_token
  const auth = { Authorization: `Bearer ${token}` }
  const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
  const { rooms: seeded } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()

  // A confirmed booking to ask about, a week out, through the stub gateways.
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 9)
  while (day.getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1)
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 17))
  // A previous run that failed before its cleanup may still hold this slot.
  const mine = (await (await request.get(`${API_URL}/bookings/me`, { headers: auth })).json()).bookings
  for (const b of mine) {
    if (b.start_time === start.toISOString().replace('.000Z', 'Z') && !['cancelled', 'expired'].includes(b.status)) {
      await request.delete(`${API_URL}/bookings/${b.id}`, { headers: auth })
    }
  }
  const created = await request.post(`${API_URL}/bookings`, {
    headers: auth,
    data: { room_id: seeded[0].id, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3_600_000).toISOString(), payment_method: 'hourly' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const { booking, checkout_url } = await created.json()
  await request.post(`${new URL(API_URL).origin}/checkout/stub/${new URL(checkout_url).pathname.split('/').pop()}/pay`, { maxRedirects: 0 })

  const visitorSent = await request.post(`${API_URL}/support/requests`, {
    data: { category: 'technical', message: 'E2E (inbox): o calendário não carrega na primeira visita, só depois de recarregar.', contact_email: 'visitante-e2e@example.com', context: {}, website: '' },
  })
  expect(visitorSent.status(), await visitorSent.text()).toBe(201)
  const customerSent = await request.post(`${API_URL}/support/requests`, {
    headers: auth,
    data: { category: 'payment', message: 'E2E (inbox): tenho uma dúvida sobre o valor desta reserva antes de a cancelar.', booking_id: booking.id, context: { page_url: 'http://localhost:3000/dashboard', viewport: '1280x720', user_agent: 'Mozilla/5.0 (e2e)', app_version: 'e2e', timestamp: new Date().toISOString() }, website: '' },
  })
  expect(customerSent.status(), await customerSent.text()).toBe(201)

  try {
  await page.goto('/admin/support')
  await expect(page.getByRole('heading', { name: 'Pedidos de ajuda' })).toBeVisible({ timeout: 15000 })

  // The visitor's request (help.spec.ts, technical, no booking)…
  const visitor = page.getByRole('row').filter({ hasText: 'visitante-e2e@example.com' }).first()
  await expect(visitor).toBeVisible({ timeout: 15000 })
  await expect(visitor).toContainText('Problema técnico')
  await expect(visitor).toContainText('—')

  // …and the customer's, about a booking, with its room and time.
  const customer = page.getByRole('row').filter({ hasText: 'admin@demo.com' }).filter({ hasText: 'Pagamento' }).first()
  await expect(customer).toBeVisible()
  await expect(customer).toContainText(seeded[0].name)

  await customer.getByRole('button', { name: /Ver pedido/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('dúvida sobre o valor desta reserva')
  await expect(dialog).toContainText(/Browser/)
  await page.keyboard.press('Escape')

  await customer.getByRole('button', { name: /Marcar como fechada/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'admin@demo.com' }).filter({ hasText: 'Pagamento' }).first()).toContainText('Fechada')

  // The sidebar has the entry.
  await expect(page.getByRole('link', { name: 'Pedidos de ajuda' })).toBeVisible()
  } finally {
    await request.delete(`${API_URL}/bookings/${booking.id}`, { headers: auth })
  }
})
