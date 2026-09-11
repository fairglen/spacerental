/**
 * Optional, standalone smoke test for flowspace-site.
 *
 * This is a manual pre-ship check, NOT part of the EspaçoHora CI pipeline —
 * it is not registered in frontend/playwright.config.ts or any GitHub
 * Actions workflow. Run it by hand before shipping a change to
 * flowspace-site/, if you want extra confidence beyond the manual checklist
 * in flowspace-site/README.md.
 *
 * How to run (from flowspace-site/tests/):
 *
 *   npm install
 *   npx playwright install chromium
 *   npx playwright test
 *
 * This has its own tiny package.json — deliberately not sharing frontend/'s
 * Playwright install, so this stays fully decoupled from the SaaS app.
 */
import { test, expect } from '@playwright/test';

test('hero copy renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('O teu');
  await expect(page.locator('h1')).toContainText('no teu tempo');
});

test('maps link points at the correct address', async ({ page }) => {
  await page.goto('/');
  const mapsLink = page.getByRole('link', { name: 'Abrir no Google Maps' });
  await expect(mapsLink).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=Rua+12+de+Julho+de+1997%2C+2745-841+Queluz+%E2%80%94+Massam%C3%A3'
  );
  await expect(mapsLink).toHaveAttribute('target', '_blank');
});

test('submitting the form shows the success banner without a real network call', async ({ page }) => {
  // Intercept the Apps Script call so this test never hits a real endpoint.
  // contact-form.js ships with the placeholder APPS_SCRIPT_URL until a real
  // deploy replaces it (see README), so route on that literal string — this
  // also covers the real '.../macros/s/.../exec' URL once deployed.
  await page.route(
    (url) => url.href.includes('PASTE_DEPLOYED_URL_HERE') || url.href.includes('/macros/s/'),
    (route) => route.fulfill({ status: 200, body: 'ok' })
  );

  await page.goto('/');
  await page.fill('#nome', 'Maria Silva');
  await page.fill('#email', 'maria@example.com');
  await page.selectOption('#especialidade', 'Psicologia');
  await page.selectOption('#interesse', 'Reserva avulsa');
  await page.click('#submitBtn');

  await expect(page.locator('#formSuccess')).toHaveClass(/is-visible/);
});
