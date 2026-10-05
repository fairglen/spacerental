// `npm run perf:sizes` (P1.1): the JavaScript each route ships on first load,
// gzipped, from the manifests `next build` wrote — what "~770 KB" and the
// 300 KB target (P1.3) are measured against, without a browser. Next's own
// build table prints the same idea; this one is scriptable and records the
// chunks so a regression names the file that grew.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const NEXT_DIR = process.env.NEXT_DIR ?? '.next'
const OUT = 'perf-results/sizes.json'

const manifestPath = join(NEXT_DIR, 'app-build-manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`${manifestPath} not found — run \`next build\` first (or point NEXT_DIR at a build).`)
  process.exit(1)
}
const appManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const buildManifest = JSON.parse(readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'))

const sizes = new Map()
function sizeOf(file) {
  if (!sizes.has(file)) {
    const buf = readFileSync(join(NEXT_DIR, file))
    sizes.set(file, { raw: buf.length, gzip: gzipSync(buf).length })
  }
  return sizes.get(file)
}

/** The layouts a page sits under, root first: /layout, /a/layout, /a/[b]/layout. */
function layoutsFor(pageKey) {
  const segments = pageKey.replace(/\/page$/, '').split('/').filter(Boolean)
  const keys = ['/layout']
  for (let i = 1; i <= segments.length; i++) keys.push(`/${segments.slice(0, i).join('/')}/layout`)
  return keys.filter((k) => appManifest.pages[k])
}

const routes = {}
for (const key of Object.keys(appManifest.pages)) {
  if (!key.endsWith('/page')) continue
  const files = new Set(buildManifest.rootMainFiles ?? [])
  for (const layout of layoutsFor(key)) for (const f of appManifest.pages[layout]) files.add(f)
  for (const f of appManifest.pages[key]) files.add(f)
  const js = [...files].filter((f) => f.endsWith('.js'))
  const css = [...files].filter((f) => f.endsWith('.css'))
  const total = (list) => list.reduce((acc, f) => ({ raw: acc.raw + sizeOf(f).raw, gzip: acc.gzip + sizeOf(f).gzip }), { raw: 0, gzip: 0 })
  const route = key.replace(/\/page$/, '') || '/'
  routes[route] = {
    js: total(js),
    css: total(css),
    chunks: js.map((f) => ({ file: f, gzip: sizeOf(f).gzip })).sort((a, b) => b.gzip - a.gzip),
  }
}

const shared = (buildManifest.rootMainFiles ?? []).filter((f) => f.endsWith('.js'))
const sharedTotal = shared.reduce((n, f) => n + sizeOf(f).gzip, 0)

const kb = (n) => (n / 1024).toFixed(1).padStart(7)
console.log(`Route${' '.repeat(31)}JS gzip   JS raw   CSS gzip`)
for (const [route, r] of Object.entries(routes).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`${route.padEnd(34)}${kb(r.js.gzip)} KB${kb(r.js.raw)} KB${kb(r.css.gzip)} KB`)
}
console.log(`${'shared by all (rootMainFiles)'.padEnd(34)}${kb(sharedTotal)} KB`)

mkdirSync('perf-results', { recursive: true })
writeFileSync(OUT, JSON.stringify({ measured_at: new Date().toISOString(), shared_js_gzip: sharedTotal, routes }, null, 2))
console.log(`\nwritten ${OUT}`)
