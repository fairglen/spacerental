import { test, expect, API_URL, at, auth, createBooking, freshDay, grantHours, isoDate, packageByHours } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * H03 as an operator: a booking paid with pack hours is shortened from the
 * calendar sheet's "Alterar horário" — the very edit that used to be refused
 * with a misleading conflict — and the customer's hour bank shows the hours
 * that came back. Then the same form is refused cleanly (an end before the
 * start) and keeps its values.
 *
 * Pre-authenticated as the seeded admin; the customer and the room are this
 * test's own (Q41), so the 09:00–18:00 block is free by construction.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1400, height: 1000 } })

test('shortening a pack booking from the sheet returns the surplus hours to the bank', async ({ page, api, admin, room, customer }) => {
  const operator = auth(admin.token)
  const org = { org_id: admin.orgId }
  const day = freshDay(18)

  // A pack with exactly the nine hours the booking will use.
  const pack = await packageByHours(api, admin.orgId, 10)
  await grantHours(api, admin, { userId: customer.id, packageId: pack.id, hours: '9', reason: 'H03 e2e' })
  const bankBefore = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).balance.hours_available

  // 09:00–18:00 paid with those nine hours.
  const { booking } = await createBooking(api, customer, { roomId: room.id, start: at(day, 9), end: at(day, 18), paymentMethod: 'package' })
  expect(booking).toMatchObject({ payment_method: 'package', package_hours_used: '9.00' })
  const drained = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).balance.hours_available
  expect(Number(drained)).toBe(Number(bankBefore) - 9)

  // ── The sheet: 09:00–18:00 → 09:00–15:00 ─────────────────────────────────
  await page.goto(`/admin/calendar?view=day&date=${isoDate(day)}`)
  await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible({ timeout: 15000 })
  const event = page.locator('.rbc-event').filter({ hasText: customer.name }).first()
  await expect(event).toBeVisible({ timeout: 15000 })
  await event.click()
  const sheet = page.getByRole('dialog', { name: 'Reserva' })
  await expect(sheet).toContainText('09:00–18:00')
  await expect(sheet).toContainText('Pack · 9h do pack')
  await sheet.getByRole('button', { name: 'Alterar horário' }).click()
  await sheet.getByLabel('Fim').fill('15:00')
  await sheet.getByRole('button', { name: 'Guardar horário' }).click()
  const status = sheet.getByRole('status')
  await expect(status).toContainText('9h → 6h', { timeout: 15000 })
  await expect(status).toContainText('voltaram ao banco de horas')
  await expect(status).toContainText('Nenhum dinheiro foi movido')
  await expect(sheet).toContainText('09:00–15:00')
  await expect(sheet).toContainText('6h do pack')

  // The customer's bank has the three hours back.
  const after = await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()
  expect(Number(after.balance.hours_available)).toBe(Number(bankBefore) - 6)
  const listed = await (await api.get(`${API_URL}/admin/bookings`, { headers: operator, params: { ...org, room_id: room.id, from: at(day, 0).toISOString(), page_size: 100 } })).json()
  const row = listed.bookings.find((b: { id: string }) => b.id === booking.id)
  expect(row.package_hours_used).toBe('6.00')
  expect(row.package_debits.reduce((sum: number, d: { hours: string }) => sum + Number(d.hours), 0)).toBe(6)

  // ── A refused edit keeps the form so the operator can adjust ─────────────
  await sheet.getByRole('button', { name: 'Alterar horário' }).click()
  await sheet.getByLabel('Fim').fill('08:00')
  await sheet.getByRole('button', { name: 'Guardar horário' }).click()
  await expect(sheet.getByRole('alert')).toHaveText('O fim tem de ser depois do início.')
  await expect(sheet.getByLabel('Fim')).toHaveValue('08:00')
  await expect(sheet.getByRole('button', { name: 'Guardar horário' })).toBeEnabled()

  // Cancelling gives the whole pack share back.
  const cancelled = await api.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: operator, params: org, data: { status: 'cancelled' } })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  const restored = await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()
  expect(Number(restored.balance.hours_available)).toBe(Number(bankBefore))
})
