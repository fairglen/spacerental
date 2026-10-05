import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/csp-report/route'
import { summarize } from '@/lib/cspReport'

const post = (body: unknown, contentType = 'application/csp-report') =>
  POST(new Request('http://localhost:3000/api/csp-report', { method: 'POST', headers: { 'content-type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) }))

describe('POST /api/csp-report (Q52)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs the legacy csp-report object as one compact line and answers 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ 'csp-report': { 'document-uri': 'http://localhost:3000/spaces', 'violated-directive': 'img-src', 'blocked-uri': 'https://cdn.example/x.png', 'original-policy': 'long…' } })
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('[csp-report]')
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toEqual({ 'document-uri': 'http://localhost:3000/spaces', 'violated-directive': 'img-src', 'blocked-uri': 'https://cdn.example/x.png' })
  })

  it('logs each entry of a Reporting API array', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post([
      { type: 'csp-violation', body: { documentURL: 'http://localhost:3000/', effectiveDirective: 'script-src', blockedURL: 'eval' } },
      { type: 'csp-violation', body: { documentURL: 'http://localhost:3000/admin', effectiveDirective: 'frame-src', blockedURL: 'https://maps.example' } },
    ], 'application/reports+json')
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(warn.mock.calls[1][1] as string)).toMatchObject({ effectiveDirective: 'frame-src' })
  })

  it('a body that is not JSON is ignored, still 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post('not json', 'text/plain')
    expect(res.status).toBe(204)
    expect(warn).not.toHaveBeenCalled()
  })

  it('summarize keeps only the fields worth a log line', () => {
    expect(summarize({ 'blocked-uri': 'x', 'original-policy': 'y', 'script-sample': 'z' })).toEqual({ 'blocked-uri': 'x' })
  })
})
