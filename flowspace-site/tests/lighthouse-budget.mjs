#!/usr/bin/env node
/**
 * S1.6 — assert a Lighthouse JSON report against flowspace-site/seo-budget.json.
 *
 *   npx -y lighthouse http://localhost:8099/ --only-categories=seo,best-practices,accessibility \
 *     --output=json --output-path=lh.json --chrome-flags="--headless=new --no-sandbox"
 *   node tests/lighthouse-budget.mjs lh.json
 *
 * Exit 1 when a gated category scores under its floor; report-only categories
 * are printed, never gated. No dependency: node:fs only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const budget = JSON.parse(readFileSync(join(HERE, '..', 'seo-budget.json'), 'utf8'));
const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node tests/lighthouse-budget.mjs <lighthouse-report.json>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(reportPath, 'utf8'));

let failed = false;
const rows = [];
for (const [category, floor] of Object.entries(budget.lighthouse)) {
  const score = report.categories[category]?.score;
  const ok = typeof score === 'number' && score >= floor;
  if (!ok) failed = true;
  rows.push(`${ok ? 'ok  ' : 'FAIL'} ${category.padEnd(16)} ${String(score)} (floor ${floor})`);
}
for (const category of budget.report_only ?? []) {
  rows.push(`info ${category.padEnd(16)} ${String(report.categories[category]?.score)} (report only)`);
}
const failing = Object.values(report.audits)
  .filter((a) => a.score !== null && a.score < 1 && ['binary', 'numeric'].includes(a.scoreDisplayMode))
  .map((a) => `  - ${a.id}: ${a.title}`);
console.log(`Lighthouse ${report.lighthouseVersion} on ${report.finalDisplayedUrl} (${report.configSettings.formFactor})`);
console.log(rows.join('\n'));
if (failing.length) console.log('Audits below 1:\n' + failing.join('\n'));
process.exit(failed ? 1 : 0);
