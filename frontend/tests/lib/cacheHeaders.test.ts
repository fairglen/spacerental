import { describe, expect, it } from 'vitest'
import { BRAND_CACHE_CONTROL, cacheHeaders } from '@/lib/cacheHeaders'

describe('cacheHeaders (P2.1)', () => {
  it('marks the brand set immutable for a year and nothing else', () => {
    const rules = cacheHeaders() as { source: string; headers: { key: string; value: string }[] }[]
    expect(rules).toEqual([{ source: '/brand/:path*', headers: [{ key: 'Cache-Control', value: BRAND_CACHE_CONTROL }] }])
    expect(BRAND_CACHE_CONTROL).toBe('public, max-age=31536000, immutable')
  })
})
