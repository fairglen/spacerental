import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { test, expect } from '@playwright/test'
import { openSpaceRooms, preferDayView, useDayView } from './helpers/rooms'
import pt from '../../lib/i18n/pt.json'

test.use({ timezoneId: 'UTC' })
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

/** Resolves once the element's position has been stable for two reads. */
async function settled(locator: import('@playwright/test').Locator) {
  await expect
    .poll(async () => {
      const a = await locator.boundingBox()
      await new Promise((r) => setTimeout(r, 120))
      const b = await locator.boundingBox()
      return !!a && !!b && a.y === b.y && a.x === b.x
    }, { timeout: 10000 })
    .toBe(true)
}

test.describe('Authentication', () => {
  let walkedCustomerJourney = false

  test.afterAll(async () => {
    if (!walkedCustomerJourney) return
    // Compose sees all browser customers as one peer. Give the added full
    // journey its own default public-rate window before the next suite, so
    // machine-speed traffic does not exhaust another customer's budget.
    test.setTimeout(65_000)
    await delay(60_000)
  })

  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(pt.hero.headline_start)
  })

  test('fresh customer signs up, selects multiple hours, pays and sees confirmation', async ({ page }) => {
    walkedCustomerJourney = true
    const email = `test-${randomUUID()}@example.com`
    await page.goto('/sign-up')
    await page.getByLabel('Nome').fill('Test User')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByLabel('Confirmar password').fill('password123')
    const registered = page.waitForResponse(r => r.url() === `${API_URL}/auth/register` && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Criar Conta/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    await expect(page.getByText(/Olá/i)).toBeVisible()
    const registration = await registered
    expect(registration.status()).toBe(201)
    const customer = await registration.json()
    expect(customer.role).toBe('member')
    const headers = { Authorization: `Bearer ${customer.access_token}` }
    const membershipResponse = await page.request.get(`${API_URL}/auth/memberships`, { headers })
    const { memberships } = await membershipResponse.json()
    expect(memberships).toHaveLength(1)
    expect(memberships[0].role).toBe('member')
    const denied = await page.request.get(`${API_URL}/admin/dashboard`, {
      headers, params: { org_id: memberships[0].org_id },
    })
    expect(denied.status()).toBe(403)
    await preferDayView(page)
    await openSpaceRooms(page)
    // With one public space the rooms view lives at /spaces itself (C11), so
    // the space is identified through the API rather than read off the URL.
    const { spaces } = await (await page.request.get(`${API_URL}/spaces`)).json()
    const spaceId = /\/spaces\/[^/]+$/.test(new URL(page.url()).pathname)
      ? new URL(page.url()).pathname.split('/').pop()
      : spaces[0].id
    const detail = await (await page.request.get(`${API_URL}/spaces/${spaceId}`)).json()
    expect(detail.space.org_id).toBe(memberships[0].org_id)
    const room = detail.rooms[0]
    await page.getByRole('button', { name: /Reservar Esta Sala/i }).first().click()
    await expect(page.getByRole('heading', { name: /^Disponibilidade — / })).toBeVisible()
    await useDayView(page)

    // Each run picks free future inventory and cancels only its own reservation.
    let offset = 7
    let startHour = 0
    for (let attempt = 0; attempt < 7; attempt++, offset++) {
      const day = new Date()
      day.setUTCDate(day.getUTCDate() + offset)
      const availability = await (await page.request.get(`${API_URL}/rooms/${room.id}/availability`, {
        params: { date: day.toISOString().slice(0, 10) },
      })).json()
      const slots: { start: string; end: string; available: boolean }[] = availability.slots
      const first = slots.find((slot, index) => slot.available && slots[index + 1]?.available
        && slot.end === slots[index + 1].start && new Date(slot.start).getUTCHours() >= 9
        && new Date(slot.start).getUTCHours() <= 15)
      if (first) { startHour = new Date(first.start).getUTCHours(); break }
    }
    expect(startHour, 'two consecutive free hours within the next week').toBeGreaterThan(0)
    for (let i = 0; i < offset; i++) await page.getByRole('button', { name: '›' }).click()
    // Rows are located by their gutter label: the grid's first hour follows
    // the returned slots (B34), not a fixed 08:00.
    const slot = async (hour: number) => {
      const label = `${String(hour).padStart(2, '0')}:00`
      const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
      const index = labels.findIndex((text) => text.trim() === label)
      expect(index, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
      return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(index).locator('.rbc-time-slot').first()
    }
    // The grid's rows are only final once this day's slots have landed
    // (B34 derives the visible range from them), so wait for the target hour
    // to be tinted before resolving any row locator.
    await expect
      .poll(async () => {
        const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
        const index = labels.findIndex((text) => text.trim() === `${String(startHour).padStart(2, '0')}:00`)
        if (index < 0) return ''
        return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(index).locator('.rbc-time-slot').first()
          .evaluate((el) => window.getComputedStyle(el).backgroundColor)
      }, { timeout: 15000 })
      .toBe('rgb(240, 250, 245)')
    const firstSlot = await slot(startHour)
    const secondSlot = await slot(startHour + 1)
    await secondSlot.scrollIntoViewIfNeeded()
    await firstSlot.scrollIntoViewIfNeeded()
    await settled(firstSlot)
    const from = await firstSlot.boundingBox()
    const to = await secondSlot.boundingBox()
    expect(from && to).toBeTruthy()
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.getByRole('heading', { name: /Confirmar Reserva/i })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Duração', { exact: true }).locator('..')).toContainText('2h')
    await page.getByRole('button', { name: /Confirmar Reserva/i }).click()
    await page.waitForURL(/\/checkout\/stub\/cs_stub_/)
    // The browser has left Next.js, so read persisted state through the API;
    // Chromium can discard the old document's response body on navigation.
    const pending = await (await page.request.get(`${API_URL}/bookings/me`, { headers })).json()
    expect(pending.bookings).toHaveLength(1)
    const booking = pending.bookings[0]
    try {
      expect(Number(booking.duration_hours)).toBe(2)
      expect(booking.status).toBe('pending')
      await page.waitForURL(/\/checkout\/stub\/cs_stub_/)
      await page.getByRole('button', { name: /^Pagar$/ }).click()
      await page.waitForURL(/\/dashboard/)
      await expect(page.getByText('Confirmado', { exact: true })).toBeVisible()
      const mine = await (await page.request.get(`${API_URL}/bookings/me`, { headers })).json()
      expect(mine.bookings).toHaveLength(1)
      expect(mine.bookings[0].id).toBe(booking.id)
      expect(mine.bookings[0].status).toBe('confirmed')
    } finally {
      const cancelled = await page.request.delete(`${API_URL}/bookings/${booking.id}`, { headers })
      expect(cancelled.ok()).toBeTruthy()
    }
  })

  test('sign-in with seeded admin works', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('admin123')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
  })

  test('sign-in with wrong password shows error', async ({ page }) => {
    await page.goto('/sign-in')
    await page.getByLabel(/Email/i).fill('admin@demo.com')
    await page.getByLabel('Password').fill('wrongpass')
    await page.getByRole('button', { name: /Entrar/i }).click()
    await expect(page.getByText(/incorretos/i)).toBeVisible({ timeout: 10000 })
  })

  test('protected route redirects to sign-in', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/dashboard')
    await page.waitForURL('**/sign-in**', { timeout: 10000 })
  })
})
