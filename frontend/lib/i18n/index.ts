import { useSyncExternalStore } from 'react'
import ptCatalog from './pt.json'
import enCatalog from './en.json'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  getLocale,
  localeFromCookieString,
  resetLocaleForTests,
  setLocale,
  subscribe,
  type Locale,
} from './locale'
import { LocaleProvider, useInitialLocale } from './LocaleProvider'

export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LocaleProvider,
  SUPPORTED_LOCALES,
  getLocale,
  localeFromCookieString,
  resetLocaleForTests,
  setLocale,
  type Locale,
}

const catalogs: Record<Locale, unknown> = { pt: ptCatalog, en: enCatalog }

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

function translate(
  locale: Locale,
  key: string,
  replacements?: Record<string, string | number>,
): string {
  let value: unknown = catalogs[locale]
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
 * Subscribes the calling component to locale changes and returns the
 * current locale plus a setter. Components that only need to force a
 * re-render when the locale changes (to pick up fresh `t()` output) can
 * use `useT()` instead.
 */
export function useLocale(): [Locale, (locale: Locale) => void] {
  // The server snapshot is the cookie the root layout read (B64), so the
  // server HTML and the hydration pass are already in the chosen language.
  const initial = useInitialLocale()
  const locale = useSyncExternalStore(subscribe, getLocale, () => initial)
  return [locale, setLocale]
}

/**
 * Returns the `t()` function, subscribed to locale changes so the calling
 * component re-renders (and its `t()` calls resolve against the new
 * catalog) whenever the visitor toggles the locale switcher.
 */
export function useT(): typeof t {
  // React's snapshot: the hydration pass matches the server HTML, which is
  // already in the cookie's language (B64).
  const [locale] = useLocale()
  return (key, replacements) => translate(locale, key, replacements)
}
