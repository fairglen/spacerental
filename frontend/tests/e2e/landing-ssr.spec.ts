// P1.2: the landing page's data is in the first HTML and the browser issues
// no catalog request to paint it. The perf harness (tests/perf) measures the
// same thing with numbers; this spec is the pass/fail guard.
import { test, expect } from '@playwright/test'
import { SEEDED_ROOMS } from './fixtures'

test.describe('landing page, server-rendered data', () => {
  test('the HTML already names the seeded rooms and the packs', async ({ request }) => {
    const html = await (await request.get('/')).text()
    for (const name of SEEDED_ROOMS) expect(html).toContain(name)
    // The pricing block's packs are rendered too (the seed's hour packs).
    expect(html).toMatch(/\b\d+\s?h\b/)
  })

  test('a cold load makes no catalog request from the browser', async ({ page }) => {
    const catalog: string[] = []
    // Wherever the browser would reach the API — the frontend's own origin
    // through /backend (D20) or a foreign one — a catalog call is a failure.
    page.on('request', (req) => {
      const url = req.url()
      if (/\/api\/v1\/(spaces|packages)(\/|\?|$)/.test(url)) catalog.push(url)
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: SEEDED_ROOMS[0] })).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(catalog, 'the server already rendered what these would fetch').toEqual([])
  })
})
