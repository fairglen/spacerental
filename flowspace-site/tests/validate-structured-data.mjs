#!/usr/bin/env node
/**
 * S1.3 — validate the page's JSON-LD with structured-data-testing-tool, one
 * node at a time (the tool does not unpack an `@graph`): each node becomes
 * its own JSON-LD document in a temporary HTML file and is checked against
 * the tool's Google presets for its `@type`. Dev-only; nothing is committed
 * but this script. Run from flowspace-site/tests:
 *
 *   npm run validate:structured-data
 *
 * Exit 1 when any node fails a test; warnings are printed, not fatal.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
if (!block) throw new Error('index.html has no JSON-LD block');
const graph = JSON.parse(block.replace(/<\\\//g, '</'));
const dir = mkdtempSync(join(tmpdir(), 'flowspace-sdtt-'));

let failed = false;
for (const node of graph['@graph']) {
  const type = node['@type'];
  const doc = { '@context': graph['@context'], ...node };
  const file = join(dir, `${type}.html`);
  writeFileSync(file, `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(doc)}</script></head><body></body></html>`);
  let out = '';
  let ok = true;
  try {
    out = execFileSync('npx', ['-y', 'structured-data-testing-tool', '--file', file, '--schemas', type, '--presets', 'Google'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    ok = false;
    out = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  const summary = out.split('\n').filter((l) => /Passed|Warnings|Failed|✕|✗|⚠/.test(l)).map((l) => l.trim()).join(' · ');
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${type.padEnd(16)} ${summary}`);
  if (!ok) {
    failed = true;
    console.log(out.split('\n').filter((l) => !/npm warn/.test(l)).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
