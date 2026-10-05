import type { Page } from '@playwright/test'
import { test, expect, API_URL, SEEDED_ROOMS } from './fixtures'
import { preferDayView, selectDayView } from './helpers/rooms'

/**
 * The card whose title IS this room's name (the selected card's title also
 * carries the "selected" badge), not a card whose name merely contains it.
 */
const roomCard = (page: Page, name: string) =>
  page.getByTestId('room-card').filter({ has: page.getByRole('heading', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }) })

// C11 on the seeded stack, which has exactly one public space: customers go
// straight to rooms, and the location stays visible although the space layer
// is hidden. Assertions are on behaviour (where links go, what opens), not on
// marketing strings. Read-only: the seeded rooms are addressed by name (other
// specs add and remove rooms of their own while this runs).
test.describe('single-space mode', () => {
  test.beforeEach(async ({ request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    test.skip(spaces.length !== 1, `single-space mode needs exactly one public space; this stack has ${spaces.length}`)
  })

  test('landing → room card → the calendar for that room is open', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    const { rooms } = (await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()) as { rooms: { id: string; name: string }[] }

    await page.goto('/')
    // The landing previews the space's first rooms and, past that, links to
    // the full rooms view. Other specs add and deactivate rooms of their own
    // while this runs, so "the first card" could stand for a room that is
    // gone by the time it is clicked. The seeded rooms are never deactivated
    // and, created first, are what the preview shows: take one of those.
    const seededHeading = page.getByRole('heading', { name: new RegExp(`^(${SEEDED_ROOMS.join('|')})(\\s|$)`) })
    const card = page.getByTestId('room-card').filter({ has: seededHeading }).first()
    await expect(card, 'a seeded room is previewed on the landing').toBeVisible({ timeout: 15000 })
    const cardName = (await card.getByRole('heading').first().textContent())!.trim()
    const target = rooms.find((r) => cardName.startsWith(r.name))
    expect(target, `landing card "${cardName}" is one of the space's rooms`).toBeTruthy()
    // No "choose a space" step anywhere in the section: no space-detail CTA
    // and no link to the space itself (the "all rooms" link to /spaces is the
    // rooms view in this mode, not a chooser).
    await expect(page.locator('#salas').getByRole('button', { name: /Ver Salas e Reservar/i })).toHaveCount(0)
    await expect(page.locator(`#salas a[href="/spaces/${spaces[0].id}"]`)).toHaveCount(0)

    await card.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaces[0].id}\\?room=${target!.id}$`))

    const heading = page.getByRole('heading', { name: `Disponibilidade — ${target!.name}` })
    await expect(heading).toBeVisible({ timeout: 15000 })
    await expect(heading).toBeInViewport()
    await expect(page.locator('.rbc-calendar')).toBeVisible()
    // That room, and only that room, is marked as the one being booked.
    await expect(page.getByRole('button', { name: /Reservar Esta Sala/i, pressed: true })).toHaveCount(1)
    await expect(roomCard(page, target!.name).getByRole('button', { pressed: true })).toBeVisible()

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

  test('the location is on the landing page and on the rooms page: hours, email, address, directions, and the map on load (L04)', async ({ page }) => {
    // The same block on both pages: three icon lines in this order, the
    // directions button under the address, no labels or divider, and the
    // OpenStreetMap frame there without a click, centred on the pin.
    const checkBlock = async (where: ReturnType<typeof page.getByRole>) => {
      await expect(where).toBeVisible({ timeout: 15000 })
      const lines = where.getByTestId('where-lines').locator(':scope > li')
      await expect(lines).toHaveCount(3)
      await expect(lines.nth(0)).toHaveText('Todos os dias 08:00–22:00')
      await expect(lines.nth(1).getByRole('link', { name: 'geral@flowspace.pt' })).toHaveAttribute('href', /^mailto:/)
      await expect(lines.nth(2).getByRole('group', { name: /morada/i }).getByText('2745-841 Queluz')).toBeVisible()
      for (const line of await lines.all()) await expect(line.locator('svg')).toHaveCount(1)
      await expect(where.locator('a[href^="tel:"]')).toHaveCount(0)
      await expect(where.locator('hr')).toHaveCount(0)
      await expect(where.getByText(/^(Contacto|Horário)$/)).toHaveCount(0)
      const directions = where.getByRole('link', { name: /como chegar/i })
      await expect(directions).toHaveAttribute('href', /destination=38\.755723,-9\.279799/)
      await expect(directions).toHaveAttribute('target', '_blank')
      expect(await directions.evaluate((el) => el.previousElementSibling!.getAttribute('data-testid'))).toBe('where-lines')
      await expect(where.getByRole('button', { name: /ver mapa/i })).toHaveCount(0)
      await expect(where).not.toContainText('só é carregado quando o pedir')
      const frame = where.locator('iframe')
      await expect(frame).toHaveCount(1)
      await expect(frame).toHaveAttribute('src', /openstreetmap\.org\/export\/embed/)
      await expect(frame).toHaveAttribute('loading', 'lazy')
      await expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
      const src = new URL((await frame.getAttribute('src'))!)
      const [west, south, east, north] = src.searchParams.get('bbox')!.split(',').map(Number)
      expect((west + east) / 2).toBeCloseTo(-9.279799, 5)
      expect((south + north) / 2).toBeCloseTo(38.755723, 5)
      expect((await where.getByTestId('map-frame').boundingBox())!.height).toBeGreaterThanOrEqual(280)
      await expect(where.getByRole('link', { name: /abrir o mapa completo/i })).toBeVisible()
    }

    await page.goto('/')
    await checkBlock(page.getByRole('region', { name: /onde estamos/i }))

    await page.goto('/spaces')
    await checkBlock(page.getByRole('region', { name: /onde estamos/i }))
    // Nothing customer-facing still places the seeded space in Lisbon.
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
    await page.goto('/')
    await expect(page.getByTestId('footer-location')).toContainText('Queluz')
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
  })

  test('on a phone the words come first and the map sits under them at 16:10, at least 240px tall (L04)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    try {
      await page.goto('/')
      const where = page.getByRole('region', { name: /onde estamos/i })
      await expect(where).toBeVisible({ timeout: 15000 })
      const words = (await where.getByTestId('where-lines').boundingBox())!
      const frame = (await where.getByTestId('map-frame').boundingBox())!
      expect(frame.y).toBeGreaterThanOrEqual(words.y + words.height)
      expect(frame.height).toBeGreaterThanOrEqual(240)
      expect(frame.width / frame.height).toBeLessThanOrEqual(1.6 + 0.01)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    } finally {
      await context.close()
    }
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
      // A seeded room, by its exact name: temporary rooms of other specs come and go.
      await roomCard(page, 'Sala Calma').getByRole('button', { name: /Reservar Esta Sala/i }).click()
      await expect(page.locator('.rbc-calendar')).toBeVisible({ timeout: 15000 })
      await selectDayView(page)
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
