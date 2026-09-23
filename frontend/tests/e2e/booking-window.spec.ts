import { test, expect, type Page } from '@playwright/test'
import { addDays, format, startOfWeek } from 'date-fns'
import { pt } from 'date-fns/locale'
import { ADMIN_STORAGE_STATE } from './global-setup'
import { openSpaceRooms, waitOutPublicRateWindow } from './helpers/rooms'

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
 * the org (see admin.spec.ts for why specs avoid the sign-in form).
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const WINDOW_DAYS = 30

async function sessionToken(page: Page): Promise<string> {
  const session = await (await page.request.get('/api/auth/session')).json()
  expect(typeof session.accessToken, 'stored admin session has no backend token').toBe('string')
  return session.accessToken
}

// Six weeks of availability is most of the public budget (B18): start on a
// fresh window and leave one behind for help.spec.ts, which runs next.
test.beforeAll(async () => {
  await waitOutPublicRateWindow()
})
test.afterAll(async () => {
  await waitOutPublicRateWindow()
})

test('the calendar stops at the booking window and the API enforces it for customers only', async ({ page }) => {
  test.setTimeout(120_000)
  const token = await sessionToken(page)
  const auth = { Authorization: `Bearer ${token}` }
  const api = page.request
  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms[0]

  await openSpaceRooms(page)
  await page.getByRole('button', { name: /Reservar Esta Sala/i }).first().click()
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

  // One day past the window, 11:00 UTC, moved off a Sunday (the seed closes it).
  const beyond = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() + 1, 11))
  while (beyond.getUTCDay() === 0) beyond.setUTCDate(beyond.getUTCDate() + 1)
  const slot = { room_id: room.id, start_time: beyond.toISOString(), end_time: new Date(beyond.getTime() + 3.6e6).toISOString() }

  const refused = await api.post(`${API_URL}/bookings`, { headers: auth, data: { ...slot, payment_method: 'hourly' } })
  expect(refused.status()).toBe(400)
  expect((await refused.json()).detail).toBe('start_time is beyond the booking window')

  const me = await (await api.get(`${API_URL}/auth/me`, { headers: auth })).json()
  const made = await api.post(`${API_URL}/admin/bookings`, {
    headers: auth, params: { org_id: room.org_id }, data: { user_id: me.id, ...slot },
  })
  expect(made.status(), await made.text()).toBe(201)
  const booking = (await made.json()).booking
  // Leave the seeded stack as it was found.
  const gone = await api.put(`${API_URL}/admin/bookings/${booking.id}`, {
    headers: auth, params: { org_id: room.org_id }, data: { status: 'cancelled' },
  })
  expect(gone.ok(), await gone.text()).toBeTruthy()
})
