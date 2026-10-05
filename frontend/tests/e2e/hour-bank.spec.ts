import { test, expect, API_URL, at, auth, contextAs, createBooking, freshDay, grantHours, packageByHours } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * H02: the hour bank. A fresh customer is granted two packs (5h lapsing in a
 * month, 15h in a year), books a 12-hour day with "my pack": the API draws
 * 5 + 7 across them and charges nothing; the customer's dashboard shows the
 * booking as pack-paid, their packs page shows one balance of 8h with the
 * soonest slice named, and the operator's bookings table names both packs.
 *
 * Pre-authenticated as the seeded admin for the operator screens (see
 * admin.spec.ts); the customer's own screens open in a signed-in context of
 * their own. The room, the customer and the day are the test's (fixtures.ts).
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

test('two packs form one bank: a 12h day draws on both, the balance shows what is left', async ({ page, browser, api, admin, room, customer }) => {
  const pack = await packageByHours(api, admin.orgId, 10)

  // Two purchases, the small one lapsing first.
  const soon = new Date(); soon.setUTCDate(soon.getUTCDate() + 30)
  const later = new Date(); later.setUTCFullYear(later.getUTCFullYear() + 1)
  for (const [hours, expiresAt] of [['5', soon], ['15', later]] as const) {
    await grantHours(api, admin, { userId: customer.id, packageId: pack.id, hours, reason: `Banco de horas e2e ${hours}h`, expiresAt })
  }
  const before = await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()
  expect(before.balance).toMatchObject({ hours_available: '20.00', hours_expiring_next: { hours: '5.00' } })

  // The whole day, with "my pack": 5 from the first purchase, 7 from the second.
  const day = freshDay(3)
  const { booking, checkout_url } = await createBooking(api, customer, { roomId: room.id, start: at(day, 8), end: at(day, 20), paymentMethod: 'mixed' })
  expect(booking).toMatchObject({ payment_method: 'package', status: 'confirmed', package_hours_used: '12.00' })
  expect(checkout_url).toBeNull()

  const after = await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()
  // The small pack is spent; what lapses next is the 8h left on the big one.
  expect(after.balance).toMatchObject({ hours_available: '8.00', hours_expiring_next: { hours: '8.00' } })
  expect(after.purchases.map((p: { hours_remaining: string }) => p.hours_remaining).sort()).toEqual(['0.00', '8.00'])

  // The operator's view of this customer names both packs behind the total
  // (their own page, so other specs' bookings cannot page it away).
  await page.goto(`/admin/users/${customer.id}`)
  const row = page.getByRole('row').filter({ hasText: room.name }).filter({ hasText: '12h do pack' })
  await expect(row).toBeVisible({ timeout: 15000 })
  await expect(row.getByText('de 2 packs')).toHaveAttribute('title', /5h · .*\n7h · /)
  await expect(page.getByTestId('user-hour-bank')).toContainText('8h disponíveis')

  // The customer's own screens: the booking, and one balance of 8h.
  const theirs = await contextAs(browser, customer)
  const own = await theirs.newPage()
  try {
    await own.goto('/dashboard')
    // A fresh customer has exactly this one booking.
    const card = own.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: '– 20:00' })
    await expect(card).toHaveCount(1, { timeout: 15000 })
    await expect(card).toContainText('12h do pack')

    await own.goto('/dashboard/packages')
    const bank = own.getByRole('region', { name: /Banco de horas/i })
    await expect(bank).toContainText('8h disponíveis', { timeout: 15000 })
    await expect(bank).toContainText(/8h expiram a \d+ de \w+\./)
    await expect(own.getByText('0h restantes de 5h')).toBeVisible()
    await expect(own.getByText('8h restantes de 15h')).toBeVisible()
  } finally {
    await theirs.close()
  }

  // The operator cancels the booking, which puts 5h and 7h back on their own
  // purchases.
  const cancelled = await api.put(`${API_URL}/admin/bookings/${booking.id}`, {
    headers: auth(admin.token), params: { org_id: admin.orgId }, data: { status: 'cancelled' },
  })
  expect(cancelled.ok(), await cancelled.text()).toBeTruthy()
  const restored = await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()
  expect(restored.balance).toMatchObject({ hours_available: '20.00', hours_expiring_next: { hours: '5.00' } })
})
