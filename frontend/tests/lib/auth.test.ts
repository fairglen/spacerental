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
})
