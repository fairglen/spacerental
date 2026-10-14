import { useSyncExternalStore } from 'react'
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
import { ensureCatalog, registerCatalog, type Catalog } from './registry'
import { t, tFor, translate } from './translate'

export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LocaleProvider,
  SUPPORTED_LOCALES,
  ensureCatalog,
  getLocale,
  localeFromCookieString,
  registerCatalog,
  resetLocaleForTests,
  setLocale,
  t,
  tFor,
  type Catalog,
  type Locale,
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
