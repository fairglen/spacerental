import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * H02: the hour bank. A fresh customer is granted two packs (5h lapsing in a
 * month, 15h in a year), books a 12-hour day with "my pack": the API draws
 * 5 + 7 across them and charges nothing; the customer's dashboard shows the
 * booking as pack-paid, their packs page shows one balance of 8h with the
 * soonest slice named, and the operator's bookings table names both packs.
 *
 * Pre-authenticated as the seeded admin for the operator screens (see
 * admin.spec.ts); the customer signs in through the form once for their own.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

async function adminToken(page: Page): Promise<string> {
  const session = await (await page.request.get('/api/auth/session')).json()
  expect(typeof session.accessToken, 'stored admin session has no backend token').toBe('string')
  return session.accessToken
}

/** The first weekday from `from` days out on which 08:00–20:00 UTC is entirely free. */
async function freeDay(page: Page, roomId: string, from: number): Promise<Date> {
  for (let offset = from; offset < from + 10; offset++) {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + offset)
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    if (day.getUTCDay() === 0) continue
    const { slots } = await (await page.request.get(`${API_URL}/rooms/${roomId}/availability`, {
      params: { date: day.toISOString().slice(0, 10) },
    })).json()
    if (slots.length === 12 && slots.every((s: { available: boolean }) => s.available)) return day
  }
  throw new Error('no fully free day in the next ten')
}

test('two packs form one bank: a 12h day draws on both, the balance shows what is left', async ({ page }) => {
  // Four first-time routes on a dev server (admin table, sign-in, dashboard,
  // packs), each compiled on demand.
  test.setTimeout(300_000)
  const stamp = Date.now()
  const email = `e2e-bank-${stamp}@example.com`
  const password = 'Password123!'
  const api = page.request
  const admin = { Authorization: `Bearer ${await adminToken(page)}` }

  const registered = await api.post(`${API_URL}/auth/register`, { data: { email, password, name: `Cliente Banco ${stamp}` } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  const customer = { Authorization: `Bearer ${(await registered.json()).access_token}` }
  const me = await (await api.get(`${API_URL}/auth/me`, { headers: customer })).json()

  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms[rooms.length - 1]
  const org = room.org_id
  const { packages } = await (await api.get(`${API_URL}/packages`, { params: { org_id: org } })).json()

  // Two purchases, the small one lapsing first.
  const soon = new Date(); soon.setUTCDate(soon.getUTCDate() + 30)
  const later = new Date(); later.setUTCFullYear(later.getUTCFullYear() + 1)
  for (const [hours, expires_at] of [[5, soon], [15, later]] as const) {
    const granted = await api.post(`${API_URL}/admin/users/${me.id}/complimentary-hours`, {
      headers: admin, params: { org_id: org },
      data: { package_id: packages[0].id, hours, reason: `Banco de horas e2e ${hours}h`, expires_at: expires_at.toISOString() },
    })
    expect(granted.status(), await granted.text()).toBe(201)
  }
  const before = await (await api.get(`${API_URL}/packages/me`, { headers: customer })).json()
  expect(before.balance).toMatchObject({ hours_available: '20.00', hours_expiring_next: { hours: '5.00' } })

  // The whole day, with "my pack": 5 from the first purchase, 7 from the second.
  const day = await freeDay(page, room.id, 3)
  const start = new Date(day.getTime() + 8 * 3.6e6)
  const booked = await api.post(`${API_URL}/bookings`, {
    headers: customer,
    data: { room_id: room.id, start_time: start.toISOString(), end_time: new Date(day.getTime() + 20 * 3.6e6).toISOString(), payment_method: 'mixed' },
  })
  expect(booked.status(), await booked.text()).toBe(201)
  const { booking, checkout_url } = await booked.json()
  expect(booking).toMatchObject({ payment_method: 'package', status: 'confirmed', package_hours_used: '12.00' })
  expect(checkout_url).toBeNull()

  const after = await (await api.get(`${API_URL}/packages/me`, { headers: customer })).json()
  // The small pack is spent; what lapses next is the 8h left on the big one.
  expect(after.balance).toMatchObject({ hours_available: '8.00', hours_expiring_next: { hours: '8.00' } })
  expect(after.purchases.map((p: { hours_remaining: string }) => p.hours_remaining).sort()).toEqual(['0.00', '8.00'])

  // The operator's table names both packs behind the total.
  await page.goto('/admin/bookings')
  const row = page.getByRole('row').filter({ hasText: email })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row).toContainText('12h do pack')
  await expect(row.getByText('de 2 packs')).toHaveAttribute('title', /5h · .*\n7h · /)

  // The customer's own screens: the booking, and one balance of 8h.
  await page.context().clearCookies()
  await page.goto('/sign-in')
  // A dev server may hydrate the form after the first fill and reset the
  // controlled input; fill once the page is quiet and confirm the value took.
  await page.waitForLoadState('networkidle')
  const emailField = page.getByLabel(/Email/i)
  await emailField.fill(email)
  await expect(emailField).toHaveValue(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 60000 })
  // A fresh customer has exactly this one booking.
  const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: '– 20:00' })
  await expect(card).toHaveCount(1, { timeout: 15000 })
  await expect(card).toContainText('12h do pack')

  await page.goto('/dashboard/packages')
  const bank = page.getByRole('region', { name: /Banco de horas/i })
  await expect(bank).toContainText('8h disponíveis', { timeout: 15000 })
  await expect(bank).toContainText(/8h expiram a \d+ de \w+\./)
  await expect(page.getByText('0h restantes de 5h')).toBeVisible()
  await expect(page.getByText('8h restantes de 15h')).toBeVisible()

  // Leave the stack as found: the operator cancels the booking, which puts
  // 5h and 7h back on their own purchases.
  const cancelled = await api.put(`${API_URL}/admin/bookings/${booking.id}`, {
    headers: admin, params: { org_id: org }, data: { status: 'cancelled' },
  })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  const restored = await (await api.get(`${API_URL}/packages/me`, { headers: customer })).json()
  expect(restored.balance).toMatchObject({ hours_available: '20.00', hours_expiring_next: { hours: '5.00' } })
})
