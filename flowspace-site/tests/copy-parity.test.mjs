/**
 * L02: the static site's hero is the app's hero, character for character.
 *
 * The two sites are edited by hand and have drifted before; this pins the
 * hero's headline, lede, support line and four benefits in
 * flowspace-site/index.html to the app's Portuguese catalog
 * (frontend/lib/i18n/pt.json), so a change to one without the other fails
 * here instead of being noticed on the site. Run with:
 *
 *     node --test flowspace-site/tests/copy-parity.test.mjs
 *
 * No package is needed: node:test ships with Node.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const catalog = JSON.parse(readFileSync(join(HERE, '..', '..', 'frontend', 'lib', 'i18n', 'pt.json'), 'utf8'));

const hero = html.match(/<header id="top" class="hero">([\s\S]*?)<\/header>/)?.[1];
assert.ok(hero, 'index.html no longer has the hero header — update this test');

/** The text of the first element matching the pattern, whitespace collapsed, tags stripped. */
function textOf(source, pattern) {
  const match = source.match(pattern);
  assert.ok(match, `hero no longer contains ${pattern} — update this test`);
  return match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

test('the headline is the catalog headline, with the emphasis on its second half', () => {
  const h1 = textOf(hero, /<h1>([\s\S]*?)<\/h1>/);
  assert.equal(h1, `${catalog.hero.headline_start} ${catalog.hero.headline_highlight}`);
  assert.equal(textOf(hero, /<em>([\s\S]*?)<\/em>/), catalog.hero.headline_highlight);
});

test('the lede and the support line equal hero.description and hero.support', () => {
  assert.equal(textOf(hero, /<p class="lede">([\s\S]*?)<\/p>/), catalog.hero.description);
  assert.equal(textOf(hero, /<p class="lede lede-support">([\s\S]*?)<\/p>/), catalog.hero.support);
});

test('the four benefits are the catalog benefits, in the catalog order', () => {
  const list = textOf(hero, /<ul class="hero-benefits">([\s\S]*?)<\/ul>/);
  const items = [...hero.match(/<ul class="hero-benefits">([\s\S]*?)<\/ul>/)[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) =>
    m[1].replace(/\s+/g, ' ').trim(),
  );
  assert.ok(list.length > 0);
  assert.deepEqual(items, [
    catalog.hero.benefit_booking,
    catalog.hero.benefit_1,
    catalog.hero.benefit_2,
    catalog.hero.benefit_3,
  ]);
});

test('neither site keeps an "O espaço" section', () => {
  assert.equal(catalog.theSpace, undefined);
  assert.doesNotMatch(html, /id="espaco"|#espaco/);
});
