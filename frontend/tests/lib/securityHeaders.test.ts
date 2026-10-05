import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, securityHeaders } from '@/lib/securityHeaders'

type Rule = { source: string; headers: { key: string; value: string }[] }

function headerMap(rules: Rule[], source: string): Record<string, string> {
  const rule = rules.find((r) => r.source === source)
  expect(rule, `a rule for ${source}`).toBeTruthy()
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))
}

describe('securityHeaders (Q52)', () => {
  const dev = securityHeaders({ nodeEnv: 'development', apiUrl: 'http://localhost:8000/api/v1' }) as Rule[]
  const prod = securityHeaders({ nodeEnv: 'production', apiUrl: 'https://api.flowspace.pt/api/v1', mediaOrigin: 'https://media.flowspace.pt/photos' }) as Rule[]

  it('puts the three static headers and the report-only policy on every route', () => {
    const all = headerMap(dev, '/:path*')
    expect(all['X-Content-Type-Options']).toBe('nosniff')
    expect(all['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(all['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
    expect(all['Content-Security-Policy-Report-Only']).toContain("default-src 'self'")
    expect(all['Content-Security-Policy']).toBeUndefined()
    // The root path has its own rule: `/:path*` does not match `/`.
    expect(headerMap(dev, '/')).toEqual(all)
  })

  it('denies framing on every page — enforced by X-Frame-Options while the policy only reports', () => {
    // Every rule, so the public sign-in and password-reset forms are covered
    // too (review round 6), not only the signed-in areas.
    expect(dev.length).toBeGreaterThan(0)
    for (const rule of dev) {
      expect(rule.headers.find((h) => h.key === 'X-Frame-Options')?.value, rule.source).toBe('DENY')
    }
    expect(headerMap(dev, '/:path*')['Content-Security-Policy-Report-Only']).toContain("frame-ancestors 'none'")
  })

  it('refuses a production build without the API URL, and only falls back to localhost in development', () => {
    // Round 7: a policy naming the wrong origin would fail every browser call quietly once deployed.
    expect(() => securityHeaders({ nodeEnv: 'production', apiUrl: undefined })).toThrow(/NEXT_PUBLIC_API_URL/)
    const fallback = securityHeaders({ nodeEnv: 'development', apiUrl: undefined }) as Rule[]
    expect(headerMap(fallback, '/:path*')['Content-Security-Policy-Report-Only']).toContain('connect-src \'self\' http://localhost:8000')
  })

  it('sends HSTS in a production build only', () => {
    expect(headerMap(dev, '/:path*')['Strict-Transport-Security']).toBeUndefined()
    expect(headerMap(prod, '/:path*')['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains')
  })

  it('the policy allows the API origin, the media origin, the OpenStreetMap frame and the report endpoint', () => {
    const csp = headerMap(prod, '/:path*')['Content-Security-Policy-Report-Only']
    expect(csp).toContain("connect-src 'self' https://api.flowspace.pt")
    expect(csp).toContain("img-src 'self' data: blob: https://api.flowspace.pt https://media.flowspace.pt")
    expect(csp).toContain('frame-src https://www.openstreetmap.org')
    expect(csp).toContain('report-uri /api/csp-report')
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it("allows 'unsafe-eval' only outside production (the dev server's HMR)", () => {
    expect(contentSecurityPolicy({ production: false, apiOrigin: 'http://localhost:8000', mediaOrigin: '' })).toContain("'unsafe-eval'")
    expect(contentSecurityPolicy({ production: true, apiOrigin: 'http://localhost:8000', mediaOrigin: '' })).not.toContain("'unsafe-eval'")
  })

  it('does not repeat the API origin when the media origin is the same', () => {
    const csp = contentSecurityPolicy({ production: true, apiOrigin: 'http://localhost:8000', mediaOrigin: 'http://localhost:8000' })
    expect(csp).toContain("img-src 'self' data: blob: http://localhost:8000;")
  })
})
