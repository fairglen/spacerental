import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/**
 * A07 as an operator: a room with a future booking cannot be switched off —
 * the dialog lists the booking; cancel it, and the room goes off and
 * disappears from the customer's space page; switch it back on.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

test('a room with a future booking refuses to go inactive, then goes off and on', async ({ page, request }) => {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  const auth = { Authorization: `Bearer ${(await login.json()).access_token}` }
  const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  // The last seeded room: the other specs book the first ones.
  const room = rooms[rooms.length - 1]
  const org = room.org_id

  // Everything still holding a future slot in this room goes first, so the
  // test owns the room's future.
  const held = await (await request.get(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: org, room_id: room.id, from: new Date().toISOString(), page_size: 100 } })).json()
  for (const b of held.bookings) {
    if (!['cancelled', 'expired', 'completed'].includes(b.status)) await request.put(`${API_URL}/admin/bookings/${b.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
  }
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 20); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11))
  const user = await (await request.get(`${API_URL}/auth/me`, { headers: auth })).json()
  const made = await request.post(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: org }, data: { user_id: user.id, room_id: room.id, start_time: start.toISOString(), end_time: new Date(start.getTime() + 3.6e6).toISOString() } })
  expect(made.ok(), await made.text()).toBeTruthy()
  const booking = (await made.json()).booking

  await page.goto(`/admin/rooms/${spaces[0].id}`)
  const card = page.getByTestId('admin-room-card').filter({ hasText: room.name })
  await card.getByRole('button', { name: `Desativar ${room.name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Confirmar: desativar' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Ainda há 1 reserva marcada')
  await expect(dialog.getByRole('alert')).toContainText('Demo Admin')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // Out of the way, and try again.
  await request.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
  await card.getByRole('button', { name: `Desativar ${room.name}` }).click()
  await dialog.getByRole('button', { name: 'Confirmar: desativar' }).click()
  await expect(card.getByText('Inativa')).toBeVisible({ timeout: 10000 })
  const hidden = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  expect(hidden.rooms.map((r: { id: string }) => r.id)).not.toContain(room.id)

  await card.getByRole('button', { name: `Ativar ${room.name}` }).click()
  await dialog.getByRole('button', { name: 'Confirmar: ativar' }).click()
  await expect(card.getByText('Inativa')).toBeHidden({ timeout: 10000 })
  const shown = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  expect(shown.rooms.map((r: { id: string }) => r.id)).toContain(room.id)
})
