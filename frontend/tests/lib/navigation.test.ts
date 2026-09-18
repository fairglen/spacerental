import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '@/lib/navigation'

// B28: callbackUrl comes from the query string, so only a same-origin
// relative path may ever be followed (no open redirect).
describe('safeInternalPath', () => {
  it('accepts a relative path with query and hash', () => {
    expect(safeInternalPath('/spaces/abc?x=1#cal')).toBe('/spaces/abc?x=1#cal')
  })
  it('rejects absolute URLs, protocol-relative URLs and schemes', () => {
    expect(safeInternalPath('https://evil.example/phish')).toBeNull()
    expect(safeInternalPath('//evil.example/phish')).toBeNull()
    expect(safeInternalPath('javascript:alert(1)')).toBeNull()
    expect(safeInternalPath('/\\evil.example')).toBeNull()
  })
  it('rejects empty, missing and non-path values', () => {
    expect(safeInternalPath(null)).toBeNull()
    expect(safeInternalPath('')).toBeNull()
    expect(safeInternalPath('spaces/abc')).toBeNull()
  })
})

// NextAuth's middleware sends an absolute same-origin callbackUrl
// (http://localhost:3000/admin); that must be honoured as a path.
describe('safeInternalPath with absolute URLs', () => {
  it('normalises a same-origin absolute URL to its path, query and hash', () => {
    expect(safeInternalPath(`${window.location.origin}/admin/bookings?page=2#x`)).toBe('/admin/bookings?page=2#x')
  })
  it('still rejects another origin, even with the same host on another scheme or port', () => {
    expect(safeInternalPath('https://localhost:3000/admin')).toBeNull()
    expect(safeInternalPath('http://localhost:4000/admin')).toBeNull()
    expect(safeInternalPath('http://evil.example/')).toBeNull()
  })
})
