import { expect, test } from '@playwright/test'
import { API_URL } from './fixtures'

/**
 * Q52: the static security headers on the pages and on the API, as the
 * browser sees them from the e2e stack (a production build). The policy is
 * report-only here by design (TODO.md Q56 is the flip).
 */
const STATIC = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

test.describe('security headers', () => {
  test('every page carries the static headers and a report-only policy; the signed-in areas deny framing', async ({ request }) => {
    for (const path of ['/', '/spaces', '/sign-in']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
      for (const [name, value] of Object.entries(STATIC)) expect(res.headers()[name], `${name} on ${path}`).toBe(value)
      expect(res.headers()['content-security-policy-report-only'], path).toContain("frame-ancestors 'none'")
      expect(res.headers()['content-security-policy'], `${path} must not enforce yet`).toBeUndefined()
      expect(res.headers()['x-frame-options'], `${path} is a public page`).toBeUndefined()
    }
    // Signed out, /dashboard and /admin redirect to sign-in — the redirect
    // response itself is what the browser gets, with the framing denial.
    for (const path of ['/dashboard', '/admin']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect([200, 307, 302]).toContain(res.status())
      expect(res.headers()['x-frame-options'], path).toBe('DENY')
      expect(res.headers()['x-content-type-options'], path).toBe('nosniff')
    }
  })

  test('the API answers with the same static headers, and denies framing everywhere', async ({ request }) => {
    const res = await request.get(`${API_URL}/spaces`)
    expect(res.ok()).toBeTruthy()
    for (const [name, value] of Object.entries(STATIC)) expect(res.headers()[name], name).toBe(value)
    expect(res.headers()['x-frame-options']).toBe('DENY')
    const health = await request.get(`${new URL(API_URL).origin}/health`)
    expect(health.headers()['x-frame-options']).toBe('DENY')
  })

  test('a violation report is accepted', async ({ request }) => {
    const res = await request.post('/api/csp-report', {
      headers: { 'content-type': 'application/csp-report' },
      data: { 'csp-report': { 'document-uri': 'http://e2e/', 'violated-directive': 'img-src', 'blocked-uri': 'https://example.invalid/x.png' } },
    })
    expect(res.status()).toBe(204)
  })
})
