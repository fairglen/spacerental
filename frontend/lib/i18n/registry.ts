import ptCatalog from './pt.json'
import type { Locale } from './locale'

/**
 * B65: the catalogs a page has in memory. Portuguese — the default and the
 * fallback — is always bundled; English is a chunk of its own, registered
 * from the server's render when the visitor's cookie says EN (app/layout
 * → Providers) and loaded on demand when the switcher is used, so a
 * Portuguese visitor never downloads it (the landing's JS budget, P2.4).
 * No React here: Server Components and the helpers under lib/ read this.
 */
export type Catalog = typeof ptCatalog

const catalogs: Partial<Record<Locale, Catalog>> = { pt: ptCatalog }

export function registerCatalog(locale: Locale, catalog: Catalog): void {
  catalogs[locale] = catalog
}

export function hasCatalog(locale: Locale): boolean {
  return catalogs[locale] !== undefined
}

/** The catalog for a locale — Portuguese until the locale's own has arrived. */
export function catalogFor(locale: Locale): Catalog {
  return catalogs[locale] ?? ptCatalog
}

const loaders: Partial<Record<Locale, () => Promise<{ default: Catalog }>>> = {
  en: () => import('./en.json'),
}

/** Resolves once the locale's catalog is registered; a no-op when it already is. */
export async function ensureCatalog(locale: Locale): Promise<void> {
  if (hasCatalog(locale)) return
  const load = loaders[locale]
  if (!load) return
  registerCatalog(locale, (await load()).default)
}
