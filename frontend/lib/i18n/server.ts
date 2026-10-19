import { cookies } from 'next/headers'
import enCatalog from './en.json'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locale'
import { registerCatalog, type Catalog } from './registry'

// Server code takes `tFor` from here, never from `lib/i18n` (whose hooks
// import React and fail the Server Component build).
export { tFor } from './translate'

// The server bundle carries every catalog; the browser gets English only
// when it is the locale (see `getServerCatalog`).
registerCatalog('en', enCatalog)

/**
 * The request's locale for Server Components (B64): the cookie `setLocale`
 * writes, else Portuguese. Server-only — `next/headers` cannot be imported
 * by a client component, which is why this is not in `lib/i18n/index.ts`.
 * DECISION: a first visit is Portuguese; `Accept-Language` is not read.
 */
export function getServerLocale(): Locale {
  const value = cookies().get(LOCALE_COOKIE)?.value
  return isLocale(value) ? value : DEFAULT_LOCALE
}

/**
 * The catalog the browser must have before it hydrates, or null when the
 * bundled Portuguese is enough (B65): handed to `Providers` as a prop, so it
 * travels in the HTML rather than as a JS chunk every visitor downloads.
 */
export function getServerCatalog(locale: Locale): Catalog | null {
  return locale === DEFAULT_LOCALE ? null : enCatalog
}
