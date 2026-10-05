import { type Page } from '@playwright/test'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { test, expect, API_URL, at, auth, contextAs, createBooking, freshDay } from './fixtures'
import { preferDayView, selectDayView } from './helpers/rooms'

/**
 * K01 — cancelling a paid booking puts its hours in the bank, never money.
 *
 * A fresh customer pays 2h on the stub gateway, cancels on the dashboard
 * (the dialog says the 2h stay in the bank), the bank card lists the credit
 * by its cancellation date, and the customer books 2h again with those
 * hours — "Reserva confirmada", no checkout. Stub gateways only (§10.3).
 * The room and the customer are the test's own (fixtures.ts).
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

test('pay 2h → cancel → the bank shows the credit → rebook with it, no checkout', async ({ browser, api, room, customer }) => {
  // ── A customer who paid for 2h, set up through the API ─────────────────
  const payDay = freshDay(12)
  const { booking: paidBooking } = await createBooking(api, customer, { roomId: room.id, start: at(payDay, 9), end: at(payDay, 11), pay: true })
  const bankBefore = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
  expect(bankBefore).toHaveLength(0)

  // ── Cancel on the dashboard: the dialog says where the hours go ────────
  const context = await contextAs(browser, customer)
  await preferDayView(context)
  const page = await context.newPage()
  try {
    await page.goto('/dashboard')

    const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
    const paidLabel = `${format(wall(at(payDay, 9)), 'd MMM yyyy, HH:mm', { locale: pt })} – 11:00`
    const card = page.locator('div.rounded-xl').filter({ hasText: room.name }).filter({ hasText: paidLabel })
    await expect(card).toHaveCount(1, { timeout: 10000 })
    await expect(card).toContainText('Confirmado')
    await card.getByRole('button', { name: /^Cancelar$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Cancelar reserva' })).toBeVisible()
    await expect(dialog).toContainText('Ao cancelar, as 2h pagas ficam no seu banco de horas')
    await expect(dialog).toContainText(/válidas até \d{1,2} \w{3} \d{4}/)
    await dialog.getByRole('button', { name: /Sim, cancelar/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10000 })

    // ── The bank card lists the credit by its origin, with the expiry ──────
    const bank = page.getByRole('region', { name: /Os seus packs/i })
    const today = format(wall(new Date()), 'd MMM', { locale: pt })
    await expect(bank).toContainText(`Crédito — cancelamento de ${today}`, { timeout: 10000 })
    await expect(bank).toContainText('2h')
    const bankAfter = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
    expect(bankAfter).toHaveLength(1)
    expect(bankAfter[0].source).toBe('cancellation_credit')
    expect(bankAfter[0].source_booking_id).toBe(paidBooking.id)
    expect(Number(bankAfter[0].hours_remaining)).toBe(2)
    expect(bankAfter[0].package).toBeNull()

    // ── Rebook 2h with the credited hours: confirmed, no checkout ──────────
    const rebookDay = freshDay(4)
    await page.goto(`/spaces/${room.space_id}?room=${room.id}`)
    await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 10000 })
    await selectDayView(page)
    for (let i = 0; i < daysFromToday(rebookDay); i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
    await expect
      .poll(async () => (await cell(page, 15)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
      .toBe(AVAILABLE_BG)

    const first = await cell(page, 14)
    const last = await cell(page, 15)
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
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 16 })
    await page.mouse.up()

    const modal = page.getByRole('dialog')
    await expect(modal.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(modal.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
    await expect(modal.getByRole('radio', { name: /Usar horas do pack \(2h disponíveis\)/i })).toBeChecked()
    await modal.getByRole('button', { name: /Confirmar Reserva/i }).click()
    await expect(modal.getByRole('heading', { name: 'Reserva confirmada' })).toBeVisible({ timeout: 15000 })
    await expect(modal).toContainText('Não há nada a pagar agora')
    expect(page.url()).not.toMatch(/checkout/)

    const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(customer.token) })).json()).bookings
    const rebooked = mine.find((b: { id: string; status: string; payment_method: string }) => b.id !== paidBooking.id && b.status === 'confirmed')
    expect(rebooked, 'the rebooking is confirmed').toBeTruthy()
    expect(rebooked.payment_method).toBe('package')
    expect(Number(rebooked.package_hours_used)).toBe(2)
    const spent = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
    expect(Number(spent[0].hours_remaining)).toBe(0)
  } finally {
    await context.close()
  }
})
