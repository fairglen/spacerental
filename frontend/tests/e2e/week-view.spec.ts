import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { type Page } from '@playwright/test'
import { test, expect, freshDay, seededRoom } from './fixtures'
import { ADMIN_STORAGE_STATE } from './global-setup'

/**
 * C12: hourly booking on a day or a week view. On a desktop-width browser the
 * calendar opens on the week; dragging two hours there books them through the
 * stub checkout, exactly as the day view always has. There is no month view.
 *
 * Pre-authenticated as the seeded admin; the booking tests use a room of
 * their own (Q41), so the two hours are free by construction and nothing
 * else's reservation is in the way.
 */
test.use({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 1280, height: 900 } })

const AVAILABLE_BG = 'rgb(240, 250, 245)'
const HOUR = 10

/** Monday-based column of a date in the week grid. */
const columnOf = (d: Date) => (d.getUTCDay() + 6) % 7
const todayUtc = () => { const t = new Date(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())) }
/** Whole days from today (UTC midnight) to `day`. */
const daysAheadOf = (day: Date) => Math.round((day.getTime() - todayUtc().getTime()) / 86_400_000)

async function cell(page: Page, column: number, hour: number) {
  const label = `${String(hour).padStart(2, '0')}:00`
  const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
  const row = labels.findIndex((text) => text.trim() === label)
  expect(row, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
  return page.locator('.rbc-time-content .rbc-day-slot').nth(column).locator('.rbc-timeslot-group').nth(row).locator('.rbc-time-slot').first()
}

test('week view: drag two hours → stub checkout → Confirmado; the toolbar has no "Mês"', async ({ page, admin, room }) => {
  // Tomorrow or soon after: the day the week grid is asked to show.
  const day = freshDay(1)
  const weeksAhead = Math.floor((columnOf(todayUtc()) + daysAheadOf(day)) / 7)

  await page.goto(`/spaces/${admin.spaceId}?room=${room.id}`)
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
    .poll(async () => (await cell(page, columnOf(day), HOUR)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
    .toBe(AVAILABLE_BG)

  const first = await cell(page, columnOf(day), HOUR)
  const last = await cell(page, columnOf(day), HOUR + 1)
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
  await expect(dialog.getByText('Horário', { exact: true }).locator('..')).toContainText(`${String(HOUR).padStart(2, '0')}:00 – ${String(HOUR + 2).padStart(2, '0')}:00`)
  // The note's "Fale connosco" opens the help dialog since C18; the address stays visible.
  await expect(dialog.getByRole('note').getByRole('button', { name: /Fale connosco/ })).toBeVisible()
  await expect(dialog.getByRole('note')).toContainText('geral@flowspace.pt')

  const hourly = dialog.getByRole('radio', { name: /^Pagar /i })
  if (await hourly.count()) await hourly.check()
  await dialog.getByRole('button', { name: /Confirmar Reserva/i }).click()
  await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })

  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })

  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), HOUR))
  const end = new Date(start.getTime() + 2 * 3_600_000)
  // The page renders in UTC (timezoneId above); Node formats in the machine's zone.
  const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
  const label = `${format(wall(start), 'd MMM yyyy, HH:mm', { locale: pt })} – ${format(wall(end), 'HH:mm')}`
  const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: label })
  await expect(card).toHaveCount(1, { timeout: 10000 })
  await expect(card).toContainText('Confirmado')
  // The booking — for tomorrow, inside the 24h a member may not cancel in —
  // leaves with the `room` fixture, as the operator.
})

test('a phone opens on the day view, and keeps the week once asked for it', async ({ browser, api, admin }) => {
  const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  try {
    // Read-only: a seeded room by name.
    const room = await seededRoom(api, admin.spaceId, 'Sala Calma')
    await page.goto(`/spaces/${admin.spaceId}?room=${room.id}`)
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
test('the confirm dialog keeps its buttons reachable on a short screen', async ({ browser, admin, room }) => {
  const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE, timezoneId: 'UTC', viewport: { width: 390, height: 520 } })
  const page = await context.newPage()
  try {
    const day = freshDay(1)
    const daysAhead = daysAheadOf(day)

    await page.goto(`/spaces/${admin.spaceId}?room=${room.id}`)
    await expect(page.locator('.rbc-time-content .rbc-day-slot')).toHaveCount(1, { timeout: 15000 })
    for (let i = 0; i < daysAhead; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
    await expect
      .poll(async () => (await cell(page, 0, HOUR)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
      .toBe(AVAILABLE_BG)
    const target = await cell(page, 0, HOUR)
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
