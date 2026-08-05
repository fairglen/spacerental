import { test, expect, request as playwrightRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { createHmac } from 'node:crypto'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'

/**
 * Booking flows people actually perform (TODO.md B1, B2, B4, B5).
 *
 * The whole payment leg runs on STRIPE_MODE=stub: `POST /bookings` returns a
 * deterministic `https://checkout.stripe.stub/cs_stub_<id>` URL, and the
 * `checkout.session.completed` webhook we sign below is what promotes the
 * booking to `confirmed`. No Stripe account, no credentials, no network beyond
 * localhost (CLAUDE.md §10.3).
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const CHECKOUT_ORIGIN = 'https://checkout.stripe.stub'
// Mirrors app/payments.DEFAULT_STUB_WEBHOOK_SECRET — what stub mode signs with
// when STRIPE_WEBHOOK_SECRET is unset, which is the docker-compose default.
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_stub_local_secret'
const CREDENTIALS = { email: 'admin@demo.com', password: 'admin123' }

// The calendar day view starts at 08:00 with one 1-hour slot per group.
const FIRST_HOUR = 8
const AVAILABLE_BG = 'rgb(240, 250, 245)'
const BUSY_BG = 'rgb(243, 244, 246)'

type ApiBooking = {
  id: string
  org_id: string
  start_time: string
  end_time: string
  status: string
  total_amount: string | number
}

// ── Backend helpers ───────────────────────────────────────────────────────

/** Absolute API URL — the request context has no baseURL of its own. */
function apiUrl(path: string): string {
  return `${API_URL}${path}`
}

async function login(api: APIRequestContext): Promise<string> {
  const res = await api.post(apiUrl('/auth/login'), { data: CREDENTIALS })
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy()
  return (await res.json()).access_token
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

async function myBookings(api: APIRequestContext, token: string): Promise<ApiBooking[]> {
  const res = await api.get(apiUrl('/bookings/me'), { headers: auth(token) })
  expect(res.ok()).toBeTruthy()
  return (await res.json()).bookings
}

async function roomIdByName(api: APIRequestContext, name: string): Promise<string> {
  const spaces = await (await api.get(apiUrl('/spaces'))).json()
  const detail = await (await api.get(apiUrl(`/spaces/${spaces.spaces[0].id}`))).json()
  const room = detail.rooms.find((r: { name: string }) => r.name === name)
  expect(room, `room ${name} is not seeded`).toBeTruthy()
  return room.id
}

async function createBookingViaApi(
  api: APIRequestContext,
  token: string,
  roomId: string,
  start: Date,
  end: Date,
): Promise<ApiBooking> {
  const res = await api.post(apiUrl('/bookings'), {
    headers: auth(token),
    data: { room_id: roomId, start_time: start.toISOString(), end_time: end.toISOString() },
  })
  expect(res.ok(), `booking failed: ${res.status()} ${await res.text()}`).toBeTruthy()
  const body = await res.json()
  created.push(body.booking.id)
  return body.booking
}

async function cancelViaApi(api: APIRequestContext, token: string, id: string) {
  await api.delete(apiUrl(`/bookings/${id}`), { headers: auth(token) })
}

/** Complete a stub Checkout Session the way Stripe would: a signed webhook. */
async function payStubCheckout(api: APIRequestContext, sessionId: string, booking: ApiBooking) {
  const payload = JSON.stringify({
    type: 'checkout.session.completed',
    data: {
      object: {
        object: 'checkout.session',
        id: sessionId,
        payment_status: 'paid',
        metadata: { kind: 'booking', reference_id: booking.id, org_id: booking.org_id },
      },
    },
  })
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex')
  const res = await api.post(apiUrl('/webhooks/stripe'), {
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
    data: payload,
  })
  expect(res.ok(), `webhook rejected: ${res.status()} ${await res.text()}`).toBeTruthy()
  expect((await res.json()).handled, 'webhook did not confirm the booking').toBe(true)
}

// ── Date helpers ──────────────────────────────────────────────────────────

/**
 * Days from today to the next bookable date at least `minDaysAhead` out.
 * Seeded availability rules cover Monday–Saturday, and cancelling requires more
 * than 24h notice, so every test books at least three days ahead.
 */
function bookableDayOffset(minDaysAhead: number): number {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + minDaysAhead)
  let offset = minDaysAhead
  while (day.getUTCDay() === 0) {
    day.setUTCDate(day.getUTCDate() + 1)
    offset += 1
  }
  return offset
}

function utcHour(dayOffset: number, hour: number): Date {
  const day = new Date()
  day.setUTCDate(day.getUTCDate() + dayOffset)
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0, 0))
}

// ── UI helpers ────────────────────────────────────────────────────────────

async function signIn(page: Page) {
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(CREDENTIALS.email)
  await page.getByLabel('Password').fill(CREDENTIALS.password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })
}

/** Open the availability calendar of a room by name. */
async function openRoomCalendar(page: Page, roomName: string) {
  await page.goto('/spaces')
  await page.getByRole('button', { name: /Ver Salas e Reservar/i }).first().click()
  await page.waitForURL('**/spaces/**', { timeout: 10000 })

  const bookButtons = page.getByRole('button', { name: /Reservar Esta Sala/i })
  await expect(bookButtons.first()).toBeVisible({ timeout: 15000 })
  const total = await bookButtons.count()
  for (let i = 0; i < total; i++) {
    await bookButtons.nth(i).click()
    const heading = page.getByRole('heading', { name: /^Disponibilidade — / })
    await expect(heading).toBeVisible({ timeout: 10000 })
    if ((await heading.innerText()).includes(roomName)) return
  }
  throw new Error(`Room "${roomName}" not found on the space page`)
}

/** Step the day view forward `offset` days from today. */
async function goToDay(page: Page, offset: number) {
  for (let i = 0; i < offset; i++) {
    await page.getByRole('button', { name: '›' }).click()
  }
  // Slots are only tinted once that day's availability has landed.
  await expect
    .poll(() => backgroundOf(page, 9), { timeout: 15000 })
    .toMatch(new RegExp(`${AVAILABLE_BG}|${BUSY_BG}`.replace(/[()]/g, '\\$&')))
}

function slotAt(page: Page, hour: number) {
  return page
    .locator('.rbc-day-slot .rbc-timeslot-group')
    .nth(hour - FIRST_HOUR)
    .locator('.rbc-time-slot')
    .first()
}

/**
 * The dashboard renders times in the browser's zone (UTC in these tests) while
 * Node formats in the machine's zone — shift before formatting so the label
 * matches what the page shows.
 */
function asUtcWallClock(date: Date): Date {
  return new Date(date.getTime() + date.getTimezoneOffset() * 60_000)
}

/** The date+time line a dashboard booking card renders. */
function dashboardLabel(start: Date, end: Date): string {
  return `${format(asUtcWallClock(start), 'd MMM yyyy, HH:mm', { locale: pt })} \u2013 ${format(asUtcWallClock(end), 'HH:mm')}`
}

/** A dashboard booking card, identified by its room and exact date+time line. */
function bookingCard(page: Page, roomName: string, start: Date, end: Date) {
  return page
    .locator('div.rounded-xl')
    .filter({ hasText: roomName })
    .filter({ hasText: dashboardLabel(start, end) })
}

async function backgroundOf(page: Page, hour: number): Promise<string> {
  return slotAt(page, hour).evaluate((el) => window.getComputedStyle(el).backgroundColor)
}

/**
 * Drag from `fromHour` to `toHour` (exclusive), as a user selecting a block.
 * Mouse coordinates are viewport-relative, so both ends have to be on screen
 * before they are measured.
 */
async function dragHours(page: Page, fromHour: number, toHour: number) {
  await slotAt(page, toHour - 1).scrollIntoViewIfNeeded()
  await slotAt(page, fromHour).scrollIntoViewIfNeeded()
  const from = await slotAt(page, fromHour).boundingBox()
  const to = await slotAt(page, toHour - 1).boundingBox()
  expect(from && to, 'calendar slots are not laid out').toBeTruthy()
  const viewport = page.viewportSize()
  expect(
    Math.max(from!.y + from!.height, to!.y + to!.height) <= (viewport?.height ?? Infinity),
    `hours ${fromHour}–${toHour} are not both on screen`,
  ).toBeTruthy()
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
  await page.mouse.up()
}

/**
 * Confirm the modal, follow the redirect to stub Checkout, and pay it.
 * Returns the booking the checkout belongs to.
 */
async function confirmAndPay(page: Page, api: APIRequestContext, token: string): Promise<ApiBooking> {
  await page.getByRole('button', { name: /Confirmar Reserva/i }).click()
  await page.waitForURL(/checkout\.stripe\.stub\/cs_stub_/, { timeout: 20000 })

  const sessionId = new URL(page.url()).pathname.replace('/', '')
  const bookingId = sessionId
    .replace('cs_stub_', '')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')

  const booking = (await myBookings(api, token)).find((b) => b.id === bookingId)
  expect(booking, `no booking behind checkout session ${sessionId}`).toBeTruthy()
  created.push(booking!.id)
  expect(booking!.status, 'booking should stay pending until the webhook lands').toBe('pending')

  await payStubCheckout(api, sessionId, booking!)
  return booking!
}

// ── Suite ─────────────────────────────────────────────────────────────────

const created: string[] = []
let api: APIRequestContext
let token: string
let page: Page

test.describe.configure({ mode: 'serial' })

test.describe('Reservas — fluxos reais', () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    api = await playwrightRequest.newContext()
    token = await login(api)

    // Leftovers from an interrupted run would occupy the hours these tests
    // book, so clear anything of ours on the days they use.
    const testDays = [bookableDayOffset(3), bookableDayOffset(4)].map((offset) =>
      utcHour(offset, 0).toISOString().slice(0, 10),
    )
    for (const booking of await myBookings(api, token)) {
      if (booking.status !== 'cancelled' && testDays.includes(booking.start_time.slice(0, 10))) {
        await cancelViaApi(api, token, booking.id)
      }
    }

    const context = await browser.newContext({ timezoneId: 'UTC' })
    page = await context.newPage()
    // Stub Checkout has no server to answer; standing in for it keeps the
    // redirect itself under test.
    await page.route(`${CHECKOUT_ORIGIN}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stub Checkout</h1>' }),
    )
    await signIn(page)
  })

  test.afterAll(async () => {
    if (api && token) {
      for (const id of created) await cancelViaApi(api, token, id)
    }
    if (api) await api.dispose()
    if (page) await page.context().close()
  })

  test('browse spaces page', async () => {
    await page.goto('/spaces')
    await expect(page.getByText(/Todos os Espaços/i)).toBeVisible()
  })

  test('a 09:00–12:00 drag books all three hours and reaches confirmed (B1, B4)', async () => {
    const offset = bookableDayOffset(3)
    await openRoomCalendar(page, 'Sala Calma')
    await goToDay(page, offset)

    await dragHours(page, 9, 12)

    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Duração', { exact: true }).locator('..')).toContainText('3h')
    await expect(page.getByText('Total', { exact: true }).locator('..')).toContainText('33,00')

    const booking = await confirmAndPay(page, api, token)
    expect(booking.start_time).toBe(utcHour(offset, 9).toISOString().replace('.000Z', 'Z'))
    expect(booking.end_time).toBe(utcHour(offset, 12).toISOString().replace('.000Z', 'Z'))

    await page.goto('/dashboard')
    const card = bookingCard(page, 'Sala Calma', utcHour(offset, 9), utcHour(offset, 12))
    await expect(card).toHaveCount(1, { timeout: 10000 })
    await expect(card).toContainText('33,00')
    await expect(card).toContainText('Confirmado')
  })

  test('two blocks on one day keep the lunch gap free (B2)', async () => {
    const offset = bookableDayOffset(3)
    await openRoomCalendar(page, 'Sala Brisa')
    await goToDay(page, offset)

    await dragHours(page, 9, 12)
    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    const morning = await confirmAndPay(page, api, token)

    await openRoomCalendar(page, 'Sala Brisa')
    await goToDay(page, offset)
    await dragHours(page, 14, 18)
    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Duração', { exact: true }).locator('..')).toContainText('4h')
    const afternoon = await confirmAndPay(page, api, token)

    // Two distinct bookings, not one merged 09:00–18:00 block.
    expect(morning.id).not.toBe(afternoon.id)
    const mine = await myBookings(api, token)
    const onThatDay = mine.filter(
      (b) => b.start_time.startsWith(utcHour(offset, 0).toISOString().slice(0, 10)) && b.status === 'confirmed',
    )
    expect(onThatDay.filter((b) => [morning.id, afternoon.id].includes(b.id))).toHaveLength(2)
    expect(afternoon.start_time).toBe(utcHour(offset, 14).toISOString().replace('.000Z', 'Z'))
    expect(afternoon.end_time).toBe(utcHour(offset, 18).toISOString().replace('.000Z', 'Z'))

    await page.goto('/dashboard')
    await expect(bookingCard(page, 'Sala Brisa', utcHour(offset, 9), utcHour(offset, 12)))
      .toHaveCount(1, { timeout: 10000 })
    await expect(bookingCard(page, 'Sala Brisa', utcHour(offset, 14), utcHour(offset, 18))).toHaveCount(1)

    // Lunch is untouched and still bookable.
    await openRoomCalendar(page, 'Sala Brisa')
    await goToDay(page, offset)
    expect(await backgroundOf(page, 12)).toBe(AVAILABLE_BG)
    expect(await backgroundOf(page, 13)).toBe(AVAILABLE_BG)
    expect(await backgroundOf(page, 11)).toBe(BUSY_BG)
    expect(await backgroundOf(page, 14)).toBe(BUSY_BG)

    await dragHours(page, 12, 14)
    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
    await page.getByRole('button', { name: /^Cancelar$/ }).click()
  })

  test('booked hours read as Ocupado for another visitor and are not selectable (B5)', async ({ browser }) => {
    const offset = bookableDayOffset(3)
    const roomId = await roomIdByName(api, 'Sala Névoa')
    await createBookingViaApi(api, token, roomId, utcHour(offset, 9), utcHour(offset, 11))

    const visitorContext = await browser.newContext({ timezoneId: 'UTC' })
    const visitor = await visitorContext.newPage()
    try {
      await openRoomCalendar(visitor, 'Sala Névoa')
      await goToDay(visitor, offset)

      await expect(visitor.getByText('Ocupado').first()).toBeVisible()
      expect(await backgroundOf(visitor, 9)).toBe(BUSY_BG)
      expect(await backgroundOf(visitor, 10)).toBe(BUSY_BG)
      expect(await backgroundOf(visitor, 12)).toBe(AVAILABLE_BG)

      const busy = await slotAt(visitor, 9).boundingBox()
      await visitor.mouse.click(busy!.x + busy!.width / 2, busy!.y + busy!.height / 2)
      await expect(visitor.getByRole('heading', { name: /Confirmar Reserva/i })).toBeHidden()

      // Dragging across the taken hours is refused with the hour named.
      await dragHours(visitor, 8, 11)
      await expect(visitor.getByRole('heading', { name: /Confirmar Reserva/i })).toBeHidden()
      // Next's route announcer is also role=alert, hence the filter.
      await expect(
        visitor.getByRole('alert').filter({ hasText: /já está reservada/ }),
      ).toContainText('09:00')
    } finally {
      await visitorContext.close()
    }
  })

  test('cancelling a booking frees its hours on the calendar (B5)', async () => {
    const offset = bookableDayOffset(4)
    const roomId = await roomIdByName(api, 'Sala Névoa')
    await createBookingViaApi(api, token, roomId, utcHour(offset, 15), utcHour(offset, 17))

    await openRoomCalendar(page, 'Sala Névoa')
    await goToDay(page, offset)
    expect(await backgroundOf(page, 15)).toBe(BUSY_BG)
    expect(await backgroundOf(page, 16)).toBe(BUSY_BG)

    await page.goto('/dashboard')
    const card = bookingCard(page, 'Sala Névoa', utcHour(offset, 15), utcHour(offset, 17))
    await expect(card).toHaveCount(1, { timeout: 10000 })
    await card.getByRole('button', { name: /^Cancelar$/ }).click()
    await page.getByRole('button', { name: /Sim, cancelar/i }).click()
    await expect(card).toHaveCount(0, { timeout: 10000 })

    await openRoomCalendar(page, 'Sala Névoa')
    await goToDay(page, offset)
    expect(await backgroundOf(page, 15)).toBe(AVAILABLE_BG)
    expect(await backgroundOf(page, 16)).toBe(AVAILABLE_BG)

    await dragHours(page, 15, 17)
    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
    await page.getByRole('button', { name: /^Cancelar$/ }).click()
  })

  // TODO.md B5 also asks for a weekly recurring series (book a series, cancel
  // one occurrence, the rest survive). Recurrence does not exist yet — it is
  // Epic 1 (stories 1.1–1.4), explicitly out of scope here — so there is
  // nothing to drive from the UI until it ships.
})
