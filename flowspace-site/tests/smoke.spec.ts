/**
 * Optional, standalone smoke test for flowspace-site.
 *
 * This is a manual pre-ship check, NOT part of the app's CI pipeline —
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

test('hero renders one headline with its emphasised half, a lede, two CTAs and four benefits', async ({ page }) => {
  await page.goto('/');
  // Structure, not prose (W01; the words are pinned to the app's catalog by
  // copy-parity.test.mjs): one H1 with an <em> inside it, a lede and a
  // support line, two calls to action, four benefits with a dot each (L02).
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).not.toBeEmpty();
  await expect(h1.locator('em')).not.toBeEmpty();
  await expect(page.locator('.hero p.lede')).toHaveCount(2);
  await expect(page.locator('.hero p.lede-support')).not.toBeEmpty();
  await expect(page.locator('.hero-actions a.btn')).toHaveCount(2);
  const benefits = page.locator('.hero-benefits li');
  await expect(benefits).toHaveCount(4);
  for (const item of await benefits.all()) {
    await expect(item).not.toBeEmpty();
    expect(await item.evaluate((el) => getComputedStyle(el, '::before').width)).toBe('8px');
  }
  // V04: the headline is the first thing in the hero; no pill above it.
  await expect(page.locator('.hero .hero-badge')).toHaveCount(0);
  await expect(page.locator('.hero-content > :first-child')).toHaveJSProperty('tagName', 'H1');
});

// L02: the hero carries the whole message; no "O espaço" section, and every
// nav and footer anchor still lands on a section that exists.
test('there is no "O espaço" section and every nav anchor resolves', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#espaco')).toHaveCount(0);
  await expect(page.locator('a[href="#espaco"]')).toHaveCount(0);
  const desktop = await page.locator('.nav-links a').allTextContents();
  expect(desktop.map((t) => t.trim())).toEqual(['Salas', 'Como funciona', 'Preços', 'FAQ', 'Onde estamos']);
  await expect(page.locator('.nav-actions a.btn')).toHaveText('Reservar sala');
  const anchors = await page.locator('.nav-links a, .nav-mobile a, .site-footer a[href^="#"]').evaluateAll((links) =>
    links.map((a) => a.getAttribute('href')!),
  );
  expect(anchors.length).toBeGreaterThan(0);
  for (const href of new Set(anchors)) {
    await expect(page.locator(href), `${href} has no section`).toHaveCount(1);
  }
});

// L03: the layout is the app's — its container, its columns at 1280px, one
// column at 390px with the same stacking order and no sideways scroll.
test('at 1280px the grids have the app\'s columns inside an 80rem container', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const columnsOf = (selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(await columnsOf('#salas .grid')).toBe(3);
  expect(await columnsOf('#como-funciona .grid')).toBe(4);
  expect(await columnsOf('#precos .grid')).toBe(3);
  expect(await columnsOf('.footer-grid')).toBe(3);
  const container = await page.locator('#salas .container').boundingBox();
  // max-w-7xl with lg:px-8 — the content box is 1280 − 2 × 32 = 1216 wide.
  expect(container!.width).toBe(1280);
  expect(await page.locator('#salas .container').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('32px');
  // Section heads are centred with the app's heading scale (text-3xl font-bold).
  const h2 = page.locator('#como-funciona .section-head h2');
  expect(await h2.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).fontWeight, getComputedStyle(el).textAlign])).toEqual(['30px', '700', 'center']);
  // Buttons: the app's rounded-lg, h-10 / h-12.
  expect(await page.locator('.hero-actions .btn-lg').first().evaluate((el) => [getComputedStyle(el).height, getComputedStyle(el).borderRadius])).toEqual(['48px', '8px']);
  // The room card: photos, then name and price on one line, then the tags.
  const card = page.locator('.room-card').first();
  const order = await card.evaluate((el) => Array.from(el.children).map((c) => c.className));
  // S1.4 adds the facts line between the name/price and the tags.
  expect(order).toEqual(['room-gallery', 'room-head', 'room-facts', 'tag-list']);
});

test('at 390px everything stacks in one column and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const columnsOf = (selector: string) =>
    page.locator(selector).evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  for (const selector of ['#salas .grid', '#como-funciona .grid', '#precos .grid', '.footer-grid', '.where-grid']) {
    expect(await columnsOf(selector), selector).toBe(1);
  }
  expect(await page.locator('#salas .container').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('16px');
  // The two CTAs stack, like the app's `flex-col sm:flex-row`.
  const [first, second] = await page.locator('.hero-actions .btn').all();
  expect((await second.boundingBox())!.y).toBeGreaterThan((await first.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // Sections in order: hero, rooms, how it works, pricing, where we are, footer.
  const tops = await Promise.all(
    ['.hero', '#salas', '#como-funciona', '#precos', '#localizacao', '.site-footer'].map(async (sel) => (await page.locator(sel).boundingBox())!.y),
  );
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
});

// The pricing section: three plans, each with a name, a price line, a
// description line and one CTA that lands on the contact form — structure,
// not prose (the numbers and the copy are the owner's; M02 changed the
// recurring card's line without touching this test).
test('the three pricing cards each carry a name, a price, a line and a CTA to the form', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('#precos .price-card');
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card.locator('h3')).not.toBeEmpty();
    await expect(card.locator('.price')).not.toBeEmpty();
    await expect(card.locator('.price-desc')).not.toBeEmpty();
    const cta = card.locator('a.btn');
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute('href', '#contacto');
  }
  await expect(page.locator('#precos .card.featured .card-badge')).toHaveCount(1);
});

// L02: on a phone the benefits wrap under the CTAs instead of overflowing.
test('below 768px the four benefits wrap and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero-benefits li')).toHaveCount(4);
  const rows = new Set((await page.locator('.hero-benefits li').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))));
  expect(rows.size).toBeGreaterThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// V02: every room card carries a photo gallery built from the manifest —
// structure and behaviour, never which pictures.
test('every room card has a photo gallery from the manifest, and no prose', async ({ page }) => {
  await page.goto('/');
  const cards = page.locator('.room-card');
  await expect(cards).toHaveCount(3);
  const manifest = await (await page.request.get('/assets/img/room-photos/manifest.json')).json();
  for (const card of await cards.all()) {
    const name = (await card.locator('h3').innerText()).trim();
    const slug = await card.locator('.room-gallery').getAttribute('data-room');
    const expected = manifest[slug!].length;
    const gallery = card.getByRole('region', { name: `${name} — fotografias` });
    await expect(gallery).toBeVisible();
    const images = gallery.getByRole('img');
    await expect(images).toHaveCount(expected);
    for (let i = 0; i < expected; i++) {
      const image = images.nth(i);
      await expect(image).toHaveAttribute('alt', `${name} — fotografia ${i + 1} de ${expected}`);
      await expect(image).toHaveAttribute('width', /\d+/);
      await expect(image).toHaveAttribute('height', /\d+/);
      await expect(image).toHaveAttribute('loading', i === 0 ? 'eager' : 'lazy');
      await expect(image).toHaveAttribute('src', /assets\/img\/room-photos\//);
    }
    await expect(gallery.getByRole('tablist', { name: 'Escolher fotografia' }).getByRole('tab')).toHaveCount(expected);
    // Photos instead of descriptions (V03): name, price and tags stay.
    await expect(card.locator('p.desc')).toHaveCount(0);
    await expect(card.locator('.room-price')).not.toBeEmpty();
    await expect(card.locator('.tag-list .tag').first()).toBeVisible();
  }
});

test('"next" advances the gallery, the dots and the announcer follow, and the arrow keys work', async ({ page }) => {
  await page.goto('/');
  const gallery = page.locator('.room-card').first().getByRole('region', { name: /fotografias$/ });
  await expect(gallery).toBeVisible();
  const dots = gallery.getByRole('tab');
  const announcer = gallery.locator('[data-gallery-announcer]');
  await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(announcer).toBeEmpty(); // it never speaks unprompted
  await expect(gallery.getByRole('button', { name: 'Fotografia anterior' })).toBeHidden(); // disabled at the start

  await gallery.getByRole('button', { name: 'Fotografia seguinte' }).click();
  await expect(dots.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(announcer).toHaveText('Fotografia 2 de 4');
  await expect(gallery.getByRole('group', { name: 'Fotografia 2 de 4' })).toBeInViewport();

  await gallery.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(dots.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(announcer).toHaveText('Fotografia 1 de 4');

  await dots.nth(3).click();
  await expect(dots.nth(3)).toHaveAttribute('aria-selected', 'true');
  await expect(gallery.getByRole('button', { name: 'Fotografia seguinte' })).toBeHidden(); // disabled at the end
});

test('"Como chegar" points at the correct address', async ({ page }) => {
  await page.goto('/');
  const mapsLink = page.locator('#localizacao').getByRole('link', { name: 'Como chegar' });
  await expect(mapsLink).toHaveAttribute(
    'href',
    'https://www.google.com/maps/search/?api=1&query=Rua+12+de+Julho+de+1997%2C+2745-841+Queluz+%E2%80%94+Massam%C3%A3'
  );
  await expect(mapsLink).toHaveAttribute('target', '_blank');
});

// V07, reworked in L04: one "Onde estamos" section — hours, email and the
// address one line each with an icon, the directions button under the
// address, no labels or divider, and a map that is on the page from the
// start; the contact form still below it.
test('"Onde estamos" lists hours, email and address with icons, then "Como chegar"; the map is there without a click', async ({ page }) => {
  await page.goto('/');
  const where = page.locator('#localizacao');
  await expect(where.getByRole('heading', { level: 2 })).toHaveText('Onde estamos');
  // No venue name line under the heading (M03): the lines list follows it directly.
  await expect(where.locator('.where-name')).toHaveCount(0);
  expect(await where.getByRole('heading', { level: 2 }).evaluate((el) => el.nextElementSibling!.className)).toBe('where-lines');
  const lines = where.locator('.where-lines > li');
  await expect(lines).toHaveCount(3);
  await expect(lines.nth(0)).toHaveText('Todos os dias, 08:00–22:00');
  await expect(lines.nth(1).getByRole('link', { name: 'geral@flowspace.pt' })).toHaveAttribute('href', 'mailto:geral@flowspace.pt');
  await expect(lines.nth(2).locator('.where-address')).toContainText('2745-841 Queluz');
  for (const line of await lines.all()) await expect(line.locator('svg')).toHaveCount(1);
  await expect(where.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(where.locator('.where-divider, .where-label, hr')).toHaveCount(0);
  await expect(where.getByText(/^(Contacto|Horário|Morada)$/)).toHaveCount(0);
  // "Como chegar" is the first thing after the address.
  const directions = where.getByRole('link', { name: 'Como chegar' });
  expect(await directions.evaluate((el) => el.previousElementSibling!.className)).toBe('where-lines');
  // Both anchors resolve: the section, and the form below it.
  await expect(page.locator('#contacto')).toHaveCount(1);
  await expect(page.locator('#contacto')).toContainText('Envie-nos uma mensagem');
  await expect(page.locator('#contacto form#contactForm')).toHaveCount(1);
  await expect(page.locator('#localizacao #contacto')).toHaveCount(1);

  // The map is mounted on load — no button, no placeholder, no privacy
  // sentence — as a lazy, referrer-free frame centred on the pin with the
  // frame's shape, and the full map offered under it.
  await expect(where.getByRole('button', { name: 'Ver mapa' })).toHaveCount(0);
  await expect(where.locator('.where-map-placeholder')).toHaveCount(0);
  await expect(where).not.toContainText('só é carregado quando o pedir');
  const map = where.locator('iframe');
  await expect(map).toHaveCount(1);
  await expect(map).toHaveAttribute('src', /openstreetmap\.org\/export\/embed\.html/);
  await expect(map).toHaveAttribute('loading', 'lazy');
  await expect(map).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(map).toHaveAttribute('title', 'Mapa da localização');
  const src = new URL((await map.getAttribute('src'))!);
  expect(src.searchParams.get('marker')).toBe('38.755723,-9.279799');
  const [west, south, east, north] = src.searchParams.get('bbox')!.split(',').map(Number);
  expect((west + east) / 2).toBeCloseTo(-9.279799, 5);
  expect((south + north) / 2).toBeCloseTo(38.755723, 5);
  const frame = await where.locator('.where-map-frame').boundingBox();
  expect(frame!.height).toBeGreaterThanOrEqual(280);
  // The box has the frame's shape on the ground, so the pin is centred. The
  // frame is measured when the script runs, before the web font settles the
  // words column's height, so the shapes agree to within a few percent.
  const ratio = ((east - west) * Math.cos((38.755723 * Math.PI) / 180)) / (north - south);
  expect(Math.abs(ratio / (frame!.width / frame!.height) - 1)).toBeLessThan(0.1);
  await expect(where.getByRole('link', { name: 'Abrir o mapa completo' })).toHaveAttribute('href', /openstreetmap\.org\/\?mlat=38\.755723/);
});

test('below 768px "Onde estamos" stacks, the words first and the map under them at 16:10, at least 240px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const words = await page.locator('#localizacao .where-details').boundingBox();
  const map = await page.locator('#localizacao .where-map').boundingBox();
  expect(map!.y).toBeGreaterThanOrEqual(words!.y + words!.height);
  expect(Math.abs(map!.x - words!.x)).toBeLessThan(2);
  const frame = await page.locator('#localizacao .where-map-frame').boundingBox();
  expect(frame!.height).toBeGreaterThanOrEqual(240);
  expect(frame!.width / frame!.height).toBeLessThanOrEqual(1.6 + 0.01);
});

test('the privacy page says the map is an OpenStreetMap embed', async ({ page }) => {
  await page.goto('/privacidade.html');
  await expect(page.locator('main')).toContainText('OpenStreetMap');
  await expect(page.locator('main')).toContainText('openstreetmap.org');
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
  await page.selectOption('#interesse', 'Reserva avulsa');
}

// M01: the form no longer asks for a specialty. The client accepts the
// submission without it and the payload simply carries no such key — the
// deployed Code.gs (redeployed first) takes both shapes.
test('a submission without a specialty passes validation and posts a payload with no especialidade key', async ({ page }) => {
  await serveWithUrl(page, STUB_URL);
  const bodies: string[] = [];
  await page.route(STUB_URL, async (route) => {
    bodies.push(route.request().postData() ?? '');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/plain;charset=utf-8', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ result: 'success', message: 'Mensagem enviada com sucesso.' }),
    });
  });

  await page.goto('/');
  await expect(page.locator('#especialidade, [name="especialidade"], #especialidade-error')).toHaveCount(0);
  await fillValidForm(page);
  await page.click('#submitBtn');

  await expect(page.locator('#formSuccess')).toHaveClass(/is-visible/);
  await expect(page.locator('.field-error.is-visible')).toHaveCount(0);
  expect(bodies).toHaveLength(1);
  const payload = JSON.parse(bodies[0]);
  expect(payload).not.toHaveProperty('especialidade');
  expect(Object.keys(payload).sort()).toEqual(['email', 'interesse', 'mensagem', 'nome', 'timestamp']);
  expect(payload.interesse).toBe('Reserva avulsa');
});

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
 * Mirrors CONFIG.ALLOWED_INTERESSE in Code.gs. The server is still the real
 * enforcement; this is the immediate feedback, and it stops a tampered value
 * burning a send slot only to come back as invalid_option.
 */
test('a tampered select value is rejected client-side before any request', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await stubConfiguredEndpoint(page);

  await page.goto('/');
  await fillValidForm(page);
  await page.locator('#interesse').evaluate((el: HTMLSelectElement) => {
    const option = document.createElement('option');
    option.value = 'Compra do edifício';
    el.appendChild(option);
    el.value = 'Compra do edifício';
  });
  await page.click('#submitBtn');

  await expect(page.locator('#interesse-error')).toHaveClass(/is-visible/);
  await expect(page.locator('#interesse')).toHaveAttribute('aria-invalid', 'true');
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

// B50: the brand set replaces the text wordmark and the old favicon.
test('the header carries the mark alone (40px, decorative inside the named link), the footer the white lockup, and the head has the icons', async ({ page }) => {
  await page.goto('/');
  // B51: the link is named; the drawing inside it is decorative.
  const link = page.locator('.site-nav a.wordmark');
  await expect(link).toHaveAttribute('aria-label', 'FlowSpace');
  const header = link.locator('svg.brand-wordmark');
  await expect(header).toHaveCount(1);
  await expect(header).toHaveAttribute('aria-hidden', 'true');
  expect(await header.evaluate((el) => [el.getAttribute('width'), el.getAttribute('height')])).toEqual(['103', '22']);
  expect(await header.evaluate((el) => el.querySelector('use')?.getAttribute('href'))).toBe('#brand-wordmark');
  expect((await header.boundingBox())!.height).toBe(22);
  // The mark on its own never appears under 36px: there is no mark in the header.
  await expect(link.locator('use[href="#brand-mark"], use[href*="lockup"]')).toHaveCount(0);
  // The symbols the <use>s reference are inlined once, from the brand files.
  const symbols = page.locator('body > svg[aria-hidden="true"] symbol');
  await expect(symbols).toHaveCount(2);
  expect(await symbols.evaluateAll((els) => els.map((el) => el.id))).toEqual(['brand-mark', 'brand-wordmark']);
  const markFile = await (await page.request.get('/assets/img/brand/logo-mark.svg')).text();
  expect(markFile).toContain(await symbols.nth(0).evaluate((el) => el.querySelector('path')!.getAttribute('d')));
  // The header stays 64px tall and the wordmark takes the link's colour.
  expect(await page.locator('.site-nav .container').evaluate((el) => el.getBoundingClientRect().height)).toBe(64);
  expect(await header.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(61, 122, 94)');
  const footer = page.locator('.site-footer .footer-wordmark .brand-lockup');
  await expect(footer).toHaveCount(1);
  expect(await footer.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
  // No text wordmark left.
  await expect(page.locator('.site-nav .wordmark')).toHaveText('');
  // Icons, manifest-style metadata.
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', 'assets/img/brand/favicon.svg');
  await expect(page.locator('link[rel="icon"][sizes="32x32"]')).toHaveAttribute('href', 'assets/img/brand/favicon-32.png');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', 'assets/img/brand/apple-touch-icon.png');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#3D7A5E');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://flowspace.pt/assets/img/brand/og-image.png');
  // Every referenced brand file is actually served.
  for (const path of ['assets/img/brand/logo-horizontal.svg', 'assets/img/brand/favicon.svg', 'assets/img/brand/favicon-32.png', 'assets/img/brand/apple-touch-icon.png', 'assets/img/brand/og-image.png']) {
    const res = await page.request.get(`/${path}`);
    expect(res.status(), path).toBe(200);
  }
});

test('at 390 and 768 the header mark is 40px tall, in the bar, left of the hamburger (B58)', async ({ page }) => {
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    const svg = page.locator('.site-nav .wordmark svg.brand-mark');
    const box = (await svg.boundingBox())!;
    expect(box.width, `${width}px`).toBeLessThan(width * 0.6);
    expect(box.height, `${width}px`).toBe(40);
    expect(box.width, `${width}px`).toBeGreaterThan(0);
    const bar = (await page.locator('.site-nav .container').boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(bar.y);
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 1);
    if (width < 768) {
      const toggle = (await page.locator('.nav-toggle').boundingBox())!;
      expect(toggle.x).toBeGreaterThan(box.x + box.width);
    }
  }
});

/** The drawn content's box in the svg's user units, from the <use> itself. */
const drawnBox = (svg: import('@playwright/test').Locator) =>
  svg.evaluate((el) => {
    const b = (el.querySelector('use') as SVGGraphicsElement).getBBox();
    const [, , w, h] = el.getAttribute('viewBox')!.split(' ').map(Number);
    return { x: b.x, y: b.y, w: b.width, h: b.height, vw: w, vh: h };
  });
/**
 * B57: the drawing lies inside the viewBox and fills it. The brand files'
 * own viewBoxes carry a few units of padding around the path (8 on the
 * mark), so "fills" is ≥ 95 % of each side; before the fix the mark's box
 * started at −274 and the wordmark's at −147 — entirely outside.
 */
async function expectDrawnInsideItsBox(svg: import('@playwright/test').Locator, label: string) {
  const d = await drawnBox(svg);
  expect(d.x, `${label} bbox x`).toBeGreaterThanOrEqual(-1);
  expect(d.y, `${label} bbox y`).toBeGreaterThanOrEqual(-1);
  expect(d.x + d.w, `${label} bbox right`).toBeLessThanOrEqual(d.vw + 1);
  expect(d.y + d.h, `${label} bbox bottom`).toBeLessThanOrEqual(d.vh + 1);
  expect(d.w, `${label} bbox w`).toBeGreaterThanOrEqual(0.95 * d.vw);
  expect(d.h, `${label} bbox h`).toBeGreaterThanOrEqual(0.95 * d.vh);
}
const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('B57: at 1280/1440/1920 every brand drawing fills its viewBox and the hero mark sits on the centre of its disc', async ({ page }) => {
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const [name, svg] of [['header', page.locator('.site-nav svg.brand-mark')], ['hero mark', page.locator('svg.hero-mark-svg')]] as const) {
      await expectDrawnInsideItsBox(svg, `${width}px ${name}`);
    }
    const column = page.locator('.hero-mark');
    const mark = centre((await column.locator('svg').boundingBox())!);
    const disc = await column.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el, '::before');
      return { w: parseFloat(s.width), cx: r.left + r.width / 2, cy: r.top + r.height / 2 + window.scrollY };
    });
    expect(disc.w).toBe(460);
    expect(Math.abs(mark.x - disc.cx), `${width}px mark/disc x`).toBeLessThan(2);
    expect(Math.abs(mark.y - disc.cy), `${width}px mark/disc y`).toBeLessThan(2);
  }
});

test('B59: "FlowSpace" sits above the headline on one line at 390/768/1280/1440; the headline is unchanged', async ({ page }) => {
  for (const width of [390, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const brand = page.locator('.hero-content > p.hero-brand');
    await expect(brand).toHaveText('FlowSpace');
    const h1 = page.locator('.hero h1');
    const [b, h] = [(await brand.boundingBox())!, (await h1.boundingBox())!];
    expect(b.y + b.height, `${width}px above the h1`).toBeLessThanOrEqual(h.y + 1);
    expect(await brand.evaluate((el) => el.getClientRects().length), `${width}px one line`).toBe(1);
    expect(await brand.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('800');
    expect(await brand.locator('span').evaluate((el) => getComputedStyle(el).color)).toBe('rgb(61, 122, 94)');
    await expect(h1).not.toContainText('FlowSpace');
  }
});

// B51: the brand mark is the hero illustration from 1024px and a watermark
// under it — the same numbers as the app's Hero.tsx.
const WCAG = {
  // sRGB channel → linear; relative luminance; contrast ratio (WCAG 2.1).
  luminance([r, g, b]: number[]) {
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  },
  contrast(a: number[], b: number[]) {
    const [l1, l2] = [WCAG.luminance(a), WCAG.luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  },
  parse(css: string): number[] { return css.match(/[\d.]+/g)!.slice(0, 3).map(Number); },
  over(top: number[], alpha: number, under: number[]) { return top.map((c, i) => Math.round(alpha * c + (1 - alpha) * under[i])); },
};

test('at 1440 the hero shows the mark centred in the right column over its disc, and no watermark', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const grid = page.locator('.hero-grid');
  expect((await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns)).split(' ')).toHaveLength(2);
  expect(await grid.evaluate((el) => getComputedStyle(el).columnGap)).toBe('32px');
  // The text column keeps its 48rem; the headline is still first in it.
  expect((await page.locator('.hero-content').boundingBox())!.width).toBe(768);
  await expect(page.locator('.hero-content > :first-child')).toHaveJSProperty('tagName', 'H1');
  const column = page.locator('.hero-mark');
  await expect(column).toBeVisible();
  await expect(column).toHaveAttribute('aria-hidden', 'true');
  const mark = column.locator('svg.hero-mark-svg');
  await expect(mark).toHaveAttribute('width', '400');
  await expect(mark).toHaveAttribute('height', '365');
  await expect(mark.locator('use')).toHaveAttribute('href', '#brand-mark');
  const [columnBox, markBox] = [(await column.boundingBox())!, (await mark.boundingBox())!];
  expect(markBox.width).toBe(400);
  expect(columnBox.height).toBeGreaterThanOrEqual(420);
  expect(Math.abs(columnBox.x + columnBox.width / 2 - (markBox.x + markBox.width / 2))).toBeLessThan(1);
  expect(Math.abs(columnBox.y + columnBox.height / 2 - (markBox.y + markBox.height / 2))).toBeLessThan(1);
  expect(await mark.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(61, 122, 94)');
  // The disc: 460px, round, a radial gradient, no pointer, centred on the mark.
  const disc = await column.evaluate((el) => { const s = getComputedStyle(el, '::before'); return [s.width, s.height, s.borderRadius, s.pointerEvents, s.backgroundImage]; });
  expect(disc.slice(0, 4)).toEqual(['460px', '460px', '50%', 'none']);
  expect(disc[4]).toContain('radial-gradient');
  expect(disc[4]).toContain('rgba(168, 213, 186, 0.55)');
  await expect(page.locator('.hero-watermark')).toBeHidden();
  await expect(page.locator('.hero-glow')).toHaveCount(1);
});

test('at 390 the watermark bleeds off the bottom-right behind the text, the mark column is gone and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero-mark')).toBeHidden();
  const watermark = page.locator('.hero-watermark');
  await expect(watermark).toHaveAttribute('aria-hidden', 'true');
  await expect(watermark).toHaveAttribute('width', '440');
  await expect(watermark.locator('use')).toHaveAttribute('href', '#brand-mark');
  const style = await watermark.evaluate((el) => { const s = getComputedStyle(el); return [s.display, s.position, s.right, s.bottom, s.width, s.opacity, s.pointerEvents, s.color]; });
  expect(style).toEqual(['block', 'absolute', '-112px', '-48px', '440px', '0.08', 'none', 'rgb(61, 122, 94)']);
  expect(await page.locator('.hero').evaluate((el) => getComputedStyle(el).getPropertyValue('--hero-watermark-opacity').trim())).toBe('0.08');
  // It bleeds past the hero's box and the hero clips it; the words are positioned above it.
  const [hero, wm] = [(await page.locator('.hero').boundingBox())!, (await watermark.boundingBox())!];
  expect(wm.x + wm.width).toBeGreaterThan(hero.x + hero.width);
  expect(wm.y + wm.height).toBeGreaterThan(hero.y + hero.height);
  expect(await page.locator('.hero').evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  expect(await page.locator('.hero-content').evaluate((el) => getComputedStyle(el).position)).toBe('relative');
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBe(390);
  // Everything in the hero still answers to the pointer, not the watermark.
  for (const el of await page.locator('.hero-actions a.btn, .hero-benefits li').all()) {
    const box = (await el.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.hero-watermark') !== null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe(false);
  }
});

test('at 390 the text over the watermark keeps its contrast', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // The hero's background is a gradient whose darkest stop is the bottom-right —
  // where the watermark sits — so the worst case is that stop composited over
  // the page, then the mark's colour at the watermark's opacity over that.
  const body = WCAG.parse(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
  const darkest = WCAG.over([168, 213, 186], 0.3, body); // `to-primary-light/30`
  const opacity = Number(await page.locator('.hero-watermark').evaluate((el) => getComputedStyle(el).opacity));
  const primary = WCAG.parse(await page.locator('.hero-watermark').evaluate((el) => getComputedStyle(el).color));
  const overWatermark = WCAG.over(primary, opacity, darkest);
  const wm = (await page.locator('.hero-watermark').boundingBox())!;
  const results: Record<string, { plain: number; watermark: number }> = {};
  for (const [name, selector] of [['h1', '.hero h1'], ['lede', '.hero p.lede:not(.lede-support)'], ['support', '.hero p.lede-support'], ['primary button', '.hero-actions a.btn-primary'], ['outline button', '.hero-actions a.btn-outline'], ['benefit', '.hero-benefits li']]) {
    const el = page.locator(selector).first();
    const [color, bg] = await el.evaluate((node) => { const s = getComputedStyle(node); return [s.color, s.backgroundColor]; });
    const box = (await el.boundingBox())!;
    const intersects = box.x < wm.x + wm.width && box.x + box.width > wm.x && box.y < wm.y + wm.height && box.y + box.height > wm.y;
    const ownBackground = !/rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? WCAG.parse(bg) : null;
    const plain = WCAG.contrast(WCAG.parse(color), ownBackground ?? darkest);
    const watermark = WCAG.contrast(WCAG.parse(color), ownBackground ?? (intersects ? overWatermark : darkest));
    results[name] = { plain: Math.round(plain * 100) / 100, watermark: Math.round(watermark * 100) / 100 };
  }
  console.log('hero contrast at 390 (plain → over the watermark):', JSON.stringify(results));
  // The headline and the filled button clear AA over the watermark.
  expect(results.h1.watermark).toBeGreaterThanOrEqual(4.5);
  expect(results['primary button'].watermark).toBeGreaterThanOrEqual(4.5);
  // The watermark costs no element more than a fraction of a step, and
  // nothing that clears AA without it falls under AA with it.
  for (const [name, r] of Object.entries(results)) {
    expect(r.plain - r.watermark, name).toBeLessThan(0.5);
    if (r.plain >= 4.5) expect(r.watermark, name).toBeGreaterThanOrEqual(4.5);
  }
});

test('the hero shifts nothing while it loads (CLS 0) at 1440 and 390', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    const shifts = await page.evaluate(() => new Promise<number>((resolve) => {
      const hero = document.querySelector('.hero')!;
      let sum = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number; sources?: { node?: Node }[] })[]) {
          if (entry.hadRecentInput) continue;
          const inHero = (entry.sources ?? []).some((s) => s.node && hero.contains(s.node));
          if (inHero) sum += entry.value;
        }
      });
      observer.observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => { observer.disconnect(); resolve(sum); }, 600);
    }));
    expect(shifts, `${width}px`).toBe(0);
  }
});

// S1.1/S1.4: what a crawler or a visitor without JavaScript gets — the raw
// HTML, not the DOM the scripts build.
test('the raw HTML carries the title, one h1, three room photos with alt text, the FAQ and the address', async ({ page }) => {
  const html = await (await page.request.get('/')).text();
  expect(html).toMatch(/<title>Salas para terapia e consultas à hora em Queluz · FlowSpace<\/title>/);
  expect(html.match(/<h1>/g)).toHaveLength(1);
  const photos = html.match(/<img [^>]*src="assets\/img\/room-photos\/[^"]+"[^>]*alt="[^"]+"[^>]*>/g) ?? [];
  expect(photos.length).toBeGreaterThanOrEqual(3);
  expect(photos[0]).toContain('loading="eager"');
  expect(photos[1]).toContain('loading="lazy"');
  expect(html).toContain('<details class="faq-item"');
  expect(html).toContain('Posso cancelar uma reserva?');
  expect(html).toContain('Rua 12 de Julho de 1997 5, Loja 1');
  expect(html).toContain('<link rel="canonical" href="https://flowspace.pt/" />');
  expect(html).toContain('<meta name="robots" content="index, follow, max-image-preview:large" />');
  expect(html).toContain('<script type="application/ld+json">');
});

test('the static first photo gives way to the carousel, so no photo is shown twice', async ({ page }) => {
  await page.goto('/');
  const gallery = page.locator('.room-card').first().locator('.room-gallery');
  await expect(gallery.getByRole('tablist')).toBeVisible();
  // Only the carousel's slides remain — the HTML's <img> was removed by the script.
  await expect(gallery.locator(':scope > img')).toHaveCount(0);
  await expect(gallery.locator('.room-gallery-slide img')).toHaveCount(4);
});

test('the FAQ section sits between prices and the location, opens natively and is linked from nav and footer', async ({ page }) => {
  await page.goto('/');
  const faq = page.locator('#faq');
  await expect(faq.getByRole('heading', { level: 2 })).toHaveText('Perguntas frequentes');
  const sections = await page.locator('main > section').evaluateAll((els) => els.map((el) => el.id));
  expect(sections.indexOf('faq')).toBe(sections.indexOf('precos') + 1);
  expect(sections.indexOf('localizacao')).toBe(sections.indexOf('faq') + 1);
  const items = faq.locator('details.faq-item');
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(8);
  expect(count).toBeLessThanOrEqual(10);
  const first = items.first();
  await expect(first).not.toHaveAttribute('open', '');
  await first.locator('summary').click();
  await expect(first).toHaveAttribute('open', '');
  await expect(first.locator('p')).toBeVisible();
  await expect(page.locator('.nav-links a[href="#faq"]')).toHaveText('FAQ');
  await expect(page.locator('.site-footer a[href="#faq"]')).toHaveText('Perguntas frequentes');
});

test('the skip link is the first focusable element and lands on main', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.locator('a.skip-link');
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText('Saltar para o conteúdo');
  await expect(skip).toBeInViewport();
  await expect(page.locator('main#main')).toHaveCount(1);
  await expect(page.locator('nav.site-nav')).toHaveAttribute('aria-label', 'Principal');
});

test('the JSON-LD parses and quotes the prices and hours the page shows', async ({ page }) => {
  await page.goto('/');
  const graph = await page.locator('script[type="application/ld+json"]').evaluate((el) => JSON.parse(el.textContent!));
  const business = graph['@graph'].find((n: { '@type': string }) => n['@type'] === 'LocalBusiness');
  expect(business.openingHoursSpecification[0]).toMatchObject({ opens: '08:00', closes: '22:00' });
  const prices = business.makesOffer.filter((o: { priceSpecification?: unknown }) => o.priceSpecification).map((o: { priceSpecification: { price: number } }) => o.priceSpecification.price);
  const shown = (await page.locator('.room-card .room-price').allInnerTexts()).map((t) => Number(t.replace(/€.*$/s, '')));
  expect(prices).toEqual(shown);
  const faq = graph['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage');
  expect(faq.mainEntity.map((q: { name: string }) => q.name)).toEqual(await page.locator('#faq summary').allInnerTexts());
});

test('the privacy page is canonical to itself and not indexed', async ({ page }) => {
  const html = await (await page.request.get('/privacidade.html')).text();
  expect(html).toContain('<link rel="canonical" href="https://flowspace.pt/privacidade.html" />');
  expect(html).toContain('<meta name="robots" content="noindex, follow" />');
});
