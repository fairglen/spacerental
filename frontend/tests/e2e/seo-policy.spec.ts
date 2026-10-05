import { test, expect, API_URL, contextAs } from './fixtures'

// S2.1: the app does not compete with flowspace.pt — every page is
// `noindex, follow`, the landing canonicalises to the site, the private
// surface also answers with an X-Robots-Tag, and robots.txt still lets
// crawlers in (so the noindex is read and link previews work).
test.describe('indexing policy', () => {
  test('the landing is noindex, follow, canonical to flowspace.pt, in pt-PT, with its Open Graph card', async ({ request }) => {
    const response = await request.get('/')
    expect(response.ok()).toBeTruthy()
    const html = await response.text()
    expect(html).toContain('<html lang="pt-PT"')
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"\s*\/?>/)
    // Next normalises the canonical with its trailingSlash setting: the site
    // root with or without the slash is the same URL.
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/flowspace\.pt\/?"\s*\/?>/)
    expect(html).toMatch(/<meta property="og:image" content="[^"]*\/brand\/og-image\.png"/)
    expect(response.headers()['x-robots-tag']).toBeUndefined()
  })

  test('the rooms page is noindex, follow and not canonical to the site', async ({ request }) => {
    const spaces = (await (await request.get(`${API_URL}/spaces`)).json()).spaces
    const html = await (await request.get(`/spaces/${spaces[0].id}`)).text()
    expect(html).toMatch(/<meta name="robots" content="noindex, follow"\s*\/?>/)
    expect(html).not.toContain('rel="canonical"')
  })

  test('sign-in and the customer area answer noindex, nofollow in the HTML and as a header', async ({ request, browser, contextOptions }) => {
    const signIn = await request.get('/sign-in')
    expect(signIn.ok()).toBeTruthy()
    expect(signIn.headers()['x-robots-tag']).toBe('noindex, nofollow')
    expect(await signIn.text()).toMatch(/<meta name="robots" content="noindex, nofollow"\s*\/?>/)

    // Unauthenticated, the customer area redirects; the header is on the redirect too.
    const redirected = await request.get('/dashboard', { maxRedirects: 0 })
    expect([302, 307, 308]).toContain(redirected.status())
    expect(redirected.headers()['x-robots-tag']).toBe('noindex, nofollow')

    const context = await contextAs(browser, null, contextOptions)
    try {
      const page = await context.newPage()
      const dashboard = await page.goto('/dashboard')
      expect(dashboard!.headers()['x-robots-tag']).toBe('noindex, nofollow')
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow')
      const admin = await page.goto('/admin')
      expect(admin!.headers()['x-robots-tag']).toBe('noindex, nofollow')
    } finally {
      await context.close()
    }
  })

  test('robots.txt allows crawling and names no sitemap', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text()
    expect(robots).toMatch(/User-Agent: \*\s+Allow: \//i)
    expect(robots).not.toMatch(/Disallow:/)
    expect(robots).not.toMatch(/Sitemap:/)
    expect((await request.get('/sitemap.xml')).status()).toBe(404)
  })
})
