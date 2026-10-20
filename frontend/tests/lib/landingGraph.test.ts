import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const FRONTEND = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// D26: the landing's JS budget (frontend/perf-budget.json, `perf / perf-web`)
// went red when date-fns reached it through modules every page imports.
// These modules sit in the landing's graph; a date-fns import here is a
// ~18 KB gzipped regression the perf harness would only report in CI.
const DATE_FREE = [
  'lib/utils.ts',
  'lib/httpError.ts',
  'lib/i18n/index.ts',
  'lib/i18n/locale.ts',
  'lib/i18n/registry.ts',
  'lib/i18n/translate.ts',
  'lib/openingHours.ts',
  'components/layout/Navbar.tsx',
  'components/packages/PackageBuyButton.tsx',
]

describe('the landing page graph', () => {
  it.each(DATE_FREE)('%s does not import date-fns', (file) => {
    const source = readFileSync(resolve(FRONTEND, file), 'utf8')
    // A type-only import is erased by the compiler and costs nothing.
    expect(source).not.toMatch(/^import (?!type )[^\n]*from ['"]date-fns/m)
    expect(source).not.toMatch(/from ['"]@\/lib\/(dates|bookingErrors)['"]/)
  })
})
