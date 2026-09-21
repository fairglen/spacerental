import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * C12: hourly booking on a day or a week view. On a desktop-width browser the
 * calendar opens on the week; dragging two hours there books them through the
 * stub checkout, exactly as the day view always has. There is no month view.
 *
 * Pre-authenticated (see admin.spec.ts for why specs avoid the sign-in form).
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const AVAILABLE_BG = 'rgb(240, 250, 245)'

type Slot = { start: string; end: string; available: boolean }

const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)
/** Monday-based column of a date in the week grid. */
const columnOf = (d: Date) => (d.getUTCDay() + 6) % 7

async function sessionToken(page: Page): Promise<string> {
  const session = await (await page.request.get('/api/auth/session')).json()
  expect(typeof session.accessToken, 'stored admin session has no backend token').toBe('string')
  return session.accessToken
}

/**
 * Two consecutive free hours on a day after today: later THIS week when the
 * week still has a bookable day, otherwise next week (run this on a Saturday
 * and only the closed Sunday is left).
 */
async function pickTwoFreeHours(api: APIRequestContext, roomId: string) {
  const today = new Date()
  const monday = addDays(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())), -columnOf(today))
  for (let offset = columnOf(today) + 1; offset < 14; offset++) {
    const day = addDays(monday, offset)
    const { slots } = (await (await api.get(`${API_URL}/rooms/${roomId}/availability`, { params: { date: isoDate(day) } })).json()) as { slots: Slot[] }
    const index = slots.findIndex((s, i) => {
      const hour = new Date(s.start).getUTCHours()
      return s.available && slots[i + 1]?.available && s.end === slots[i + 1].start && hour >= 9 && hour <= 15
    })
    if (index >= 0) return { day, hour: new Date(slots[index].start).getUTCHours(), weeksAhead: Math.floor(offset / 7) }
  }
  throw new Error('no two consecutive free hours in the next two weeks')
}

async function cell(page: Page, column: number, hour: number) {
  const label = `${String(hour).padStart(2, '0')}:00`
  const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
  const row = labels.findIndex((text) => text.trim() === label)
  expect(row, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
  return page.locator('.rbc-time-content .rbc-day-slot').nth(column).locator('.rbc-timeslot-group').nth(row).locator('.rbc-time-slot').first()
}

let api: APIRequestContext
const created: { id: string; orgId: string }[] = []

test.beforeAll(async () => { api = await playwrightRequest.newContext() })
test.afterAll(async ({ browser }) => {
  // As the operator: a booking for tomorrow is inside the 24h window a member
  // may not cancel in, and a leftover would block the next run's hours.
  if (created.length) {
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE })
    const token = await sessionToken(await context.newPage())
    for (const { id, orgId } of created) {
      await api.put(`${API_URL}/admin/bookings/${id}`, {
        headers: { Authorization: `Bearer ${token}` }, params: { org_id: orgId }, data: { status: 'cancelled' },
      })
    }
    await context.close()
  }
  await api.dispose()
})

test('week view: drag two hours → stub checkout → Confirmado; the toolbar has no "Mês"', async ({ page }) => {
  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms[rooms.length - 1]
  const { day, hour, weeksAhead } = await pickTwoFreeHours(api, room.id)

  await page.goto(`/spaces/${spaces[0].id}?room=${room.id}`)
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 15000 })

  // Two views, and the wide screen opened on the week.
  const toolbar = page.locator('.rbc-toolbar')
  await expect(toolbar.getByRole('button', { name: 'Dia', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: 'Semana', exact: true })).toBeVisible()
  await expect(toolbar.getByRole('button', { name: /M[êe]s|Month/i })).toHaveCount(0)
  await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(7)

  // The contact note is on the page, between the help text and the grid.
  await expect(page.locator('main').getByRole('note')).toBeVisible()

  for (let i = 0; i < weeksAhead; i++) await toolbar.getByRole('button', { name: '›' }).click()
  await expect(page.locator('.rbc-time-header .rbc-header').nth(columnOf(day))).toContainText(String(day.getUTCDate()).padStart(2, '0'))
  await expect
    .poll(async () => (await cell(page, columnOf(day), hour)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
    .toBe(AVAILABLE_BG)

  const first = await cell(page, columnOf(day), hour)
  const last = await cell(page, columnOf(day), hour + 1)
  await last.scrollIntoViewIfNeeded()
  await first.scrollIntoViewIfNeeded()
  // The section scrolls into view smoothly on a deep link; measure once still.
  await expect
    .poll(async () => {
      const a = await first.boundingBox()
      await new Promise((r) => setTimeout(r, 120))
      const b = await first.boundingBox()
      return !!a && !!b && a.y === b.y
    }, { timeout: 10000 })
    .toBe(true)
  const from = (await first.boundingBox())!
  const to = (await last.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
  await expect(dialog.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
  await expect(dialog.getByText('Horário', { exact: true }).locator('..')).toContainText(`${String(hour).padStart(2, '0')}:00 – ${String(hour + 2).padStart(2, '0')}:00`)
  await expect(dialog.getByRole('note').getByRole('link')).toHaveAttribute('href', /^mailto:.+\?subject=/)

  const hourly = dialog.getByRole('radio', { name: /^Pagar /i })
  if (await hourly.count()) await hourly.check()
  await dialog.getByRole('button', { name: /Confirmar Reserva/i }).click()
  await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
  const bookingId = new URL(page.url()).pathname.split('/').pop()!
    .replace('cs_stub_', '')
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  created.push({ id: bookingId, orgId: room.org_id })

  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })

  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour))
  const end = new Date(start.getTime() + 2 * 3_600_000)
  // The page renders in UTC (timezoneId above); Node formats in the machine's zone.
  const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
  const label = `${format(wall(start), 'd MMM yyyy, HH:mm', { locale: pt })} – ${format(wall(end), 'HH:mm')}`
  const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: label })
  await expect(card).toHaveCount(1, { timeout: 10000 })
  await expect(card).toContainText('Confirmado')
})

test('a phone opens on the day view, and keeps the week once asked for it', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    await page.goto(`/spaces/${spaces[0].id}?room=${rooms[0].id}`)
    await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(1, { timeout: 15000 })

    await page.locator('.rbc-toolbar').getByRole('button', { name: 'Semana', exact: true }).click()
    await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(7)
    await page.reload()
    await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(7, { timeout: 15000 })
  } finally {
    await context.close()
  }
})

// The confirm dialog grew a line with the contact note (C12). On a short
// screen — and with the pack choice, a sign-in prompt, an error or the weekly
// options showing — its buttons were pushed below the fold of a dialog that
// could not scroll, so the booking could be neither confirmed nor cancelled.
test('the confirm dialog keeps its buttons reachable on a short screen', async ({ browser }) => {
  const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 390, height: 520 } })
  const page = await context.newPage()
  try {
    const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const room = rooms[rooms.length - 1]
    const { day, hour } = await pickTwoFreeHours(api, room.id)
    const daysAhead = Math.round((day.getTime() - Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) / 86_400_000)

    await page.goto(`/spaces/${spaces[0].id}?room=${room.id}`)
    await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(1, { timeout: 15000 })
    for (let i = 0; i < daysAhead; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
    await expect
      .poll(async () => (await cell(page, 0, hour)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
      .toBe(AVAILABLE_BG)
    const target = await cell(page, 0, hour)
    await target.scrollIntoViewIfNeeded()
    await expect
      .poll(async () => {
        const a = await target.boundingBox()
        await new Promise((r) => setTimeout(r, 120))
        const b = await target.boundingBox()
        return !!a && !!b && a.y === b.y
      }, { timeout: 10000 })
      .toBe(true)
    const box = (await target.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    // The dialog never outgrows the screen…
    const size = (await dialog.boundingBox())!
    expect(size.y).toBeGreaterThanOrEqual(0)
    expect(size.y + size.height).toBeLessThanOrEqual(520)
    // …and everything in it, down to the buttons, can be brought on screen and used.
    const cancel = dialog.getByRole('button', { name: /^Cancelar$/ })
    await cancel.scrollIntoViewIfNeeded()
    await expect(cancel).toBeInViewport({ ratio: 1 })
    await expect(dialog.getByRole('button', { name: /Confirmar Reserva/i })).toBeInViewport({ ratio: 1 })
    await cancel.click()
    await expect(dialog).toHaveCount(0)
  } finally {
    await context.close()
  }
})
