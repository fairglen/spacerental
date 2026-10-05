import { type Page } from '@playwright/test'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { test, expect, API_URL, at, auth, buyPack, contextAs, createBooking, freshDay, packageByHours } from './fixtures'
import { preferDayView, selectDayView } from './helpers/rooms'

/**
 * C13 — pack hours first, pay only the extra hours.
 *
 * A fresh customer ends up with exactly 7h on a pack, books 8h in the UI, is
 * charged for the one hour the pack cannot cover, and sees the split on the
 * dashboard. Everything runs on the stub gateways (CLAUDE.md §10.3), on a
 * room of the test's own (fixtures.ts).
 */
const AVAILABLE_BG = 'rgb(240, 250, 245)'

async function cell(page: Page, hour: number) {
  const label = `${String(hour).padStart(2, '0')}:00`
  const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
  const row = labels.findIndex((text) => text.trim() === label)
  expect(row, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
  return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(row).locator('.rbc-time-slot').first()
}

/** How many '›' presses take the day view from today to `day`. */
function daysFromToday(day: Date): number {
  const now = new Date()
  return Math.round((day.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000)
}

test.use({ timezoneId: 'UTC', viewport: { width: 1280, height: 1000 } })

test('7h on the pack, 8h booked: 11,00 € at checkout, the split on the dashboard, 0h left', async ({ browser, api, room, customer }) => {
  // ── A customer with exactly 7h left, set up through the API ────────────
  const pack = await packageByHours(api, customer.orgId, 10)
  await buyPack(api, customer, pack.id)

  const spendDay = freshDay(12)
  await createBooking(api, customer, { roomId: room.id, start: at(spendDay, 9), end: at(spendDay, 12), paymentMethod: 'package' })
  const before = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
  expect(Number(before[0].hours_remaining)).toBe(7)

  // ── The customer books 8h in the UI ────────────────────────────────────
  const day = freshDay(4)
  const context = await contextAs(browser, customer)
  await preferDayView(context)
  const page = await context.newPage()
  try {
    await page.goto(`/spaces/${room.space_id}?room=${room.id}`)
    await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 10000 })
    await selectDayView(page)
    for (let i = 0; i < daysFromToday(day); i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
    await expect
      .poll(async () => (await cell(page, 16)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
      .toBe(AVAILABLE_BG)

    const first = await cell(page, 9)
    const last = await cell(page, 16)
    await last.scrollIntoViewIfNeeded()
    await first.scrollIntoViewIfNeeded()
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
    expect(to.y + to.height, '09:00–17:00 must both be on screen to drag').toBeLessThanOrEqual(1000)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 })
    await page.mouse.up()

    // ── The modal says where the hours go and what is left to pay ──────────
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByText('Duração', { exact: true }).locator('..')).toContainText('8h')
    await expect(dialog.getByRole('radio', { name: /Usar as horas do pack e pagar o resto/i })).toBeChecked()
    const breakdown = dialog.getByRole('group', { name: /Resumo do pagamento/i })
    await expect(breakdown).toContainText(/Horas do pack\s*−\s*7h\s*\(ficam 0h\)/)
    await expect(breakdown).toContainText(/1h × 11,00\s€ = 11,00\s€/)

    await dialog.getByRole('button', { name: /Confirmar Reserva/i }).click()
    await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
    const bookingId = new URL(page.url()).pathname.split('/').pop()!
      .replace('cs_stub_', '')
      .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')

    // ── Checkout charges the one hour, and says why ────────────────────────
    await expect(page.getByText('11,00 €')).toBeVisible()
    await expect(page.getByText(`1h ${room.name} (7h pagas com o pack)`)).toBeVisible()
    await expect(page.getByText('88,00 €')).toHaveCount(0)
    // Reserved already, before paying.
    const held = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
    expect(Number(held[0].hours_remaining)).toBe(0)

    await page.getByRole('button', { name: /^Pagar$/ }).click()
    await page.waitForURL(/\/dashboard/, { timeout: 20000 })

    // ── The dashboard shows both halves, and the pack is spent ─────────────
    const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
    const label = `${format(wall(at(day, 9)), 'd MMM yyyy, HH:mm', { locale: pt })} – 17:00`
    const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: label })
    await expect(card).toHaveCount(1, { timeout: 10000 })
    await expect(card).toContainText(/7h do pack \+ 11,00\s€/)
    await expect(card).toContainText('Confirmado')

    const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(customer.token) })).json()).bookings
    const booking = mine.find((b: { id: string }) => b.id === bookingId)
    expect(booking.payment_method).toBe('mixed')
    expect(Number(booking.package_hours_used)).toBe(7)
    expect(Number(booking.total_amount)).toBe(11)
    const after = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
    expect(Number(after[0].hours_remaining)).toBe(0)
  } finally {
    await context.close()
  }
})
