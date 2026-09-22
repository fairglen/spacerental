import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/**
 * A03 as an operator: open the calendar, click a booking and cancel it from
 * the sheet, create a manual booking on an empty slot, block an hour, and
 * see both as unavailable on the customer calendar.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1400, height: 1000 } })

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
function dayAt(daysAhead: number, hour: number): Date {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead)
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
}

test('calendar: cancel from the sheet, book manually, block an hour, and the customer sees both taken', async ({ page, request }) => {
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  const token = (await login.json()).access_token
  const auth = { Authorization: `Bearer ${token}` }
  const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms[0]
  const day = dayAt(16, 0)

  // Clean the day this test uses, then seed one confirmed booking at 10:00.
  const mine = (await (await request.get(`${API_URL}/bookings/me`, { headers: auth })).json()).bookings
  for (const b of mine) {
    if (b.start_time.slice(0, 10) === isoDate(day) && !['cancelled', 'expired'].includes(b.status)) {
      await request.put(`${API_URL}/admin/bookings/${b.id}`, { headers: auth, params: { org_id: room.org_id }, data: { status: 'cancelled' } })
    }
  }
  const blocks = await (await request.get(`${API_URL}/admin/rooms/${room.id}/blocks`, { headers: auth, params: { org_id: room.org_id, from: day.toISOString(), to: dayAt(17, 0).toISOString() } })).json()
  for (const k of blocks.blocks) await request.delete(`${API_URL}/admin/rooms/${room.id}/blocks/${k.id}`, { headers: auth, params: { org_id: room.org_id } })

  const seeded = await request.post(`${API_URL}/bookings`, {
    headers: auth,
    data: { room_id: room.id, start_time: dayAt(16, 10).toISOString(), end_time: dayAt(16, 11).toISOString(), payment_method: 'hourly' },
  })
  expect(seeded.ok(), await seeded.text()).toBeTruthy()
  const { booking, checkout_url } = await seeded.json()
  await request.post(`${new URL(API_URL).origin}/checkout/stub/${new URL(checkout_url).pathname.split('/').pop()}/pay`, { maxRedirects: 0 })

  // ── Open the calendar on that day, day-by-room ──────────────────────────
  await page.goto(`/admin/calendar?view=day&date=${isoDate(day)}`)
  await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible({ timeout: 15000 })
  // One column per room.
  for (const r of rooms) await expect(page.locator('.rbc-time-header-content').getByText(r.name, { exact: true })).toBeVisible({ timeout: 15000 })

  // ── Click the seeded booking and cancel it from the sheet ───────────────
  const event = page.locator('.rbc-event').filter({ hasText: 'Demo Admin' }).first()
  await expect(event).toBeVisible({ timeout: 15000 })
  await event.click()
  const sheet = page.getByRole('dialog', { name: 'Reserva' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('admin@demo.com')
  await expect(sheet).toContainText('10:00–11:00')
  await sheet.getByRole('button', { name: 'Cancelar reserva' }).click()
  await sheet.getByLabel(/Motivo do cancelamento/).fill('E2E: cancelada pelo espaço')
  await sheet.getByRole('button', { name: 'Sim, cancelar' }).click()
  await expect(sheet.getByRole('status')).toContainText('Reserva cancelada')
  await sheet.getByRole('button', { name: 'Fechar' }).click()
  await expect(page.locator('.rbc-event').filter({ hasText: 'Demo Admin' })).toHaveCount(0)
  const cancelled = (await (await request.get(`${API_URL}/bookings/me`, { headers: auth })).json()).bookings.find((b: { id: string }) => b.id === booking.id)
  expect(cancelled.status).toBe('cancelled')

  // ── Manual booking on an empty slot (14:00) via the dialog ─────────────
  // With resources there is one column per room, in the rooms' order; a
  // selection is a press and release on the grid (react-big-calendar's
  // selectable layer), not a click on the cell.
  const columnIndex = rooms.findIndex((r: { id: string }) => r.id === room.id)
  const column = page.locator('.rbc-time-content .rbc-day-slot').nth(columnIndex)
  const selectHour = async (hour: number) => {
    const rowIndex = await page.locator('.rbc-time-gutter .rbc-timeslot-group').evaluateAll(
      (groups, h) => groups.findIndex((g) => g.textContent?.includes(`${String(h).padStart(2, '0')}:00`)), hour,
    )
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    const cell = column.locator('.rbc-timeslot-group').nth(rowIndex).locator('.rbc-time-slot').first()
    await cell.scrollIntoViewIfNeeded()
    const box = (await cell.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 2)
    await page.mouse.up()
  }
  await selectHour(14)
  const dialog = page.getByRole('dialog', { name: 'Nova reserva' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Início')).toHaveValue('14:00')
  await dialog.getByLabel('Cliente').fill('admin@')
  await dialog.getByRole('option', { name: /admin@demo\.com/ }).click()
  await dialog.getByLabel(/Nota interna/).fill('E2E: pago em dinheiro')
  await dialog.getByRole('button', { name: 'Criar reserva' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.rbc-event').filter({ hasText: 'local' }).filter({ hasText: 'Demo Admin' })).toBeVisible({ timeout: 15000 })

  // ── Block 16:00–17:00 ──────────────────────────────────────────────────
  await selectHour(16)
  // The dialog's accessible name follows the tab: "Nova reserva", then "Bloquear horário".
  await page.getByRole('dialog', { name: 'Nova reserva' }).getByRole('tab', { name: 'Bloquear horário' }).click()
  const blockDialog = page.getByRole('dialog', { name: 'Bloquear horário' })
  await blockDialog.getByLabel('Motivo').fill('E2E: limpeza')
  await blockDialog.getByRole('button', { name: 'Bloquear', exact: true }).click()
  await expect(page.locator('.rbc-event').filter({ hasText: 'limpeza' })).toBeVisible({ timeout: 15000 })

  // ── The customer calendar shows 14:00 and 16:00 as taken ───────────────
  const { slots } = await (await request.get(`${API_URL}/rooms/${room.id}/availability`, { params: { date: isoDate(day) } })).json()
  const byHour = Object.fromEntries(slots.map((s: { start: string; available: boolean }) => [new Date(s.start).getUTCHours(), s.available]))
  expect(byHour[14]).toBe(false)
  expect(byHour[16]).toBe(false)
  expect(byHour[10]).toBe(true) // the cancelled one is free again
  expect(byHour[15]).toBe(true)

  // Clean up: cancel the manual booking, remove the block.
  const manual = (await (await request.get(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: room.org_id, from: dayAt(16, 14).toISOString(), to: dayAt(16, 15).toISOString() } })).json()).bookings[0]
  await request.put(`${API_URL}/admin/bookings/${manual.id}`, { headers: auth, params: { org_id: room.org_id }, data: { status: 'cancelled' } })
  const left = await (await request.get(`${API_URL}/admin/rooms/${room.id}/blocks`, { headers: auth, params: { org_id: room.org_id, from: day.toISOString(), to: dayAt(17, 0).toISOString() } })).json()
  for (const k of left.blocks) await request.delete(`${API_URL}/admin/rooms/${room.id}/blocks/${k.id}`, { headers: auth, params: { org_id: room.org_id } })
})
