// D20: the browser reaches the backend through the frontend's own origin.
// Everything the pages do — API calls, the photos, the stub Checkout page an
// operator-less customer is sent to — stays on `baseURL`; the API's own port
// (E2E_API_URL, used by the fixtures for setup) is never contacted by the
// browser. The flows themselves are the ones auth.spec.ts and photos.spec.ts
// walk; this spec watches where they go.
import { randomUUID } from 'node:crypto'
import { test, expect, API_URL, at, contextAs, freshDay } from './fixtures'
import { preferDayView, selectDayView } from './helpers/rooms'
import type { Page } from '@playwright/test'

test.use({ timezoneId: 'UTC' })

const API_HOST = new URL(API_URL).host // e.g. localhost:8000 — must never appear in a browser request

/** Every request the page makes, so a flow can be checked for where it went. */
function recordRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (req) => urls.push(req.url()))
  return urls
}

/**
 * Nothing the browser asked for went to the API's own host, and everything
 * of the backend's — API calls, photos, the stub Checkout page — was asked of
 * the frontend origin. (Other origins exist legitimately: the OpenStreetMap
 * frame in "Onde estamos".)
 */
function backendOnlyThroughThisOrigin(urls: string[], baseURL: string) {
  const origin = new URL(baseURL).origin
  expect(urls.filter((url) => url.includes(API_HOST)), `no browser request reaches ${API_HOST}`).toEqual([])
  // Backend paths, proxied or not: /api/v1, /media and /checkout/stub at the
  // root of an origin or under /backend (Next's own /_next/static/media is neither).
  const backend = urls.filter((url) => /^\/(backend\/)?(api\/v1|media|checkout\/stub)(\/|$)/.test(new URL(url).pathname))
  expect(backend.length, 'the flow did talk to the backend').toBeGreaterThan(0)
  const elsewhere = backend.filter((url) => !url.startsWith(`${origin}/backend/`))
  expect(elsewhere, 'every backend request goes through /backend on the frontend origin').toEqual([])
}

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

function daysFromToday(day: Date): number {
  const now = new Date()
  return Math.round((day.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000)
}

test.describe('one origin', () => {
  test('the API answers through the frontend origin with its own headers', async ({ page }) => {
    const health = await page.request.get('/backend/health')
    expect(health.status()).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
    // The backend's own response, untouched: its request id and the static
    // security headers it sets on every answer (Q52).
    expect(health.headers()['x-request-id']).toBeTruthy()
    expect(health.headers()['x-content-type-options']).toBe('nosniff')
    expect(health.headers()['x-frame-options']).toBe('DENY')
    // A path only the backend serves, and one that does not exist there.
    expect((await page.request.get('/backend/openapi-public.json')).status()).toBe(200)
    expect((await page.request.get('/backend/no-such-route')).status()).toBe(404)
    // The API list endpoint keeps its contract through the proxy.
    const spaces = await (await page.request.get('/backend/api/v1/spaces')).json()
    expect(Array.isArray(spaces.spaces)).toBe(true)
  })

  test('a customer signs up, books and pays on the stub Checkout page without ever leaving the origin', async ({ page, room, baseURL }) => {
    const urls = recordRequests(page)
    const email = `one-origin-${randomUUID()}@example.com`
    await page.goto('/sign-up')
    await page.getByLabel('Nome').fill('One Origin')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await page.getByLabel('Confirmar password').fill('password123')
    const registered = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/register') && r.request().method() === 'POST')
    await page.getByRole('button', { name: /Criar Conta/i }).click()
    await page.waitForURL('**/dashboard', { timeout: 15000 })
    const registration = await registered
    expect(registration.status()).toBe(201)
    // The browser's registration call went through /backend on this origin.
    expect(registration.url()).toBe(`${new URL(baseURL!).origin}/backend/api/v1/auth/register`)
    const customer = await registration.json()
    const headers = { Authorization: `Bearer ${customer.access_token}` }

    const day = freshDay(7)
    const startHour = 10
    await preferDayView(page)
    await page.goto(`/spaces/${room.space_id}?room=${room.id}`)
    await expect(page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })).toBeVisible({ timeout: 15000 })
    await selectDayView(page)
    for (let i = 0; i < daysFromToday(day); i++) await page.getByRole('button', { name: '›' }).click()
    const slot = async (hour: number) => {
      const label = `${String(hour).padStart(2, '0')}:00`
      const labels = await page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label').allTextContents()
      const index = labels.findIndex((text) => text.trim() === label)
      expect(index, `hour ${label} is not on the calendar grid`).toBeGreaterThanOrEqual(0)
      return page.locator('.rbc-day-slot .rbc-timeslot-group').nth(index).locator('.rbc-time-slot').first()
    }
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
    await page.getByRole('button', { name: /Confirmar Reserva/i }).click()

    // The stub Checkout page is the backend's, reached on this origin through the proxy.
    await page.waitForURL(/\/backend\/checkout\/stub\/cs_stub_/)
    expect(new URL(page.url()).origin).toBe(new URL(baseURL!).origin)
    const pending = await (await page.request.get(`${API_URL}/bookings/me`, { headers })).json()
    expect(pending.bookings).toHaveLength(1)
    const booking = pending.bookings[0]
    expect(new Date(booking.start_time).getTime()).toBe(at(day, startHour).getTime())
    try {
      expect(booking.status).toBe('pending')
      // The page's form posts relative to itself, so "Pagar" lands under /backend too.
      await page.getByRole('button', { name: /^Pagar$/ }).click()
      await page.waitForURL(/\/dashboard/)
      await expect(page.getByText('Confirmado', { exact: true })).toBeVisible()
      const mine = await (await page.request.get(`${API_URL}/bookings/me`, { headers })).json()
      expect(mine.bookings[0].status).toBe('confirmed')
      backendOnlyThroughThisOrigin(urls, baseURL!)
    } finally {
      const cancelled = await page.request.delete(`${API_URL}/bookings/${booking.id}`, { headers })
      expect(cancelled.ok()).toBeTruthy()
    }
  })

  test('room photos load from this origin through /backend/media', async ({ page, request, baseURL }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const room = rooms.find((r: { photos: unknown[] }) => r.photos.length >= 1)
    expect(room, 'the seed gives the demo rooms photos').toBeTruthy()
    const urls = recordRequests(page)
    await page.goto(`/spaces/${spaces[0].id}?room=${room.id}`)
    const heading = page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })
    await expect(heading).toBeVisible({ timeout: 15000 })
    const img = heading.locator('..').getByRole('region', { name: `${room.name} — fotografias` }).getByRole('img').first()
    const origin = new URL(baseURL!).origin
    await expect(img).toHaveAttribute('src', new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/backend/media/rooms/.+\\.webp$`))
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
    expect(urls.some((url) => url.startsWith(`${origin}/backend/media/rooms/`))).toBe(true)
    backendOnlyThroughThisOrigin(urls, baseURL!)
  })

  test('an operator uploads a photo through the proxy (multipart)', async ({ browser, contextOptions, room, baseURL }) => {
    const context = await contextAs(browser, null, contextOptions)
    const page = await context.newPage()
    const urls = recordRequests(page)
    try {
      await page.goto(`/admin/rooms/${room.id}`)
      const input = page.locator(`#photo-input-${room.id}`)
      await expect(input).toBeAttached({ timeout: 20000 })
      // The call carries `?org_id=…` (useApi), so match on the path alone.
      const uploaded = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/api/v1/admin/rooms/${room.id}/images`) && r.request().method() === 'POST')
      await input.setInputFiles({ name: 'sala.png', mimeType: 'image/png', buffer: await pngBuffer() })
      const response = await uploaded
      expect(response.status()).toBe(201)
      expect(new URL(response.url()).origin).toBe(new URL(baseURL!).origin)
      const { room: updated } = await response.json()
      expect(updated.photos).toHaveLength(1)
      expect(updated.photos[0].thumb_url).toMatch(/\/backend\/media\/rooms\//)
      const thumb = page.getByRole('img', { name: `Fotografia 1 de ${room.name}` })
      await expect(thumb).toBeVisible()
      await expect.poll(() => thumb.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true)
      backendOnlyThroughThisOrigin(urls, baseURL!)
    } finally {
      await context.close()
    }
  })
})

/** A 64×48 solid PNG, hand-written so the runner needs no image library: a real file for the upload pipeline (Pillow decodes it). */
async function pngBuffer(): Promise<Buffer> {
  const zlib = await import('node:zlib')
  const width = 64
  const height = 48
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      const i = y * (width * 3 + 1) + 1 + x * 3
      raw[i] = 61
      raw[i + 1] = 122
      raw[i + 2] = 94
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(buf: Buffer): number {
  let crc = ~0
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}
