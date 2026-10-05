// P2.1: what each class of response tells a cache, as the browser sees it on
// the e2e stack — the Next side here, the API's classes in
// backend/tests/test_cache_headers.py.
import { test, expect } from '@playwright/test'
import { API_URL } from './fixtures'

test.describe('cache headers', () => {
  test('the brand set is immutable; pages and the session are not stored', async ({ request }) => {
    const brand = await request.get('/brand/favicon.svg')
    expect(brand.status()).toBe(200)
    expect(brand.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
    // A page is never told to be kept for a year.
    const page = await request.get('/')
    expect(page.headers()['cache-control'] ?? '').not.toContain('immutable')
  })

  test('the API: a public catalog read is shareable for a minute, availability must revalidate, a photo is immutable, and nothing else is stored', async ({ request }) => {
    const spaces = await request.get(`${API_URL}/spaces`)
    expect(spaces.headers()['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300')
    const { spaces: list } = await spaces.json()
    const detail = await request.get(`${API_URL}/spaces/${list[0].id}`)
    expect(detail.headers()['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300')
    const { rooms } = await detail.json()
    const day = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const availability = await request.get(`${API_URL}/rooms/${rooms[0].id}/availability`, { params: { date: day } })
    expect(availability.headers()['cache-control']).toBe('no-cache')
    const photo = rooms[0].photos?.[0]
    if (photo) {
      const file = await request.get(photo.thumb_url)
      expect(file.status()).toBe(200)
      expect(file.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
    }
    const health = await request.get(`${API_URL.replace(/\/api\/v1$/, '')}/health`)
    expect(health.headers()['cache-control']).toBe('no-store')
    const unauthenticated = await request.get(`${API_URL}/bookings/me`)
    expect(unauthenticated.status()).toBe(401)
    expect(unauthenticated.headers()['cache-control']).toBe('no-store')
  })
})
