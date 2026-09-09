import { test, expect } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from './global-setup'

// Pre-authenticated via global-setup.ts, not a real sign-in per test — see
// that file (and TODO.md T3) for why: repeated logins through the real form
// share the backend's auth-tier rate limit with every other spec, and the
// resulting 429 used to masquerade as a wrong-password error, hanging
// `waitForURL('**/dashboard')` until timeout. These tests only need to *be*
// an admin, not exercise the login UI, so they skip it.
test.use({ storageState: ADMIN_STORAGE_STATE })

test.describe('Admin', () => {
  test('admin dashboard loads', async ({ page }) => {
    await page.goto('/admin')
    // 15s: first visit pays for the dev server's cold compile of /admin.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15000 })
  })

  test('admin can view spaces list', async ({ page }) => {
    await page.goto('/admin/spaces')
    await expect(page.getByRole('heading', { name: 'Espaços' })).toBeVisible({ timeout: 15000 })
  })
})
