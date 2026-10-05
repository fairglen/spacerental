import { randomUUID } from 'node:crypto'
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { openSpaceRooms, preferDayView, useDayView, waitOutPublicRateWindow } from './helpers/rooms'

/**
 * K01 — cancelling a paid booking puts its hours in the bank, never money.
 *
 * A fresh customer pays 2h on the stub gateway, cancels on the dashboard
 * (the dialog says the 2h stay in the bank), the bank card lists the credit
 * by its cancellation date, and the customer books 2h again with those
 * hours — "Reserva confirmada", no checkout. Stub gateways only (§10.3).
 */
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const API_ORIGIN = new URL(API_URL).origin
const AVAILABLE_BG = 'rgb(240, 250, 245)'
const ROOM = 'Sala Brisa'

type Slot = { start: string; end: string; available: boolean }

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
const isoDate = (d: Date) => d.toISOString().slice(0, 10)

function utcHour(dayOffset: number, hour: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + dayOffset)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour))
}

/** First day from `from` days out on which `hours` contiguous hours from `startHour` are free. */
async function freeDay(api: APIRequestContext, roomId: string, from: number, hours: number, startHour: number): Promise<number> {
  for (let offset = from; offset < from + 10; offset++) {
    const { slots } = (await (await api.get(`${API_URL}/rooms/${roomId}/availability`, {
      params: { date: isoDate(utcHour(offset, 0)) },
    })).json()) as { slots: Slot[] }
    const wanted = Array.from({ length: hours }, (_, i) => utcHour(offset, startHour + i).getTime())
    if (wanted.every((t) => slots.some((s) => s.available && new Date(s.start).getTime() === t))) return offset
  }
  throw new Error(`no day with ${hours} free hours from ${startHour}:00 in the next ${from + 10} days`)
}

async function cell(page: Page, hour: number) {
  const label = `${String(hour).padStart(2, '0')}:00`
  const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
  const row = labels.findIndex((text) => text.trim() === label)
  expect(row, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
  return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(row).locator('.rbc-time-slot').first()
}

let api: APIRequestContext
let token = ''
const created: string[] = []

test.use({ timezoneId: 'UTC', viewport: { width: 1280, height: 1000 } })

test.beforeAll(async () => { api = await playwrightRequest.newContext() })
test.afterAll(async () => {
  for (const id of created) await api.delete(`${API_URL}/bookings/${id}`, { headers: auth(token) })
  await api.dispose()
  await waitOutPublicRateWindow()
})

test('pay 2h → cancel → the bank shows the credit → rebook with it, no checkout', async ({ page }) => {
  // ── A customer who paid for 2h, set up through the API ─────────────────
  const email = `credit-${randomUUID()}@example.com`
  const password = 'credit-1234'
  const registered = await api.post(`${API_URL}/auth/register`, { data: { email, password, name: 'Cliente Crédito' } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  token = (await registered.json()).access_token

  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms.find((r: { name: string }) => r.name === ROOM)
  expect(room, `${ROOM} is not seeded`).toBeTruthy()

  const payDay = await freeDay(api, room.id, 12, 2, 9)
  const booked = await api.post(`${API_URL}/bookings`, {
    headers: auth(token),
    data: { room_id: room.id, start_time: utcHour(payDay, 9).toISOString(), end_time: utcHour(payDay, 11).toISOString(), payment_method: 'hourly' },
  })
  expect(booked.ok(), await booked.text()).toBeTruthy()
  const { booking: paidBooking, checkout_url } = await booked.json()
  const sessionId = new URL(checkout_url).pathname.split('/').pop()
  const paid = await api.post(`${API_ORIGIN}/checkout/stub/${sessionId}/pay`, { maxRedirects: 0 })
  expect(paid.status()).toBe(303)
  const bankBefore = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(bankBefore).toHaveLength(0)

  // ── Cancel on the dashboard: the dialog says where the hours go ────────
  await preferDayView(page)
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })

  const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
  const paidLabel = `${format(wall(utcHour(payDay, 9)), 'd MMM yyyy, HH:mm', { locale: pt })} – 11:00`
  const card = page.locator('div.rounded-xl').filter({ hasText: ROOM }).filter({ hasText: paidLabel })
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
  const bankAfter = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(bankAfter).toHaveLength(1)
  expect(bankAfter[0].source).toBe('cancellation_credit')
  expect(bankAfter[0].source_booking_id).toBe(paidBooking.id)
  expect(Number(bankAfter[0].hours_remaining)).toBe(2)
  expect(bankAfter[0].package).toBeNull()

  // ── Rebook 2h with the credited hours: confirmed, no checkout ──────────
  const offset = await freeDay(api, room.id, 4, 2, 14)
  await openSpaceRooms(page)
  await page.getByTestId('room-card').filter({ hasText: ROOM }).getByRole('button', { name: /Reservar Esta Sala/i }).click()
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${ROOM}` })).toBeVisible({ timeout: 10000 })
  await useDayView(page)
  for (let i = 0; i < offset; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
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

  const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(token) })).json()).bookings
  const rebooked = mine.find((b: { id: string; status: string; payment_method: string }) => b.id !== paidBooking.id && b.status === 'confirmed')
  expect(rebooked, 'the rebooking is confirmed').toBeTruthy()
  created.push(rebooked.id)
  expect(rebooked.payment_method).toBe('package')
  expect(Number(rebooked.package_hours_used)).toBe(2)
  const spent = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(Number(spent[0].hours_remaining)).toBe(0)
})
