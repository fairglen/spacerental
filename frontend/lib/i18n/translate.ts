import { getLocale, type Locale } from './locale'
import { catalogFor } from './registry'

// B65: the lookup alone, with no React in its import graph — a Server
// Component (not-found, a layout's generateMetadata) and the plain helpers
// under lib/ import `t`/`tFor` from here or from `lib/i18n/server`; the hooks
// live in `lib/i18n/index.ts`. The catalogs come from `./registry`.

export function translate(
  locale: Locale,
  key: string,
  replacements?: Record<string, string | number>,
): string {
  let value: unknown = catalogFor(locale)
  for (const part of key.split('.')) {
    value = value !== null && typeof value === 'object' && Object.hasOwn(value, part)
      ? (value as Record<string, unknown>)[part]
      : undefined
  }

  if (typeof value !== 'string') {
    console.warn(`Translation key not found: ${key}`)
    return key
  }

  // Apply string replacements if provided
  if (replacements) {
    return Object.entries(replacements).reduce((acc, [k, v]) => {
      return acc.split(`{${k}}`).join(String(v))
    }, value)
  }

  return value
}

/**
 * Translate a key to its value in the currently selected locale (see
 * `useLocale`/`setLocale`). Defaults to Portuguese until a visitor switches.
 *
 * Supports dot notation for nested keys, e.g. 't("hero.headline_start")'
 * Also supports string interpolation for placeholders like {year}, {name}, etc.
 *
 * @example
 * t('hero.cta_primary') // 'Ver Espaços'
 * t('footer.copyright', { year: 2025, brand: t('brand.name') }) // '© 2025 FlowSpace. Todos os direitos reservados.'
 */
export function t(
  key: string,
  replacements?: Record<string, string | number>
): string {
  return translate(getLocale(), key, replacements)
}

/**
 * `t` bound to one locale — for a Server Component, which has no hook and
 * reads the request's locale with `getServerLocale()` (B65), and for pure
 * helpers handed a locale by their caller.
 */
export function tFor(locale: Locale): typeof t {
  return (key, replacements) => translate(locale, key, replacements)
}
