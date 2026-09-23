import { test, expect } from '@playwright/test'
import { preferDayView, useDayView, waitOutPublicRateWindow } from './helpers/rooms'

const API_URL = process.env.E2E_API_URL || 'http://localhost:8000/api/v1'

// C11 on the seeded stack, which has exactly one public space: customers go
// straight to rooms, and the location stays visible although the space layer
// is hidden. Assertions are on behaviour (where links go, what opens), not on
// marketing strings.
test.describe('single-space mode', () => {
  // This file and week-view.spec.ts (which runs next) share the one window
  // bought here; together they stay well under the budget.
  test.beforeAll(waitOutPublicRateWindow)

  test.beforeEach(async ({ request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    test.skip(spaces.length !== 1, `single-space mode needs exactly one public space; this stack has ${spaces.length}`)
  })

  test('landing → room card → the calendar for that room is open', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const target = rooms[1] ?? rooms[0]

    await page.goto('/')
    const card = page.getByTestId('room-card').filter({ hasText: target.name })
    await expect(card).toBeVisible({ timeout: 15000 })
    // No "choose a space" step anywhere in the section.
    await expect(page.locator('#salas a[href="/spaces"]')).toHaveCount(0)
    await expect(page.locator(`#salas a[href="/spaces/${spaces[0].id}"]`)).toHaveCount(0)

    await card.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaces[0].id}\\?room=${target.id}$`))

    const heading = page.getByRole('heading', { name: `Disponibilidade — ${target.name}` })
    await expect(heading).toBeVisible({ timeout: 15000 })
    await expect(heading).toBeInViewport()
    await expect(page.locator('.rbc-calendar')).toBeVisible()
    // That room, and only that room, is marked as the one being booked.
    await expect(page.getByRole('button', { name: /Reservar Esta Sala/i, pressed: true })).toHaveCount(1)
    await expect(page.getByTestId('room-card').filter({ hasText: target.name }).getByRole('button', { pressed: true })).toBeVisible()

    // The back button returns to the landing page rather than looping.
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test('a stale ?room= is ignored quietly', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    await page.goto(`/spaces/${spaces[0].id}?room=00000000-0000-0000-0000-000000000000`)
    await expect(page.getByRole('button', { name: /Reservar Esta Sala/i }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByRole('heading', { name: /^Disponibilidade — / })).toHaveCount(0)
    // Scoped to <main>: Next's route announcer is itself a role="alert".
    await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
  })

  test('/spaces is the rooms view, and back from it does not loop', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('navigation').getByRole('link', { name: /^Salas$/ }).click()
    await expect(page).toHaveURL(/\/spaces$/)
    await expect(page.getByRole('button', { name: /Reservar Esta Sala/i }).first()).toBeVisible({ timeout: 15000 })
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test('the location is on the landing page and on the rooms page; the map waits to be asked', async ({ page }) => {
    const thirdParty: string[] = []
    page.on('request', (r) => { if (/openstreetmap|google\./.test(r.url())) thirdParty.push(r.url()) })

    await page.goto('/')
    const where = page.getByRole('region', { name: /onde estamos/i })
    await expect(where).toBeVisible({ timeout: 15000 })
    // The address group (the map placeholder repeats the address at its size).
    await expect(where.getByRole('group', { name: /morada/i }).getByText('2745-841 Queluz')).toBeVisible()
    const directions = where.getByRole('link', { name: /como chegar/i })
    await expect(directions).toHaveAttribute('href', /destination=38\.755723,-9\.279799/)
    await expect(directions).toHaveAttribute('target', '_blank')
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(thirdParty).toEqual([])

    // V06: one block — contact, hours (the seed's 08–22 every day, read as
    // the wall clock it is, whatever the season: R01), no phone line, and the
    // map placeholder holds its size.
    await expect(where.getByRole('link', { name: 'geral@flowspace.pt' })).toHaveAttribute('href', /^mailto:/)
    await expect(where.locator('a[href^="tel:"]')).toHaveCount(0)
    await expect(where.getByTestId('opening-hours')).toHaveText('Todos os dias 08:00–22:00')
    const mapFrame = where.getByTestId('map-frame')
    const before = await mapFrame.boundingBox()
    expect(before!.height).toBeGreaterThanOrEqual(280)

    await where.getByRole('button', { name: /ver mapa/i }).click()
    const frame = where.locator('iframe')
    await expect(frame).toHaveAttribute('src', /openstreetmap\.org\/export\/embed/)
    const src = new URL((await frame.getAttribute('src'))!)
    const [west, south, east, north] = src.searchParams.get('bbox')!.split(',').map(Number)
    expect((west + east) / 2).toBeCloseTo(-9.279799, 5)
    expect((south + north) / 2).toBeCloseTo(38.755723, 5)
    const after = await mapFrame.boundingBox()
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(2)
    expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(2)
    await expect(where.getByRole('link', { name: /abrir o mapa completo/i })).toBeVisible()

    await page.goto('/spaces')
    const whereRooms = page.getByRole('region', { name: /onde estamos/i })
    await expect(whereRooms).toBeVisible({ timeout: 15000 })
    await expect(whereRooms.getByRole('group', { name: /morada/i }).getByText('2745-841 Queluz')).toBeVisible()
    await expect(whereRooms.getByTestId('opening-hours')).toHaveText(/Todos os dias/)
    // Nothing customer-facing still places the seeded space in Lisbon.
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
    await page.goto('/')
    await expect(page.getByTestId('footer-location')).toContainText('Queluz')
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
  })

  // R01: the rules are the door's clock. In a Lisbon-zoned browser the first
  // bookable row of the customer calendar is 08:00 and the last is 21:00,
  // whatever the season — before R01 the grid read 09:00–22:00 in summer.
  test('the calendar\'s first bookable hour is 08:00 on the Lisbon clock', async ({ browser }) => {
    const context = await browser.newContext({ timezoneId: 'Europe/Lisbon' })
    await preferDayView(context)
    const page = await context.newPage()
    try {
      await page.goto('/spaces')
      await page.getByRole('button', { name: /Reservar Esta Sala/i }).first().click()
      await expect(page.locator('.rbc-calendar')).toBeVisible({ timeout: 15000 })
      await useDayView(page)
      // Tomorrow: a whole day of slots, none of them already past.
      await page.getByRole('button', { name: '›' }).click()
      const rows = page.locator('.rbc-time-content .rbc-day-slot .rbc-timeslot-group')
      const labels = page.locator('.rbc-time-gutter .rbc-timeslot-group .rbc-label')
      const tinted = async () => {
        const colours = await rows.evaluateAll((groups) =>
          groups.map((g) => window.getComputedStyle(g.querySelector('.rbc-time-slot')!).backgroundColor),
        )
        // A slot the API returned is tinted (available or taken); the padding
        // rows and closed hours are not.
        return colours.map((c) => c === 'rgb(240, 250, 245)' || c === 'rgb(243, 244, 246)')
      }
      await expect.poll(async () => (await tinted()).some(Boolean), { timeout: 15000 }).toBe(true)
      const isSlot = await tinted()
      const texts = (await labels.allTextContents()).map((t) => t.trim())
      expect(texts[isSlot.indexOf(true)]).toBe('08:00')
      expect(texts[isSlot.lastIndexOf(true)]).toBe('21:00')
      expect(isSlot.filter(Boolean)).toHaveLength(14)
    } finally {
      await context.close()
    }
  })
})
