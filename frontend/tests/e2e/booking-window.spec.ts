import { addDays, format, startOfWeek } from 'date-fns'
import { pt } from 'date-fns/locale'
import { test, expect, API_URL, adminBooking, adminCancel, auth } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * H01: a customer books at most 30 days ahead; an operator has no horizon.
 *
 * The calendar (week view, so the walk to the window costs five reads of
 * seven days rather than thirty of one) stops at the week that holds the
 * window's last day: › goes disabled and the hint names that date. The API
 * is the authority: the same session is refused one day past the window as a
 * customer and accepted there as the operator.
 *
 * Pre-authenticated as the seeded admin, who is also an ordinary member of
 * the org; the room is this test's own (Q41).
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

const WINDOW_DAYS = 30

test('the calendar stops at the booking window and the API enforces it for customers only', async ({ page, api, admin, room }) => {
  await page.goto(`/spaces/${admin.spaceId}?room=${room.id}`)
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 15000 })
  const toolbar = page.locator('.rbc-toolbar')
  await expect(toolbar).toBeVisible({ timeout: 15000 })
  const week = toolbar.getByRole('button', { name: 'Semana', exact: true })
  if (!(await week.getAttribute('class'))?.includes('rbc-active')) await week.click()

  // The browser runs in UTC; build the date the way it will, not in Node's zone.
  const now = new Date()
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + WINDOW_DAYS, now.getUTCHours()))
  const monthName = format(new Date(2026, lastDay.getUTCMonth(), 1), 'MMMM', { locale: pt })
  await expect(page.getByTestId('booking-window-hint')).toHaveText(
    `Reservas abertas até ${lastDay.getUTCDate()} de ${monthName}.`,
  )

  // Walk forward a week at a time. › must stay usable up to the week that
  // holds the last open day, and be disabled on it — never one week early.
  const next = toolbar.getByRole('button', { name: '›' })
  const mondayOf = (d: Date) => startOfWeek(d, { weekStartsOn: 1 })
  const lastWeekStart = mondayOf(lastDay)
  let visibleWeek = mondayOf(now)
  while (visibleWeek < lastWeekStart) {
    await expect(next).toBeEnabled()
    await next.click()
    visibleWeek = addDays(visibleWeek, 7)
  }
  await expect(next).toBeDisabled()
  // The label names the week's Monday: the week that holds the last open day.
  await expect(page.locator('.rbc-toolbar-label')).toContainText(new RegExp(`^${lastWeekStart.getDate()} de`))

  // One day past the window, 11:00 UTC (the room is open every day).
  const beyond = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() + 1, 11))
  const end = new Date(beyond.getTime() + 3.6e6)
  const refused = await api.post(`${API_URL}/bookings`, {
    headers: auth(admin.token),
    data: { room_id: room.id, start_time: beyond.toISOString(), end_time: end.toISOString(), payment_method: 'hourly' },
  })
  expect(refused.status()).toBe(400)
  expect((await refused.json()).detail).toBe('start_time is beyond the booking window')

  const booking = await adminBooking(api, admin, { userId: admin.userId, roomId: room.id, start: beyond, end })
  await adminCancel(api, admin, booking.id)
})
