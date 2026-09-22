import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/**
 * H03 as an operator: a booking paid with pack hours is shortened from the
 * calendar sheet's "Alterar horário" — the very edit that used to be refused
 * with a misleading conflict — and the customer's hour bank shows the hours
 * that came back. Then the same form is refused cleanly (an end before the
 * start) and keeps its values.
 *
 * Pre-authenticated as the seeded admin; the customer is a fresh account so
 * the seeded admin's own packs (which packages.spec.ts reads) stay as found.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1400, height: 1000 } })

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
function dayAt(daysAhead: number, hour: number): Date {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + daysAhead)
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
}

test('shortening a pack booking from the sheet returns the surplus hours to the bank', async ({ page, request }) => {
  test.setTimeout(180_000)
  const login = await request.post(`${API_URL}/auth/login`, { data: { email: 'admin@demo.com', password: 'admin123' } })
  const token = (await login.json()).access_token
  const auth = { Authorization: `Bearer ${token}` }
  const stamp = Date.now()
  const registered = await request.post(`${API_URL}/auth/register`, { data: { email: `e2e-h03-${stamp}@example.com`, password: 'Password123!', name: `Cliente H03 ${stamp}` } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  const customer = { Authorization: `Bearer ${(await registered.json()).access_token}` }
  const me = await (await request.get(`${API_URL}/auth/me`, { headers: customer })).json()
  const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  // The middle room: admin-calendar uses the first, admin-room-active the last.
  const room = rooms[Math.min(1, rooms.length - 1)]
  const org = room.org_id
  const day = dayAt(18, 0)

  // Clean the day this test uses, so the 09:00–18:00 block is free.
  const held = await (await request.get(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: org, room_id: room.id, from: day.toISOString(), to: dayAt(18, 23).toISOString(), page_size: 100 } })).json()
  for (const b of held.bookings) {
    if (!['cancelled', 'expired', 'completed'].includes(b.status)) {
      await request.put(`${API_URL}/admin/bookings/${b.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
    }
  }

  // A pack with exactly the nine hours the booking will use.
  const { packages } = await (await request.get(`${API_URL}/packages`, { params: { org_id: org } })).json()
  const granted = await request.post(`${API_URL}/admin/users/${me.id}/complimentary-hours`, {
    headers: auth, params: { org_id: org }, data: { package_id: packages[0].id, hours: 9, reason: 'H03 e2e' },
  })
  expect(granted.status(), await granted.text()).toBe(201)
  const bankBefore = (await (await request.get(`${API_URL}/packages/me`, { headers: customer })).json()).balance.hours_available

  // 09:00–18:00 paid with those nine hours.
  const seeded = await request.post(`${API_URL}/bookings`, {
    headers: customer,
    data: { room_id: room.id, start_time: dayAt(18, 9).toISOString(), end_time: dayAt(18, 18).toISOString(), payment_method: 'package' },
  })
  expect(seeded.status(), await seeded.text()).toBe(201)
  const { booking } = await seeded.json()
  expect(booking).toMatchObject({ payment_method: 'package', package_hours_used: '9.00' })
  const drained = (await (await request.get(`${API_URL}/packages/me`, { headers: customer })).json()).balance.hours_available
  expect(Number(drained)).toBe(Number(bankBefore) - 9)

  // ── The sheet: 09:00–18:00 → 09:00–15:00 ─────────────────────────────────
  await page.goto(`/admin/calendar?view=day&date=${isoDate(day)}`)
  await expect(page.getByRole('heading', { name: 'Calendário' })).toBeVisible({ timeout: 30000 })
  const event = page.locator('.rbc-event').filter({ hasText: `Cliente H03 ${stamp}` }).first()
  await expect(event).toBeVisible({ timeout: 30000 })
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
  const after = await (await request.get(`${API_URL}/packages/me`, { headers: customer })).json()
  expect(Number(after.balance.hours_available)).toBe(Number(bankBefore) - 6)
  const listed = await (await request.get(`${API_URL}/admin/bookings`, { headers: auth, params: { org_id: org, room_id: room.id, from: dayAt(18, 0).toISOString(), page_size: 100 } })).json()
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

  // Leave the stack as found.
  const cancelled = await request.put(`${API_URL}/admin/bookings/${booking.id}`, { headers: auth, params: { org_id: org }, data: { status: 'cancelled' } })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  const restored = await (await request.get(`${API_URL}/packages/me`, { headers: customer })).json()
  expect(Number(restored.balance.hours_available)).toBe(Number(bankBefore))
})
