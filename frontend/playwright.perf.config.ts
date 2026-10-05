// The `perf` project (P1.1): tests/perf/vitals.spec.ts against the e2e stack.
// A separate config, so `npx playwright test` (the e2e suite, sharded in CI)
// never runs the measurements, and `npm run perf:web` runs nothing else.
import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  testDir: './tests/perf',
  // Measurements are sequential by nature: a parallel worker would share the
  // stack's CPU and network with the page being timed.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
  projects: [{ name: 'perf', use: { ...devices['Desktop Chrome'] } }],
})
