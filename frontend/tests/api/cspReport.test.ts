import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/csp-report/route'
import { MAX_BODY_BYTES, MAX_REPORTS, ReportRateLimiter, sanitizeUrl, summarize } from '@/lib/cspReport'

const post = (body: unknown, contentType = 'application/csp-report', headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost:3000/api/csp-report', { method: 'POST', headers: { 'content-type': contentType, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('POST /api/csp-report (Q52)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the legacy csp-report object as one compact line and answers 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ 'csp-report': { 'document-uri': 'http://localhost:3000/spaces', 'violated-directive': 'img-src', 'blocked-uri': 'https://cdn.example/x.png', 'original-policy': 'long…' } }, 'application/csp-report', { 'x-forwarded-for': '10.0.0.1' })
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('[csp-report]')
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toEqual({ 'document-uri': 'http://localhost:3000/spaces', 'violated-directive': 'img-src', 'blocked-uri': 'https://cdn.example/x.png' })
  })

  it('logs each entry of a Reporting API array, at most MAX_REPORTS of them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entries = Array.from({ length: MAX_REPORTS + 5 }, (_, i) => ({ type: 'csp-violation', body: { documentURL: 'http://localhost:3000/', effectiveDirective: 'script-src', blockedURL: `eval-${i}` } }))
    const res = await post(entries, 'application/reports+json', { 'x-forwarded-for': '10.0.0.2' })
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(MAX_REPORTS)
  })

  it('refuses other content types without reading the body, and a body over the limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await post('{"csp-report":{}}', 'text/plain', { 'x-forwarded-for': '10.0.0.3' })).status).toBe(415)
    const big = JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(MAX_BODY_BYTES) } })
    expect((await post(big, 'application/csp-report', { 'x-forwarded-for': '10.0.0.3' })).status).toBe(413)
    expect(warn).not.toHaveBeenCalled()
  })

  it('a body that is not JSON is ignored, still 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post('not json', 'application/csp-report', { 'x-forwarded-for': '10.0.0.4' })
    expect(res.status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })

  it('rate-limits a client after 30 reports a minute (per process, like the API)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let last = 0
    for (let i = 0; i < 31; i++) last = (await post({ 'csp-report': { 'blocked-uri': 'x' } }, 'application/csp-report', { 'x-forwarded-for': '10.0.0.5' })).status
    expect(last).toBe(429)
    // Another client is unaffected.
    expect((await post({ 'csp-report': { 'blocked-uri': 'x' } }, 'application/csp-report', { 'x-forwarded-for': '10.0.0.6' })).status).toBe(204)
  })
})

describe('summarize / sanitizeUrl', () => {
  it('keeps only the fields worth a log line, bounded', () => {
    expect(summarize({ 'blocked-uri': 'x', 'original-policy': 'y', 'script-sample': 'z', 'line-number': 12 })).toEqual({ 'blocked-uri': 'x', 'line-number': 12 })
    expect((summarize({ 'violated-directive': 'a'.repeat(1000) })['violated-directive'] as string).length).toBe(300)
  })

  it('never logs a query string, a fragment or a token-like path segment', () => {
    expect(sanitizeUrl('http://localhost:3000/reset-password/8f3a9c2e1b7d4e6f0a1b2c3d4e5f6a7b?x=1#frag')).toBe('http://localhost:3000/reset-password/[redacted]')
    expect(sanitizeUrl('http://localhost:3000/spaces/faa9ef34-3183-4195-8583-f065c0f5b720?room=abc')).toBe('http://localhost:3000/spaces/[redacted]')
    expect(sanitizeUrl('http://localhost:3000/dashboard/packages')).toBe('http://localhost:3000/dashboard/packages')
    expect(sanitizeUrl('eval')).toBe('eval')
    expect(summarize({ 'document-uri': 'http://localhost:3000/reset-password/8f3a9c2e1b7d4e6f0a1b2c3d4e5f6a7b' })).toEqual({ 'document-uri': 'http://localhost:3000/reset-password/[redacted]' })
  })

  it('the limiter forgets a client after the window and stays bounded in clients', () => {
    const limiter = new ReportRateLimiter(2, 1000, 2)
    expect(limiter.allow('a', 0)).toBe(true)
    expect(limiter.allow('a', 1)).toBe(true)
    expect(limiter.allow('a', 2)).toBe(false)
    expect(limiter.allow('a', 1500)).toBe(true)
    limiter.allow('b', 1500); limiter.allow('c', 1500)
    expect(limiter.allow('d', 1500)).toBe(true)
  })
})
