import { defineConfig } from '@playwright/test';
import path from 'path';

// Standalone config for the optional flowspace-site smoke test. Deliberately
// separate from frontend/playwright.config.ts — this project has no
// dependency on the SaaS app or its test infrastructure.
export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8099',
  },
  webServer: {
    command: 'python3 -m http.server 8099',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:8099',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
