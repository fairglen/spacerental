import { test, expect, API_URL, at, auth, createBooking, freshDay, isoDate, SEEDED_ROOMS } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * A03 as an operator: open the calendar, click a booking and cancel it from
 * the sheet, create a manual booking on an empty slot, block an hour, and
 * see both as unavailable on the customer calendar.
 *
 * Everything happens in a room of this test's own (Q41): nothing else books
 * it, so the day needs no cleaning and the free-hour assertions hold.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1400, height: 1000 } })

test('calendar: cancel from the sheet, book manually, block an hour, and the customer sees both taken', async ({ page, api, admin, room }) => {
  const day = freshDay(16)
  const headers = auth(admin.token)

  // One confirmed booking at 10:00, the admin's own, paid on the stub.
  const { booking } = await createBooking(api, { token: admin.token }, { roomId: room.id, start: at(day, 10), end: at(day, 11), pay: true })

  // ── Open the calendar on that day, day-by-room ──────────────────────────
  await page.goto(`/admin/calendar?view=day&date=${isoDate(day)}`)
  await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible({ timeout: 15000 })
  // One column per room: the seeded ones and this test's.
  for (const name of [...SEEDED_ROOMS, room.name]) {
    await expect(page.locator('.rbc-time-header-content').getByText(name, { exact: true })).toBeVisible({ timeout: 15000 })
  }
  // With resources there is one column per room, in the header's order; the
  // room list the API returns is not ordered, so the header is the map.
  // react-big-calendar renders one resource header (`.rbc-row-resource
  // .rbc-header`) per room, in column order.
  const headerTexts = await page.locator('.rbc-time-header-content .rbc-row-resource .rbc-header').allTextContents()
  const columnIndex = headerTexts.findIndex((text) => text.trim() === room.name)
  expect(headerTexts.length, 'one resource header per room').toBeGreaterThanOrEqual(SEEDED_ROOMS.length + 1)
  expect(columnIndex).toBeGreaterThanOrEqual(0)
  const column = page.locator('.rbc-time-content .rbc-day-slot').nth(columnIndex)

  // ── Click the seeded booking and cancel it from the sheet ───────────────
  const event = column.locator('.rbc-event').filter({ hasText: 'Demo Admin' }).first()
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
  await expect(column.locator('.rbc-event').filter({ hasText: 'Demo Admin' })).toHaveCount(0)
  const cancelled = (await (await api.get(`${API_URL}/bookings/me`, { headers })).json()).bookings.find((b: { id: string }) => b.id === booking.id)
  expect(cancelled.status).toBe('cancelled')

  // ── Manual booking on an empty slot (14:00) via the dialog ─────────────
  // A selection is a press and release on the grid (react-big-calendar's
  // selectable layer), not a click on the cell.
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
  await expect(column.locator('.rbc-event').filter({ hasText: 'local' }).filter({ hasText: 'Demo Admin' })).toBeVisible({ timeout: 15000 })

  // ── Block 16:00–17:00 ──────────────────────────────────────────────────
  await selectHour(16)
  // The dialog's accessible name follows the tab: "Nova reserva", then "Bloquear horário".
  await page.getByRole('dialog', { name: 'Nova reserva' }).getByRole('tab', { name: 'Bloquear horário' }).click()
  const blockDialog = page.getByRole('dialog', { name: 'Bloquear horário' })
  await blockDialog.getByLabel('Motivo').fill('E2E: limpeza')
  await blockDialog.getByRole('button', { name: 'Bloquear', exact: true }).click()
  await expect(column.locator('.rbc-event').filter({ hasText: 'limpeza' })).toBeVisible({ timeout: 15000 })

  // ── The customer calendar shows 14:00 and 16:00 as taken ───────────────
  const { slots } = await (await api.get(`${API_URL}/rooms/${room.id}/availability`, { params: { date: isoDate(day) } })).json()
  const byHour = Object.fromEntries(slots.map((s: { start: string; available: boolean }) => [new Date(s.start).getUTCHours(), s.available]))
  expect(byHour[14]).toBe(false)
  expect(byHour[16]).toBe(false)
  expect(byHour[10]).toBe(true) // the cancelled one is free again
  expect(byHour[15]).toBe(true)
  // The room, its manual booking and its block leave with the `room` fixture.
})
