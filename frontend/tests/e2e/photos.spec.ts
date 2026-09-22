import { test, expect } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

// C16 on the seeded stack: the seed gives every demo room a few generated
// photos, so the carousel has real files to show.
test.describe('room photos', () => {
  test('a landing room card shows a photo, and "next" moves to the following one', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    test.skip(spaces.length !== 1, 'room cards are on the landing page only in single-space mode')
    const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const room = rooms.find((r: { photos: unknown[] }) => r.photos.length >= 2)
    expect(room, 'the seed should have given a room at least two photos').toBeTruthy()

    await page.goto('/')
    const card = page.getByTestId('room-card').filter({ hasText: room.name })
    const carousel = card.getByRole('region', { name: `${room.name} — fotografias` })
    await expect(carousel).toBeVisible({ timeout: 15000 })

    // A real image arrived: decoded, with pixels, from the API's /media.
    const first = carousel.getByRole('img').first()
    await expect(first).toHaveAttribute('src', /\/media\/rooms\/.+_thumb\.webp$/)
    await expect.poll(() => first.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)

    const dots = carousel.getByRole('tab')
    await expect(dots).toHaveCount(room.photos.length)
    await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'true')

    await carousel.hover()
    await carousel.getByRole('button', { name: 'Fotografia seguinte' }).click()
    await expect(dots.nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'false')
    // The second photo is the one on screen, and using the carousel did not
    // follow the card's booking link.
    await expect(carousel.getByRole('img').nth(1)).toBeInViewport()
    await expect(page).toHaveURL(/\/$/)

    // Keyboard: focus the frame, arrow back.
    await carousel.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'true')
  })

  test('the room being booked shows its photos, full size, above the calendar', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const room = rooms.find((r: { photos: unknown[] }) => r.photos.length >= 2)
    await page.goto(`/spaces/${spaces[0].id}?room=${room.id}`)
    const heading = page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })
    await expect(heading).toBeVisible({ timeout: 15000 })
    const large = heading.locator('..').getByRole('region', { name: `${room.name} — fotografias` })
    await expect(large.getByRole('img').first()).toHaveAttribute('src', /\/media\/rooms\/[^_]+\.webp$/)
  })
})
