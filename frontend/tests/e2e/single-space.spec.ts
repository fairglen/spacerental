import { test, expect } from '@playwright/test'
import { waitOutPublicRateWindow } from './helpers/rooms'

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
    await expect(where.getByText('2745-841 Queluz')).toBeVisible()
    const directions = where.getByRole('link', { name: /como chegar/i })
    await expect(directions).toHaveAttribute('href', /destination=38\.755723,-9\.279799/)
    await expect(directions).toHaveAttribute('target', '_blank')
    await expect(page.locator('iframe')).toHaveCount(0)
    expect(thirdParty).toEqual([])

    await where.getByRole('button', { name: /ver mapa/i }).click()
    await expect(where.locator('iframe')).toHaveAttribute('src', /openstreetmap\.org\/export\/embed/)

    await page.goto('/spaces')
    await expect(page.getByText('2745-841 Queluz')).toBeVisible({ timeout: 15000 })
    // Nothing customer-facing still places the seeded space in Lisbon.
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
    await page.goto('/')
    await expect(page.getByTestId('footer-location')).toContainText('Queluz')
    await expect(page.getByText(/Lisboa|Lisbon/)).toHaveCount(0)
  })
})
