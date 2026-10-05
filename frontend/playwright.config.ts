import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Logs in once as the seeded admin before any spec runs (see
  // global-setup.ts) so specs that don't test the sign-in form itself don't
  // each add their own hit to the backend's shared auth-tier rate limit.
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  // Every test owns its data (tests/e2e/fixtures.ts: its own room, customer
  // and day), so files and tests run in parallel against the e2e stack
  // (docker-compose.e2e.yml). Q41.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // CI writes a blob per shard for `merge-reports` (Q44) and annotates the
  // run; locally the list plus an HTML report to open on a failure.
  reporter: process.env.CI
    ? [['blob'], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
