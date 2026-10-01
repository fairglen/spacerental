import { randomUUID } from 'node:crypto'
import { test, expect, request as playwrightRequest, type APIRequestContext, type Page } from '@playwright/test'
import { openSpaceRooms, preferDayView, useDayView, waitOutPublicRateWindow } from './helpers/rooms'

/**
 * K02 — when the bank cannot cover the booking, the modal offers a pack.
 *
 * A fresh customer with an empty bank picks 2h, chooses "Comprar um pack",
 * pays on the stub checkout and lands back on the same slot with the modal
 * open and the pack preselected; confirming needs no second checkout. A
 * second run has the slot taken by someone else during the detour: the page
 * says so and opens no modal. Stub gateways only (§10.3).
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

let api: APIRequestContext
const sessions: { token: string; bookings: string[] }[] = []

test.use({ timezoneId: 'UTC', viewport: { width: 1280, height: 1000 } })

test.beforeAll(async () => { api = await playwrightRequest.newContext() })
test.afterAll(async () => {
  for (const s of sessions) for (const id of s.bookings) await api.delete(`${API_URL}/bookings/${id}`, { headers: auth(s.token) })
  await api.dispose()
  await waitOutPublicRateWindow()
})

async function freshCustomer(name: string) {
  const email = `upsell-${randomUUID()}@example.com`
  const password = 'upsell-1234'
  const registered = await api.post(`${API_URL}/auth/register`, { data: { email, password, name } })
  expect(registered.ok(), await registered.text()).toBeTruthy()
  const token = (await registered.json()).access_token as string
  const session = { token, bookings: [] as string[] }
  sessions.push(session)
  return { email, password, session }
}

async function room() {
  const { spaces } = await (await api.get(`${API_URL}/spaces`)).json()
  const { rooms } = await (await api.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
  const found = rooms.find((r: { name: string }) => r.name === ROOM)
  expect(found, `${ROOM} is not seeded`).toBeTruthy()
  return found as { id: string; org_id: string }
}

async function signIn(page: Page, email: string, password: string) {
  await preferDayView(page)
  await page.goto('/sign-in')
  await page.getByLabel(/Email/i).fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Entrar/i }).click()
  await page.waitForURL('**/dashboard', { timeout: 30000 })
}

async function openSlot(page: Page, offset: number, fromHour: number, toHour: number) {
  await openSpaceRooms(page)
  await page.getByTestId('room-card').filter({ hasText: ROOM }).getByRole('button', { name: /Reservar Esta Sala/i }).click()
  await expect(page.getByRole('heading', { name: `Disponibilidade — ${ROOM}` })).toBeVisible({ timeout: 10000 })
  await useDayView(page)
  for (let i = 0; i < offset; i++) await page.locator('.rbc-toolbar').getByRole('button', { name: '›' }).click()
  await dragRange(page, fromHour, toHour)
  const modal = page.getByRole('dialog')
  await expect(modal.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
  return modal
}

test('empty bank: "Comprar um pack" first → stub checkout → back on the slot with the pack preselected → confirmed, no second checkout', async ({ page }) => {
  const { email, password, session } = await freshCustomer('Cliente Sem Pack')
  const brisa = await room()
  const offset = await freeDay(api, brisa.id, 5, 2, 9)
  await signIn(page, email, password)

  const modal = await openSlot(page, offset, 9, 10)
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
  const during = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(session.token) })).json()).bookings
  expect(during).toHaveLength(0)

  await page.getByRole('button', { name: /^Pagar$/ }).click()
  // Back on the booking page, with the slot in the query, then stripped.
  await page.waitForURL(/\/spaces.*room=/, { timeout: 20000 })
  await expect(page.getByRole('status').filter({ hasText: /Pagamento/ })).toContainText('Pagamento concluído', { timeout: 15000 })
  const reopened = page.getByRole('dialog')
  await expect(reopened.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 20000 })
  await expect(page).not.toHaveURL(/pagamento=/)
  await expect(reopened.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
  await expect(reopened.getByRole('radio', { name: /Usar horas do pack/ })).toBeChecked()
  await expect(reopened.getByRole('radio', { name: 'Comprar um pack' })).toHaveCount(0)

  await reopened.getByRole('button', { name: /Confirmar Reserva/i }).click()
  await expect(reopened.getByRole('heading', { name: 'Reserva confirmada' })).toBeVisible({ timeout: 15000 })
  expect(page.url()).not.toMatch(/checkout/)
  const mine = (await (await api.get(`${API_URL}/bookings/me`, { headers: auth(session.token) })).json()).bookings
  expect(mine).toHaveLength(1)
  session.bookings.push(mine[0].id)
  expect(mine[0].status).toBe('confirmed')
  expect(mine[0].payment_method).toBe('package')
})

test('taken meanwhile: back from Checkout the page says the hour is reserved and opens no modal', async ({ page }) => {
  const { email, password, session } = await freshCustomer('Cliente Atrasado')
  const rival = await freshCustomer('Cliente Rápido')
  const brisa = await room()
  const offset = await freeDay(api, brisa.id, 5, 2, 14)
  await signIn(page, email, password)

  const modal = await openSlot(page, offset, 14, 15)
  await modal.getByRole('radio', { name: 'Comprar um pack' }).check()
  await modal.getByTestId('buy-pack').getByRole('button', { name: 'Comprar' }).first().click()
  await page.waitForURL(/\/checkout\/stub\/cs_stub_/, { timeout: 20000 })

  // Someone else books the slot while the customer is paying.
  const taken = await api.post(`${API_URL}/bookings`, {
    headers: auth(rival.session.token),
    data: { room_id: brisa.id, start_time: utcHour(offset, 14).toISOString(), end_time: utcHour(offset, 16).toISOString(), payment_method: 'hourly' },
  })
  expect(taken.ok(), await taken.text()).toBeTruthy()
  rival.session.bookings.push((await taken.json()).booking.id)

  await page.getByRole('button', { name: /^Pagar$/ }).click()
  await page.waitForURL(/\/spaces.*room=/, { timeout: 20000 })
  await expect(page.getByRole('status').filter({ hasText: /Pagamento/ })).toContainText('Pagamento concluído', { timeout: 15000 })
  // Next's route announcer is a second `alert`; the calendar's notice names the hour.
  await expect(page.getByRole('alert').filter({ hasText: /reservada/ })).toContainText(/já está reservada/, { timeout: 20000 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  // The pack is in the bank all the same.
  const bank = (await (await api.get(`${API_URL}/packages/me`, { headers: auth(session.token) })).json()).purchases
  expect(bank).toHaveLength(1)
  expect(bank[0].status).toBe('active')
})
