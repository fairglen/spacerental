import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, request, type FullConfig } from '@playwright/test'

export const ADMIN_STORAGE_STATE = 'tests/e2e/.auth/admin.json'

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error('E2E baseURL is required')

  // Keep setup requests sequential: simultaneous cold-page session/CSRF
  // responses can replace the CSRF cookie before credentials are submitted.
  // auth.spec.ts still exercises the real sign-in and sign-up forms.
  const api = await request.newContext({ baseURL })
  try {
    const csrfResponse = await api.get('/api/auth/csrf')
    expect(csrfResponse.ok(), 'NextAuth CSRF endpoint must be ready').toBeTruthy()
    const { csrfToken } = await csrfResponse.json()
    expect(typeof csrfToken).toBe('string')

    const response = await api.post('/api/auth/callback/credentials', {
      form: {
        csrfToken,
        email: 'admin@demo.com',
        password: 'admin123',
        callbackUrl: new URL('/dashboard', baseURL).href,
        json: 'true',
      },
    })
    expect(response.ok(), 'Admin credentials callback failed').toBeTruthy()
    const sessionResponse = await api.get('/api/auth/session')
    expect(sessionResponse.ok()).toBeTruthy()
    const session = await sessionResponse.json()
    expect(session.user?.email, 'Seeded admin must have a NextAuth session').toBe('admin@demo.com')
    expect(['owner', 'admin']).toContain(session.role)
    expect(typeof session.accessToken, 'Session must contain the backend token').toBe('string')

    await mkdir(dirname(ADMIN_STORAGE_STATE), { recursive: true })
    await api.storageState({ path: ADMIN_STORAGE_STATE })
  } finally {
    await api.dispose()
  }
}
