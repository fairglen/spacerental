import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { metadataBaseFrom, ROBOTS_APP, ROBOTS_PRIVATE, SITE_CANONICAL } from '@/lib/seo'

// CommonJS on purpose (next.config.js requires it); the test loads it the same way.
const require = createRequire(import.meta.url)
const { robotsHeaders, ROBOTS_PRIVATE_HEADER, PRIVATE_SOURCES } = require('../../lib/robotsHeaders') as {
  robotsHeaders: () => { source: string; headers: { key: string; value: string }[] }[]
  ROBOTS_PRIVATE_HEADER: string
  PRIVATE_SOURCES: string[]
}

// S2.1: the app is `noindex, follow` everywhere, `noindex, nofollow` plus an
// X-Robots-Tag on the private surface, and the landing canonicalises to the
// static site.
describe('the app\'s indexing policy', () => {
  it('says noindex everywhere and nofollow on the private surface', () => {
    expect(ROBOTS_APP).toEqual({ index: false, follow: true })
    expect(ROBOTS_PRIVATE).toEqual({ index: false, follow: false })
    expect(SITE_CANONICAL).toBe('https://flowspace.pt/')
  })

  it('sends X-Robots-Tag: noindex, nofollow on the private routes and their children only', () => {
    const rules = robotsHeaders()
    expect(rules.map((r) => r.source)).toEqual(PRIVATE_SOURCES)
    expect(PRIVATE_SOURCES).toEqual(['/dashboard', '/dashboard/:path*', '/admin', '/admin/:path*', '/sign-in', '/reset-password/:path*'])
    for (const rule of rules) expect(rule.headers).toEqual([{ key: 'X-Robots-Tag', value: ROBOTS_PRIVATE_HEADER }])
    expect(ROBOTS_PRIVATE_HEADER).toBe('noindex, nofollow')
    // The landing, the rooms and sign-up keep their link previews: no header there.
    expect(PRIVATE_SOURCES).not.toContain('/')
    expect(PRIVATE_SOURCES).not.toContain('/:path*')
    expect(PRIVATE_SOURCES.some((s) => s.startsWith('/spaces') || s.startsWith('/sign-up'))).toBe(false)
  })

  it('takes the public URL from FRONTEND_URL, then NEXTAUTH_URL, else leaves Next to say so', () => {
    expect(metadataBaseFrom({ FRONTEND_URL: 'https://app.example.pt', NEXTAUTH_URL: 'http://localhost:3000' })?.href).toBe('https://app.example.pt/')
    expect(metadataBaseFrom({ NEXTAUTH_URL: 'http://localhost:3000' })?.href).toBe('http://localhost:3000/')
    expect(metadataBaseFrom({})).toBeUndefined()
  })
})
