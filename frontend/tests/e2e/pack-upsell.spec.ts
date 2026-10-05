import type { Browser, BrowserContextOptions } from '@playwright/test'
import { type Page } from '@playwright/test'
import { test, expect, API_URL, at, auth, contextAs, createBooking, createCustomer, freshDay, type Customer, type Room } from './fixtures'
import { preferDayView, selectDayView } from './helpers/rooms'

/**
 * K02 — when the bank cannot cover the booking, the modal offers a pack.
 *
 * A fresh customer with an empty bank picks 2h, chooses "Comprar um pack",
 * pays on the stub checkout and lands back on the same slot with the modal
 * open and the pack preselected; confirming needs no second checkout. A
 * second run has the slot taken by someone else during the detour: the page
 * says so and opens no modal. Stub gateways only (§10.3); the room and the
 * customers are the test's own (fixtures.ts).
 */
const AVAILABLE_BG = 'rgb(240, 250, 245)'

async function cell(page: Page, hour: number) {
  const label = `${String(hour).padStart(2, '0')}:00`
  const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
  const row = labels.findIndex((text) => text.trim() === label)
  expect(row, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
  return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(row).locator('.rbc-time-slot').first()
}

async function dragRange(page: Page, fromHour: number, toHour: number) {
  await expect
    .poll(async () => (await cell(page, toHour)).evaluate((el) => window.getComputedStyle(el).backgroundColor), { timeout: 15000 })
    .toBe(AVAILABLE_BG)
  const first = await cell(page, fromHour)
  const last = await cell(page, toHour)
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
}

/** How many '›' presses take the day view from today to `day`. */
function daysFromToday(day: Date): number {
  const now = new Date()
  return Math.round((day.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000)
}

test.use({ timezoneId: 'UTC', viewport: { width: 1280, height: 1000 } })

/** A signed-in page for `customer`, on the day view; the caller closes the context. */
async function signedIn(browser: Browser, contextOptions: BrowserContextOptions, customer: Customer) {
  const context = await contextAs(browser, customer, contextOptions)
  await preferDayView(context)
  const page = await context.newPage()
  return { context, page }
}

async function openSlot(page: Page, room: Room, day: Date, fromHour: number, toHour: number) {
  await page.goto(`/spaces/${room.space_id}?room=${room.id}`)
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 10000 })
  await selectDayView(page)
  for (let i = 0; i < daysFromToday(day); i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
  await dragRange(page, fromHour, toHour)
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
  return modal
}

test('empty bank: "Comprar um pack" first → stub checkout → back on the slot with the pack preselected → confirmed, no second checkout', async ({ browser, contextOptions, api, room, customer }) => {
  const day = freshDay(5)
  const { context, page } = await signedIn(browser, contextOptions, customer)
  try {
    const modal = await openSlot(page, room, day, 9, 10)
    // Never bought a pack: the pack comes first, the hourly price second, hourly preselected.
    const radios = modal.getByRole('radio')
    await expect(radios).toHaveCount(2)
    await expect(radios.nth(0)).toHaveAccessibleName('Comprar um pack')
    await expect(radios.nth(1)).toHaveAccessibleName(/Pagar .* agora/)
    await expect(radios.nth(1)).toBeChecked()

    await radios.nth(0).check()
    const list = modal.getByTestId('buy-pack')
    await expect(list).toContainText('válido')
    await expect(list).toContainText('O horário não fica reservado')
    await expect(modal.getByRole('button', { name: /Confirmar Reserva/i })).toBeDisabled()
    await list.getByRole('button', { name: 'Comprar' }).first().click()
    await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })
    // Nothing was booked for the detour.
    const during = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(customer.token) })).json()).bookings
    expect(during).toHaveLength(0)

    await page.getByRole('button', { name: /^Pagar$/ }).click()
    // Back on the booking page, with the slot in the query, then stripped.
    await page.waitForURL(/\/spaces.*room=/, { timeout: 20000 })
    // The modal reopens on its own once the day's availability lands, and an
    // open dialog marks the rest of the page aria-hidden — so the notice is
    // looked up including hidden nodes, whichever of the two renders first.
    await expect(page.getByRole('status', { includeHidden: true }).filter({ hasText: /Pagamento/ })).toContainText('Pagamento concluído', { timeout: 15000 })
    const reopened = page.getByRole('dialog')
    await expect(reopened.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 20000 })
    await expect(page).not.toHaveURL(/pagamento=/)
    await expect(reopened.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
    await expect(reopened.getByRole('radio', { name: /Usar horas do pack/ })).toBeChecked()
    await expect(reopened.getByRole('radio', { name: 'Comprar um pack' })).toHaveCount(0)

    await reopened.getByRole('button', { name: /Confirmar Reserva/i }).click()
    await expect(reopened.getByRole('heading', { name: 'Reserva confirmada' })).toBeVisible({ timeout: 15000 })
    expect(page.url()).not.toMatch(/checkout/)
    const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(customer.token) })).json()).bookings
    expect(mine).toHaveLength(1)
    expect(mine[0].status).toBe('confirmed')
    expect(mine[0].payment_method).toBe('package')
    expect(new Date(mine[0].start_time).getTime()).toBe(at(day, 9).getTime())
  } finally {
    await context.close()
  }
})

test('taken meanwhile: back from Checkout the page says the hour is reserved and opens no modal', async ({ browser, contextOptions, api, room, customer }) => {
  const rival = await createCustomer(api, { tag: 'rapido', name: 'Cliente Rápido' })
  const day = freshDay(5)
  const { context, page } = await signedIn(browser, contextOptions, customer)
  try {
    const modal = await openSlot(page, room, day, 14, 15)
    await modal.getByRole('radio', { name: 'Comprar um pack' }).check()
    await modal.getByTestId('buy-pack').getByRole('button', { name: 'Comprar' }).first().click()
    await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })

    // Someone else books the slot while the customer is paying.
    await createBooking(api, rival, { roomId: room.id, start: at(day, 14), end: at(day, 16) })

    await page.getByRole('button', { name: /^Pagar$/ }).click()
    await page.waitForURL(/\/spaces.*room=/, { timeout: 20000 })
    await expect(page.getByRole('status').filter({ hasText: /Pagamento/ })).toContainText('Pagamento concluído', { timeout: 15000 })
    // Next's route announcer is a second `alert`; the calendar's notice names the hour.
    await expect(page.getByRole('alert').filter({ hasText: /reservada/ })).toContainText(/já está reservada/, { timeout: 20000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The pack is in the bank all the same.
    const bank = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(customer.token) })).json()).purchases
    expect(bank).toHaveLength(1)
    expect(bank[0].status).toBe('active')
  } finally {
    await context.close()
  }
})
