// P1.1 — the measurement harness. It records what the browser did on a cold
// load of each key page against the e2e stack (production build), so every
// optimisation in the P-series has a "before" and an "after" taken the same
// way: navigation timing, FCP, LCP, requests by type, bytes on the wire
// (encoded, as the network saw them) and the API waterfall. Results land in
// perf-results/<page>.json and perf-results/summary.md. Budgets are read from
// perf-budget.json when it exists (P2.4) and asserted; without it the run
// only measures. Run with `npm run perf:web` (playwright.perf.config.ts) —
// never part of the default e2e run.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ADMIN_STORAGE_STATE } from '../e2e/global-setup'

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
const API_ORIGIN = new URL(API_URL).origin
const RUNS = Number(process.env.PERF_RUNS ?? 3)
const OUT_DIR = 'perf-results'
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }

type Request = { url: string; type: string; status: number | null; bytes: number; start: number; end: number }
type ApiCall = { path: string; start_ms: number; duration_ms: number }
type Vitals = { ttfb_ms: number; fcp_ms: number | null; lcp_ms: number | null; dcl_ms: number; load_ms: number }
type Measurement = Vitals & {
  requests: number
  by_type: Record<string, number>
  js_kb: number
  /** Script bytes requested before the page's load event — what competes with the first paint. */
  js_before_load_kb: number
  css_kb: number
  image_kb: number
  total_kb: number
  /** JSON calls to the API — not the CORS preflights, not the /media files. */
  api_calls: ApiCall[]
  api_waterfall_depth: number
  api_last_call_end_ms: number | null
  media_calls: number
  preflights: number
  scripts: { url: string; kb: number }[]
}
type PageSpec = {
  slug: string
  path: () => Promise<string>
  viewport?: { width: number; height: number }
  auth?: boolean
  /** Something the page does after load whose requests count too (a click that fans out). */
  after?: (page: Page) => Promise<void>
}
type Budget = Partial<Record<'lcp_ms' | 'js_kb' | 'js_before_load_kb' | 'requests' | 'api_calls', number>>

const kb = (bytes: number) => Math.round(bytes / 102.4) / 10
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Longest chain of API calls where each one started only after another ended. */
function waterfallDepth(calls: ApiCall[]): number {
  const ordered = [...calls].sort((a, b) => a.start_ms - b.start_ms)
  const depths: number[] = []
  ordered.forEach((call, i) => {
    let depth = 1
    for (let j = 0; j < i; j++) {
      if (ordered[j].start_ms + ordered[j].duration_ms <= call.start_ms) depth = Math.max(depth, depths[j] + 1)
    }
    depths.push(depth)
  })
  return Math.max(0, ...depths)
}

async function measureOnce(browser: Browser, spec: PageSpec, url: string): Promise<Measurement> {
  const context = await browser.newContext({
    viewport: spec.viewport ?? DESKTOP,
    storageState: spec.auth ? ADMIN_STORAGE_STATE : undefined,
    // Chromium stops reporting LCP at the first compositor-driven scroll, and
    // the `?room=` pages scroll themselves (smoothly) to the calendar on
    // mount. On a slow runner that scroll lands before the first paint's LCP
    // entry is presented and the page then has no LCP at all (CI: space-day
    // null in every run, space-week == FCP). Under reduced motion the page
    // scrolls instantly — a programmatic scroll, which LCP survives — so the
    // metric is observable everywhere; nothing on the wire changes.
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  const requests = new Map<string, Request>()
  let origin: number | null = null
  let loadedAt: number | null = null
  cdp.on('Page.loadEventFired', (e) => {
    loadedAt = e.timestamp
  })
  cdp.on('Network.requestWillBeSent', (e) => {
    if (origin === null) origin = e.timestamp
    requests.set(e.requestId, { url: e.request.url, type: e.type ?? 'Other', status: null, bytes: 0, start: e.timestamp, end: e.timestamp })
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = requests.get(e.requestId)
    if (r) {
      r.status = e.response.status
      r.type = e.type
    }
  })
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId)
    if (r) {
      r.bytes = e.encodedDataLength
      r.end = e.timestamp
    }
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __lcp: number }
    w.__lcp = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__lcp = entry.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  })

  await page.goto(url, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle')
  if (spec.after) {
    await spec.after(page)
    await page.waitForLoadState('networkidle')
  }
  const vitals = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
    const lcp = (window as unknown as { __lcp: number }).__lcp || null
    return { ttfb_ms: nav.responseStart, fcp_ms: fcp, lcp_ms: lcp, dcl_ms: nav.domContentLoadedEventEnd, load_ms: nav.loadEventEnd }
  })
  await context.close()

  const all = Array.from(requests.values())
  const by_type: Record<string, number> = {}
  for (const r of all) by_type[r.type] = (by_type[r.type] ?? 0) + 1
  const sum = (type: string) => all.filter((r) => r.type === type).reduce((n, r) => n + r.bytes, 0)
  const t0 = origin ?? 0
  const onApi = all.filter((r) => r.url.startsWith(API_ORIGIN))
  const isMedia = (r: Request) => new URL(r.url).pathname.startsWith('/media/')
  const api_calls = onApi
    .filter((r) => r.type !== 'Preflight' && !isMedia(r))
    .map((r) => ({ path: r.url.slice(API_ORIGIN.length), start_ms: Math.round((r.start - t0) * 1000), duration_ms: Math.round((r.end - r.start) * 1000) }))
    .sort((a, b) => a.start_ms - b.start_ms)
  const round = (v: number | null) => (v === null ? null : Math.round(v))
  return {
    ttfb_ms: Math.round(vitals.ttfb_ms),
    fcp_ms: round(vitals.fcp_ms),
    lcp_ms: round(vitals.lcp_ms),
    dcl_ms: Math.round(vitals.dcl_ms),
    load_ms: Math.round(vitals.load_ms),
    requests: all.length,
    by_type,
    js_kb: kb(sum('Script')),
    js_before_load_kb: kb(all.filter((r) => r.type === 'Script' && (loadedAt === null || r.start <= loadedAt)).reduce((n, r) => n + r.bytes, 0)),
    css_kb: kb(sum('Stylesheet')),
    image_kb: kb(sum('Image')),
    total_kb: kb(all.reduce((n, r) => n + r.bytes, 0)),
    api_calls,
    api_waterfall_depth: waterfallDepth(api_calls),
    api_last_call_end_ms: api_calls.length ? Math.max(...api_calls.map((c) => c.start_ms + c.duration_ms)) : null,
    media_calls: onApi.filter(isMedia).length,
    preflights: all.filter((r) => r.type === 'Preflight').length,
    scripts: all.filter((r) => r.type === 'Script').map((r) => ({ url: new URL(r.url).pathname, kb: kb(r.bytes) })).sort((a, b) => b.kb - a.kb),
  }
}

/** The median run (by LCP, else load) with the per-run numbers alongside. */
async function measure(browser: Browser, spec: PageSpec): Promise<Measurement & { runs: Pick<Measurement, 'lcp_ms' | 'fcp_ms' | 'load_ms' | 'requests' | 'js_kb'>[] }> {
  const url = await spec.path()
  const runs: Measurement[] = []
  for (let i = 0; i < RUNS; i++) runs.push(await measureOnce(browser, spec, url))
  const key = (m: Measurement) => m.lcp_ms ?? m.load_ms
  const mid = median(runs.map(key))
  const chosen = runs.find((m) => key(m) === mid) ?? runs[0]
  return {
    ...chosen,
    lcp_ms: runs.every((m) => m.lcp_ms !== null) ? median(runs.map((m) => m.lcp_ms as number)) : chosen.lcp_ms,
    fcp_ms: runs.every((m) => m.fcp_ms !== null) ? median(runs.map((m) => m.fcp_ms as number)) : chosen.fcp_ms,
    ttfb_ms: median(runs.map((m) => m.ttfb_ms)),
    load_ms: median(runs.map((m) => m.load_ms)),
    runs: runs.map(({ lcp_ms, fcp_ms, load_ms, requests, js_kb }) => ({ lcp_ms, fcp_ms, load_ms, requests, js_kb })),
  }
}

function budgetFor(slug: string): Budget {
  if (!existsSync('perf-budget.json')) return {}
  const budgets = JSON.parse(readFileSync('perf-budget.json', 'utf8')) as { pages?: Record<string, Budget> }
  return budgets.pages?.[slug] ?? {}
}

const summary: { slug: string; m: Measurement }[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await mkdir(OUT_DIR, { recursive: true })
})

test.afterAll(async () => {
  const header =
    '| Page | TTFB | FCP | LCP | Load | Requests | API calls (depth, last end) | Media | Preflights | JS ≤ load | JS wire | Total wire |\n|---|---|---|---|---|---|---|---|---|---|---|---|'
  const rows = summary.map(({ slug, m }) =>
    `| ${slug} | ${m.ttfb_ms} ms | ${m.fcp_ms ?? '—'} ms | ${m.lcp_ms ?? '—'} ms | ${m.load_ms} ms | ${m.requests} | ${m.api_calls.length} (${m.api_waterfall_depth}, ${m.api_last_call_end_ms ?? '—'} ms) | ${m.media_calls} | ${m.preflights} | ${m.js_before_load_kb} KB | ${m.js_kb} KB | ${m.total_kb} KB |`,
  )
  const md = `${header}\n${rows.join('\n')}\n`
  await writeFile(`${OUT_DIR}/summary.md`, md)
  console.log(`\n${md}`)
})

async function firstSpace(): Promise<{ spaceId: string; roomId: string }> {
  const spaces = await fetch(`${API_URL}/spaces`).then((r) => r.json() as Promise<{ spaces: { id: string }[] }>)
  const spaceId = spaces.spaces[0].id
  const detail = await fetch(`${API_URL}/spaces/${spaceId}`).then((r) => r.json() as Promise<{ rooms: { id: string }[] }>)
  return { spaceId, roomId: detail.rooms[0].id }
}

const PAGES: PageSpec[] = [
  { slug: 'landing', path: async () => '/' },
  { slug: 'spaces', path: async () => '/spaces' },
  // The calendar opens on the week view at this width (useCalendarView).
  { slug: 'space-week', path: async () => firstSpace().then(({ spaceId, roomId }) => `/spaces/${spaceId}?room=${roomId}`) },
  { slug: 'space-day', viewport: PHONE, path: async () => firstSpace().then(({ spaceId, roomId }) => `/spaces/${spaceId}?room=${roomId}`) },
  { slug: 'dashboard', auth: true, path: async () => '/dashboard' },
  { slug: 'admin-calendar', auth: true, path: async () => '/admin/calendar' },
]

for (const spec of PAGES) {
  test(`${spec.slug}: cold load, median of ${RUNS}`, async ({ browser }) => {
    const m = await measure(browser, spec)
    summary.push({ slug: spec.slug, m })
    await writeFile(`${OUT_DIR}/${spec.slug}.json`, JSON.stringify({ measured_at: new Date().toISOString(), ...m }, null, 2))
    expect(m.requests, 'a page with no requests was not measured').toBeGreaterThan(0)
    const budget = budgetFor(spec.slug)
    if (budget.lcp_ms !== undefined) expect.soft(m.lcp_ms ?? Infinity, `${spec.slug} LCP`).toBeLessThanOrEqual(budget.lcp_ms)
    if (budget.js_kb !== undefined) expect.soft(m.js_kb, `${spec.slug} JS on the wire`).toBeLessThanOrEqual(budget.js_kb)
    if (budget.js_before_load_kb !== undefined) expect.soft(m.js_before_load_kb, `${spec.slug} JS before load`).toBeLessThanOrEqual(budget.js_before_load_kb)
    if (budget.requests !== undefined) expect.soft(m.requests, `${spec.slug} requests`).toBeLessThanOrEqual(budget.requests)
    if (budget.api_calls !== undefined) expect.soft(m.api_calls.length, `${spec.slug} API calls`).toBeLessThanOrEqual(budget.api_calls)
  })
}
