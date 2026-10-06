// D20: the browser reaches the backend through this app's own origin.
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERNAL_API_URL,
  DEFAULT_PUBLIC_API_URL,
  PROXY_PREFIX,
  appendForwardedFor,
  backendInternalOrigin,
  backendRewrites,
  internalApiUrl,
  publicApiOrigin,
  publicApiUrl,
} from '@/lib/backendProxy'
import { baseURL } from '@/lib/api'

const APP_DIR = join(__dirname, '..', '..', 'app')

/** The first path segment of every route under app/ (route groups unwrapped). */
function topLevelRouteSegments(dir = APP_DIR): string[] {
  const segments = new Set<string>()
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (!statSync(full).isDirectory()) continue
    if (entry.startsWith('(') && entry.endsWith(')')) {
      for (const inner of topLevelRouteSegments(full)) segments.add(inner)
    } else {
      segments.add(entry)
    }
  }
  return Array.from(segments)
}

describe('the browser side', () => {
  it('calls the API on this origin by default, through the proxy prefix', () => {
    expect(DEFAULT_PUBLIC_API_URL).toBe('/backend/api/v1')
    expect(publicApiUrl({})).toBe('/backend/api/v1')
    expect(publicApiUrl({ NEXT_PUBLIC_API_URL: 'http://localhost:8000/api/v1' })).toBe('http://localhost:8000/api/v1')
    // lib/api.ts's axios base is that value in this (unset) environment.
    expect(process.env.NEXT_PUBLIC_API_URL).toBeUndefined()
    expect(baseURL).toBe('/backend/api/v1')
  })

  it('has no foreign API origin unless NEXT_PUBLIC_API_URL is absolute', () => {
    expect(publicApiOrigin({})).toBeNull()
    expect(publicApiOrigin({ NEXT_PUBLIC_API_URL: '/backend/api/v1' })).toBeNull()
    expect(publicApiOrigin({ NEXT_PUBLIC_API_URL: 'https://api.flowspace.pt/api/v1' })).toBe('https://api.flowspace.pt')
  })
})

describe('the server side', () => {
  it('resolves INTERNAL_API_URL first and never inherits the relative browser value', () => {
    expect(internalApiUrl({ INTERNAL_API_URL: 'http://backend:8000/api/v1', NEXT_PUBLIC_API_URL: '/backend/api/v1' })).toBe('http://backend:8000/api/v1')
    expect(internalApiUrl({ NEXT_PUBLIC_API_URL: '/backend/api/v1' })).toBe(DEFAULT_INTERNAL_API_URL)
    expect(internalApiUrl({})).toBe('http://localhost:8000/api/v1')
    // The frontend outside Docker against an API it can reach by its public address.
    expect(internalApiUrl({ NEXT_PUBLIC_API_URL: 'http://192.168.1.42:8000/api/v1' })).toBe('http://192.168.1.42:8000/api/v1')
  })

  it('proxies /backend/* to the origin of INTERNAL_API_URL, with the /api/v1 suffix stripped', () => {
    expect(backendInternalOrigin({ INTERNAL_API_URL: 'http://backend:8000/api/v1' })).toBe('http://backend:8000')
    expect(backendInternalOrigin({})).toBe('http://localhost:8000')
    expect(backendRewrites({ INTERNAL_API_URL: 'http://backend:8000/api/v1' })).toEqual([
      { source: '/backend/:path*', destination: 'http://backend:8000/:path*' },
    ])
  })
})

describe('the client address the backend can believe (server.js)', () => {
  it('appends the peer, so the rightmost entry is ours whatever the client wrote', () => {
    expect(appendForwardedFor(undefined, '172.18.0.1')).toBe('172.18.0.1')
    expect(appendForwardedFor('1.2.3.4', '172.18.0.1')).toBe('1.2.3.4, 172.18.0.1')
    expect(appendForwardedFor(' 1.2.3.4 ,, 5.6.7.8 ', '172.18.0.1')).toBe('1.2.3.4, 5.6.7.8, 172.18.0.1')
    expect(appendForwardedFor(['1.2.3.4', '5.6.7.8'], '172.18.0.1')).toBe('1.2.3.4, 5.6.7.8, 172.18.0.1')
  })

  it('leaves the header alone when there is no socket address', () => {
    expect(appendForwardedFor(undefined, undefined)).toBeUndefined()
    expect(appendForwardedFor('1.2.3.4', undefined)).toBe('1.2.3.4')
  })
})

describe('the prefix', () => {
  it('collides with no app route and not with NextAuth under /api', () => {
    const prefix = PROXY_PREFIX.replace(/^\//, '')
    const segments = topLevelRouteSegments()
    expect(segments).toContain('api') // NextAuth's /api/auth/* and /api/csp-report live here…
    expect(segments).not.toContain(prefix) // …and nothing of ours is under /backend
    expect(PROXY_PREFIX.startsWith('/api')).toBe(false)
  })
})
