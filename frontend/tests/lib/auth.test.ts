import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('server authentication configuration', () => {
  it.each([undefined, '', '   '])('rejects a missing or blank secret (%s)', async (secret) => {
    vi.stubEnv('NEXTAUTH_SECRET', secret)
    await expect(import('@/lib/auth')).rejects.toThrow('NEXTAUTH_SECRET is required')
  })

  it('uses the explicitly configured secret without replacing it', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-only-explicit-auth-secret')
    const { authOptions } = await import('@/lib/auth')
    expect(authOptions.secret).toBe('test-only-explicit-auth-secret')
  })

  // E02: the .env.example value protects nothing; a production deployment
  // must not start on it. Development keeps working with it.
  it('refuses the development default under APP_ENV=production', async () => {
    vi.stubEnv('APP_ENV', 'production')
    vi.stubEnv('NEXTAUTH_SECRET', 'dev-nextauth-secret-change-in-production')
    await expect(import('@/lib/auth')).rejects.toThrow('NEXTAUTH_SECRET is the development default')
  })

  it('accepts the development default outside production', async () => {
    vi.stubEnv('APP_ENV', 'development')
    vi.stubEnv('NEXTAUTH_SECRET', 'dev-nextauth-secret-change-in-production')
    const { authOptions } = await import('@/lib/auth')
    expect(authOptions.secret).toBe('dev-nextauth-secret-change-in-production')
  })
})
