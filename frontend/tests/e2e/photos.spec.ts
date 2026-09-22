import { test, expect } from '@playwright/test'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'

// C16/V01 on the seeded stack: the seed gives every demo room the four room
// illustrations, so the carousel, the mosaic and the gallery have real files.
test.use({ viewport: { width: 1280, height: 900 } })

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

  test('the room being booked shows its photos as a mosaic at 1280px, a carousel at 390px, and a gallery (V01)', async ({ page, request }) => {
    const { spaces } = await (await request.get(`${API_URL}/spaces`)).json()
    const { rooms } = await (await request.get(`${API_URL}/spaces/${spaces[0].id}`)).json()
    const room = rooms.find((r: { photos: unknown[] }) => r.photos.length >= 4)
    await page.goto(`/spaces/${spaces[0].id}?room=${room.id}`)
    const heading = page.getByRole('heading', { name: `Disponibilidade — ${room.name}` })
    await expect(heading).toBeVisible({ timeout: 15000 })
    const region = heading.locator('..').getByRole('region', { name: `${room.name} — fotografias` })
    const mosaic = region.getByTestId('photo-mosaic')
    // 1280px: the mosaic — big + 3 with the four seeded illustrations — and the full-size files.
    await expect(mosaic).toBeVisible()
    await expect(mosaic).toHaveAttribute('data-layout', 'big-3')
    await expect(mosaic.getByRole('img')).toHaveCount(4)
    await expect(mosaic.getByRole('img').first()).toHaveAttribute('src', /\/media\/rooms\/[^_]+\.webp$/)
    await expect(region.getByTestId('photo-mosaic-carousel')).toBeHidden()
    const box = await mosaic.boundingBox()
    expect(box!.width / box!.height).toBeCloseTo(2, 0)

    // "Mostrar todas as fotos" opens the full-screen gallery; Escape closes it.
    await region.getByRole('button', { name: 'Mostrar todas as fotos' }).click()
    const gallery = page.getByRole('dialog', { name: `${room.name} — fotografias` })
    await expect(gallery).toBeVisible()
    await expect(gallery.getByTestId('photo-counter')).toHaveText('1 / 4')
    await gallery.getByRole('button', { name: 'Fotografia seguinte' }).click()
    await expect(gallery.getByTestId('photo-counter')).toHaveText('2 / 4')
    await page.keyboard.press('Escape')
    await expect(gallery).toBeHidden()

    // 390px: the carousel at full width with a counter pill, no mosaic.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(mosaic).toBeHidden()
    const carousel = region.getByTestId('photo-mosaic-carousel')
    await expect(carousel).toBeVisible()
    await expect(carousel.getByTestId('photo-counter')).toHaveText('1 / 4')
    const frame = await carousel.boundingBox()
    const content = await heading.locator('..').boundingBox()
    expect(Math.abs(frame!.width - (content!.width - 48))).toBeLessThanOrEqual(2) // the card's 24px padding and 1px border each side
  })
})
