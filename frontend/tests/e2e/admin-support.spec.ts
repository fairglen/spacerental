import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

// C19: what help.spec.ts sent is in the operator's inbox, newest first, with
// the booking reference, and can be closed. Runs after help.spec.ts.
test.use({ storageState: ADMIN_STORAGE_STATE })

test('the admin sees the requests in /admin/support with the booking, and can close one', async ({ page, request }) => {
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
  const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  await expect(customer).toContainText(rooms[0].name)

  await customer.getByRole('button', { name: /Ver pedido/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('dúvida sobre o valor desta reserva')
  await expect(dialog).toContainText(/Browser/)
  await page.keyboard.press('Escape')

  await customer.getByRole('button', { name: /Marcar como fechada/ }).click()
  await expect(page.getByRole('row').filter({ hasText: 'admin@demo.com' }).filter({ hasText: 'Pagamento' }).first()).toContainText('Fechada')

  // The sidebar has the entry.
  await expect(page.getByRole('link', { name: 'Pedidos de ajuda' })).toBeVisible()
})
