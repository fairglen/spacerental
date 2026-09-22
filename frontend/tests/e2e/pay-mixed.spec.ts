import { randomUUID } from 'node:crypto'
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { openSpaceRooms, preferDayView, useDayView } from './helpers/rooms'

/**
 * C13 — pack hours first, pay only the extra hours.
 *
 * A fresh customer ends up with exactly 7h on a pack, books 8h in the UI, is
 * charged for the one hour the pack cannot cover, and sees the split on the
 * dashboard. Everything runs on the stub gateways (CLAUDE.md §10.3).
 *
 * Named to run after packages.spec.ts and before single-space.spec.ts, which
 * buys the next public rate window (TODO.md B18).
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

/** First day from `from` days out on which `hours` contiguous hours from 09:00 are free. */
async function freeDay(api: APIRequestContext, roomId: string, from: number, hours: number): Promise<number> {
  for (let offset = from; offset < from + 10; offset++) {
    const { slots } = (await (await api.get(`${API_URL}/rooms/${roomId}/availability`, {
      params: { date: isoDate(utcHour(offset, 0)) },
    })).json()) as { slots: Slot[] }
    const wanted = Array.from({ length: hours }, (_, i) => utcHour(offset, 9 + i).getTime())
    if (wanted.every((t) => slots.some((s) => s.available && new Date(s.start).getTime() === t))) return offset
  }
  throw new Error(`no day with ${hours} free hours from 09:00 in the next ${from + 10} days`)
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
  // More than 24h out, so the customer may cancel; that also returns the hours.
  for (const id of created) await api.delete(`${API_URL}/bookings/${id}`, { headers: auth(token) })
  await api.dispose()
})

test('7h on the pack, 8h booked: 11,00 € at checkout, the split on the dashboard, 0h left', async ({ page }) => {
  // ── A customer with exactly 7h left, set up through the API ────────────
  const email = `mixed-${randomUUID()}@example.com`
  const password = 'mixed-pay-1234'
  const registered = await api.post(`${API_URL}/auth/register`, { data: { email, password, name: 'Cliente Misto' } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  token = (await registered.json()).access_token

  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const room = rooms.find((r: { name: string }) => r.name === ROOM)
  expect(room, `${ROOM} is not seeded`).toBeTruthy()
  const { packages } = await (await api.get(`${API_URL}/packages`, { params: { org_id: room.org_id } })).json()
  const pack = packages.find((p: { hours: number }) => p.hours === 10)

  const purchase = await api.post(`${API_URL}/packages/${pack.id}/purchase`, { headers: auth(token), data: { org_id: room.org_id } })
  expect(purchase.ok(), await purchase.text()).toBeTruthy()
  const sessionId = new URL((await purchase.json()).checkout_url).pathname.split('/').pop()
  const paid = await api.post(`${API_ORIGIN}/checkout/stub/${sessionId}/pay`, { maxRedirects: 0 })
  expect(paid.status()).toBe(303)

  const spendDay = await freeDay(api, room.id, 12, 3)
  const spent = await api.post(`${API_URL}/bookings`, {
    headers: auth(token),
    data: { room_id: room.id, start_time: utcHour(spendDay, 9).toISOString(), end_time: utcHour(spendDay, 12).toISOString(), payment_method: 'package' },
  })
  expect(spent.ok(), await spent.text()).toBeTruthy()
  created.push((await spent.json()).booking.id)
  const before = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(Number(before[0].hours_remaining)).toBe(7)

  // ── The customer books 8h in the UI ────────────────────────────────────
  const offset = await freeDay(api, room.id, 4, 8)
  await preferDayView(page)
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })

  await openSpaceRooms(page)
  await page.getByTestId('room-card').filter({ hasText: ROOM }).getByRole('button', { name: /Reservar Esta Sala/i }).click()
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${ROOM}` })).toBeVisible({ timeout: 10000 })
  await useDayView(page)
  for (let i = 0; i < offset; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
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
  created.push(bookingId)

  // ── Checkout charges the one hour, and says why ────────────────────────
  await expect(page.getByText('11,00 €')).toBeVisible()
  await expect(page.getByText(`1h ${ROOM} (7h pagas com o pack)`)).toBeVisible()
  await expect(page.getByText('88,00 €')).toHaveCount(0)
  // Reserved already, before paying.
  const held = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(Number(held[0].hours_remaining)).toBe(0)

  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/dashboard/, { timeout: 20000 })

  // ── The dashboard shows both halves, and the pack is spent ─────────────
  const start = utcHour(offset, 9)
  const wall = (d: Date) => new Date(d.getTime() + d.getTimezoneOffset() * 60_000)
  const label = `${format(wall(start), 'd MMM yyyy, HH:mm', { locale: pt })} – 17:00`
  const card = page.locator('div.rounded-xl').filter({ hasText: ROOM }).filter({ hasText: label })
  await expect(card).toHaveCount(1, { timeout: 10000 })
  await expect(card).toContainText(/7h do pack \+ 11,00\s€/)
  await expect(card).toContainText('Confirmado')

  const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(token) })).json()).bookings
  const booking = mine.find((b: { id: string }) => b.id === bookingId)
  expect(booking.payment_method).toBe('mixed')
  expect(Number(booking.package_hours_used)).toBe(7)
  expect(Number(booking.total_amount)).toBe(11)
  const after = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(token) })).json()).purchases
  expect(Number(after[0].hours_remaining)).toBe(0)
})
