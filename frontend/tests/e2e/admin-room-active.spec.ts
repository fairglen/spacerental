import { test, expect, API_URL, adminBooking, adminCancel, at, freshDay } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * A07 as an operator: a room with a future booking cannot be switched off —
 * the dialog lists the booking; cancel it, and the room goes off and
 * disappears from the customer's space page; switch it back on.
 *
 * The room is this test's own (Q41): nothing else ever books it, so the
 * test owns its future without touching anyone else's reservations.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 1400, height: 1000 } })

test('a room with a future booking refuses to go inactive, then goes off and on', async ({ page, api, admin, room }) => {
  const day = freshDay(20)
  const booking = await adminBooking(api, admin, { userId: admin.userId, roomId: room.id, start: at(day, 11), end: at(day, 12) })

  await page.goto(`/admin/rooms/${admin.spaceId}`)
  const card = page.getByTestId('admin-room-card').filter({ hasText: room.name })
  await card.getByRole('button', { name: `Desativar ${room.name}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Confirmar: desativar' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Ainda há 1 reserva marcada')
  await expect(dialog.getByRole('alert')).toContainText('Demo Admin')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // Out of the way, and try again.
  await adminCancel(api, admin, booking.id)
  await card.getByRole('button', { name: `Desativar ${room.name}` }).click()
  await dialog.getByRole('button', { name: 'Confirmar: desativar' }).click()
  await expect(card.getByText('Inativa')).toBeVisible({ timeout: 10000 })
  const hidden = await (await api.get(`${API_URL}/spaces/${admin.spaceId}`)).json()
  expect(hidden.rooms.map((r: { id: string }) => r.id)).not.toContain(room.id)

  await card.getByRole('button', { name: `Ativar ${room.name}` }).click()
  await dialog.getByRole('button', { name: 'Confirmar: ativar' }).click()
  await expect(card.getByText('Inativa')).toBeHidden({ timeout: 10000 })
  const shown = await (await api.get(`${API_URL}/spaces/${admin.spaceId}`)).json()
  expect(shown.rooms.map((r: { id: string }) => r.id)).toContain(room.id)
})
