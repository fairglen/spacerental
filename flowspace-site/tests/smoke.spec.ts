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

test('hero renders one headline with its emphasised word and a lede', async ({ page }) => {
  await page.goto('/');
  // Structure, not prose (W01): one H1 with an <em> inside it, followed by a lede.
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).not.toBeEmpty();
  await expect(h1.locator('em')).not.toBeEmpty();
  await expect(page.locator('.hero p.lede').first()).not.toBeEmpty();
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

type Page = import('@playwright/test').Page;

/**
 * Replace a constant's declaration in the served script, failing loudly if it
 * is not there. A silent no-op would leave the test running against the
 * unmodified file — still green, but proving nothing.
 */
function replaceOnce(source: string, needle: string | RegExp, replacement: string): string {
  const present = typeof needle === 'string' ? source.includes(needle) : needle.test(source);
  if (!present) {
    throw new Error(`contact-form.js no longer contains \`${needle}\` — update this test.`);
  }
  return source.replace(needle, replacement);
}

/**
 * The committed APPS_SCRIPT_URL is whatever is deployed right now — the
 * placeholder before the first deploy, the real /exec URL after it (B49: the
 * suite must not care which). To exercise a configured or an unconfigured
 * form we rewrite that constant in the served script rather than adding a
 * test-only override hook to the production file. The request deadline is
 * rewritten the same way, so the timeout test does not have to wait out the
 * real 15s.
 */
const APPS_SCRIPT_URL_DECLARATION = /const APPS_SCRIPT_URL = '[^']*';/;

test('the script rewrite still fails loudly when the constant is gone', () => {
  expect(() => replaceOnce('var somethingElse = 1;', APPS_SCRIPT_URL_DECLARATION, 'x')).toThrow(
    /no longer contains/
  );
  expect(replaceOnce("const APPS_SCRIPT_URL = 'https://x/exec';", APPS_SCRIPT_URL_DECLARATION, 'ok')).toBe('ok');
});

async function serveWithUrl(page: Page, url: string, opts: { timeoutMs?: number } = {}) {
  await page.route('**/assets/js/contact-form.js', async (route) => {
    const response = await route.fetch();
    let body = replaceOnce(
      await response.text(),
      APPS_SCRIPT_URL_DECLARATION,
      `const APPS_SCRIPT_URL = '${url}';`
    );
    if (opts.timeoutMs !== undefined) {
      body = replaceOnce(
        body,
        'const REQUEST_TIMEOUT_MS = 15000;',
        `const REQUEST_TIMEOUT_MS = ${opts.timeoutMs};`
      );
    }
    await route.fulfill({ body, contentType: 'application/javascript' });
  });
}

/**
 * Stub the Apps Script endpoint so no real request leaves the machine.
 *
 * The mock is shaped exactly like a real "Anyone"-access Web App reply — same
 * cross-origin URL, an Access-Control-Allow-Origin header, and a text/plain
 * JSON body — so the client runs its real read-and-parse path rather than a
 * short-circuited one.
 *
 * Honest limit: Playwright fulfils intercepted requests below the browser's
 * CORS check, so these mocks cannot *prove* the cross-origin read works. The
 * header is set because it is what production must send, not because omitting
 * it would fail here. What the mocks do prove is everything downstream of the
 * read: the branch on `result`, the per-code messages, and that nothing but a
 * parsed `result === 'success'` shows the success banner.
 *
 * Returns the content-type the client actually sent, so a test can pin that
 * the request stayed a CORS "simple request" (no preflight) — the property
 * that makes the readable response possible in the first place.
 */
function stubEndpoint(page: Page, body: string, status = 200) {
  const sentContentType: string[] = [];
  const routed = page.route(STUB_URL, async (route) => {
    sentContentType.push(route.request().headers()['content-type'] ?? '');
    await route.fulfill({
      status,
      headers: {
        'content-type': 'text/plain;charset=utf-8',
        'access-control-allow-origin': '*',
      },
      body,
    });
  });
  return { sentContentType, routed };
}

function stubJson(page: Page, payload: unknown, status = 200) {
  return stubEndpoint(page, JSON.stringify(payload), status);
}

async function stubConfiguredEndpoint(page: Page) {
  await serveWithUrl(page, STUB_URL);
  await stubJson(page, { result: 'success', message: 'Mensagem enviada com sucesso.' }).routed;
}

async function fillValidForm(page: Page) {
  await page.fill('#nome', 'Maria Silva');
  await page.fill('#email', 'maria@example.com');
  await page.selectOption('#especialidade', 'Psicologia');
  await page.selectOption('#interesse', 'Reserva avulsa');
}

test('a confirmed success response shows the success banner', async ({ page }) => {
  await serveWithUrl(page, STUB_URL);
  const stub = stubJson(page, { result: 'success', message: 'Mensagem enviada com sucesso.' });
  await stub.routed;

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formSuccess')).toHaveClass(/is-visible/);
  await expect(page.locator('#formError')).not.toHaveClass(/is-visible/);
  // Form cleared only on positive confirmation.
  await expect(page.locator('#nome')).toHaveValue('');

  // text/plain keeps this a CORS simple request; application/json would
  // trigger a preflight Apps Script cannot answer.
  expect(stub.sentContentType).toEqual(['text/plain;charset=utf-8']);
});

/**
 * The reason mode: 'no-cors' had to go. Under an opaque response every one of
 * these rejections looked exactly like a delivered message, and the visitor
 * was told "Mensagem enviada!" while the enquiry was dropped.
 */
const ERROR_CASES: Array<{ code: string; contains: string }> = [
  { code: 'rate_limited', contains: 'demasiados pedidos' },
  { code: 'invalid_email', contains: 'email indicado não foi aceite' },
  { code: 'invalid_option', contains: 'não é válido' },
  { code: 'missing_fields', contains: 'Faltam dados obrigatórios' },
  { code: 'send_failed', contains: 'não pôde ser entregue' },
  { code: 'invalid_payload', contains: 'não foi aceite' },
];

for (const { code, contains } of ERROR_CASES) {
  test(`a ${code} response shows its own message and never a success banner`, async ({ page }) => {
    await serveWithUrl(page, STUB_URL);
    await stubJson(page, { result: 'error', error: code }).routed;

    await page.goto('/');
    await fillValidForm(page);
    await page.click('#submitBtn');

    await expect(page.locator('#formError')).toHaveClass(/is-visible/);
    await expect(page.locator('#formError')).toContainText(contains);
    await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
    // The visitor's input survives a retryable rejection.
    await expect(page.locator('#nome')).toHaveValue('Maria Silva');
    await expect(page.locator('#submitBtn')).toBeEnabled();
  });
}

test('an unrecognised error code degrades to the neutral message, not success', async ({
  page,
}) => {
  await serveWithUrl(page, STUB_URL);
  await stubJson(page, { result: 'error', error: 'something_new' }).routed;

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formError')).toContainText('Não conseguimos confirmar o envio');
  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
});

test('an unreadable response body is reported as unconfirmed, not as success', async ({ page }) => {
  await serveWithUrl(page, STUB_URL);
  // What an Apps Script error page or a truncated proxy response looks like:
  // HTML, not JSON. Under no-cors this was indistinguishable from a send.
  await stubEndpoint(page, '<!doctype html><title>Error</title>', 500).routed;

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formError')).toHaveClass(/is-visible/);
  await expect(page.locator('#formError')).toContainText('Não conseguimos confirmar o envio');
  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
});

/**
 * Covers every way the read itself can fail: offline, DNS failure, and — the
 * one that matters most in production — the browser blocking the response
 * because the Web App was deployed with something other than "Anyone" access,
 * so it carries no Access-Control-Allow-Origin. All three reject fetch() and
 * land on the same branch.
 *
 * A missing CORS header cannot be mocked here: Playwright fulfils intercepted
 * requests below the browser's CORS check, so a fulfilled response is readable
 * whether or not it carries the header (verified — a fulfil with no ACAO is
 * still read successfully). route.abort() is the closest faithful stand-in for
 * the rejection a real blocked read produces. Actual cross-origin readability
 * is therefore only provable against a real deployment; see the README.
 */
test('a request whose response cannot be read is unconfirmed, not a hard failure', async ({
  page,
}) => {
  await serveWithUrl(page, STUB_URL);
  await page.route(STUB_URL, (route) => route.abort('connectionrefused'));

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formError')).toContainText('Não conseguimos confirmar o envio');
  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
});

/**
 * fetch() has no timeout of its own. A connection that opens and then stalls
 * never settles the promise, so before the AbortController the button stayed
 * on "A enviar..." indefinitely, disabled, with no way to retry and no
 * message — the worst outcome available, because the visitor cannot even tell
 * something went wrong. The deadline routes through the neutral "unconfirmed"
 * branch (the request may have been delivered), never through success.
 *
 * The route handler here never fulfils or aborts, which is what a stalled
 * connection looks like to the page. REQUEST_TIMEOUT_MS is rewritten down so
 * the test does not wait out the real 15 seconds.
 */
test('a stalled request times out as unconfirmed and re-enables the button', async ({ page }) => {
  await serveWithUrl(page, STUB_URL, { timeoutMs: 750 });
  await page.route(STUB_URL, () => {
    /* deliberately never settled */
  });

  await page.goto('/');
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#submitBtn')).toHaveText('A enviar...');

  await expect(page.locator('#formError')).toContainText('Não conseguimos confirmar o envio');
  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
  // The point of the deadline: the visitor can try again.
  await expect(page.locator('#submitBtn')).toBeEnabled();
  await expect(page.locator('#submitBtn')).toHaveText('Enviar mensagem');
  // Their input survives, so retrying does not mean retyping.
  await expect(page.locator('#nome')).toHaveValue('Maria Silva');
});

/**
 * The regression this suite exists for: an unconfigured APPS_SCRIPT_URL is a
 * relative URL, a 404 on it still *fulfills* fetch(), so the form used to
 * report "Mensagem enviada!" while nothing had been sent. Every visitor
 * enquiry would be lost silently.
 */
test('the placeholder Apps Script URL disables the form instead of faking success', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  // Served with the pre-deploy placeholder whatever the file holds today.
  await serveWithUrl(page, 'PASTE_DEPLOYED_URL_HERE');

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

/**
 * Checking only the origin accepted every one of these. They reach fetch(),
 * come back as an HTML error page, and used to be reported as a success — the
 * same bug as the placeholder, one typo away at any time.
 */
const MALFORMED_URLS = [
  'https://script.google.com/',
  'https://script.google.com/macros/s/TESTDEPLOYMENT/dev',
  'https://script.google.com/macros/TESTDEPLOYMENT/exec',
  'http://script.google.com/macros/s/TESTDEPLOYMENT/exec',
];

for (const url of MALFORMED_URLS) {
  test(`a malformed Web App URL (${url}) counts as unconfigured`, async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await serveWithUrl(page, url);

    await page.goto('/');

    await expect(page.locator('#submitBtn')).toBeDisabled();
    await expect(page.locator('#formError')).toContainText('temporariamente indisponível');

    await fillValidForm(page);
    await page.locator('#contactForm').evaluate((form: HTMLFormElement) =>
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    );

    await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
    expect(requests.filter((r) => r.includes('script.google.com'))).toHaveLength(0);
  });
}

/**
 * Mirrors CONFIG.ALLOWED_ESPECIALIDADE / ALLOWED_INTERESSE in Code.gs. The
 * server is still the real enforcement; this is the immediate feedback, and it
 * stops a tampered value burning a send slot only to come back as
 * invalid_option.
 */
test('a tampered select value is rejected client-side before any request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await stubConfiguredEndpoint(page);

  await page.goto('/');
  await fillValidForm(page);
  await page.locator('#especialidade').evaluate((el: HTMLSelectElement) => {
    const option = document.createElement('option');
    option.value = 'Cardiologia';
    el.appendChild(option);
    el.value = 'Cardiologia';
  });
  await page.click('#submitBtn');

  await expect(page.locator('#especialidade-error')).toHaveClass(/is-visible/);
  await expect(page.locator('#especialidade')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#formSuccess')).not.toHaveClass(/is-visible/);
  expect(requests.filter((r) => r.includes('script.google.com'))).toHaveLength(0);
});

test('field errors are wired to their controls for screen readers', async ({ page }) => {
  await stubConfiguredEndpoint(page);
  await page.goto('/');

  const nome = page.locator('#nome');
  await expect(nome).toHaveAttribute('aria-describedby', 'nome-error');
  await expect(nome).not.toHaveAttribute('aria-invalid', 'true');

  await page.click('#submitBtn');

  await expect(page.locator('#nome-error')).toHaveClass(/is-visible/);
  await expect(nome).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#especialidade')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#interesse')).toHaveAttribute('aria-invalid', 'true');

  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(nome).toHaveAttribute('aria-invalid', 'false');
});

test('the menu toggle announces the action it will perform', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');

  const toggle = page.locator('#navToggle');
  await expect(toggle).toHaveAttribute('aria-controls', 'navMobile');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Abrir menu');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveAttribute('aria-label', 'Fechar menu');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('aria-label', 'Abrir menu');
});
