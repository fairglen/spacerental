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

const STUB_URL = 'https://script.google.com/macros/s/TESTDEPLOYMENT/exec';

/**
 * contact-form.js ships with the placeholder APPS_SCRIPT_URL until a human
 * pastes the deployed /exec URL in (see the README runbook). To exercise the
 * configured happy path we rewrite that constant in the served script rather
 * than adding a test-only override hook to the production file, then stub the
 * endpoint itself so no real request leaves the machine.
 */
async function stubConfiguredEndpoint(page: import('@playwright/test').Page) {
  await page.route('**/assets/js/contact-form.js', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      "const APPS_SCRIPT_URL = 'PASTE_DEPLOYED_URL_HERE';",
      `const APPS_SCRIPT_URL = '${STUB_URL}';`
    );
    await route.fulfill({ body, contentType: 'application/javascript' });
  });
  await page.route(STUB_URL, (route) => route.fulfill({ status: 200, body: 'ok' }));
}

async function fillValidForm(page: import('@playwright/test').Page) {
  await page.fill('#nome', 'Maria Silva');
  await page.fill('#email', 'maria@example.com');
  await page.selectOption('#especialidade', 'Psicologia');
  await page.selectOption('#interesse', 'Reserva avulsa');
}

test('submitting the form shows the success banner without a real network call', async ({ page }) => {
  await stubConfiguredEndpoint(page);

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formSuccess')).toHaveClass(/is-visible/);
  await expect(page.locator('#formError')).not.toHaveClass(/is-visible/);
});

/**
 * The regression this suite exists for: an unconfigured APPS_SCRIPT_URL is a
 * relative URL, a 404 on it still *fulfills* fetch(), and mode: 'no-cors'
 * makes the response opaque — so the form used to report "Mensagem enviada!"
 * while nothing had been sent. Every visitor enquiry would be lost silently.
 */
test('the placeholder Apps Script URL disables the form instead of faking success', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');

  const submit = page.locator('#submitBtn');
  await expect(submit).toBeDisabled();
  await expect(page.locator('#formError')).toHaveClass(/is-visible/);
  await expect(page.locator('#formError')).toContainText('temporariamente indisponível');

  await fillValidForm(page);
  await page.locator('#contactForm').evaluate((form: HTMLFormElement) =>
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
  );

  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
  expect(requests.filter((url) => url.includes('PASTE_DEPLOYED_URL_HERE'))).toHaveLength(0);
});
