import { useSyncExternalStore } from 'react'
import ptCatalog from './pt.json'
import enCatalog from './en.json'
import {
  DEFAULT_LOCALE,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  getLocale,
  getServerLocale,
  setLocale,
  subscribe,
  type Locale,
} from './locale'

export { DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES, getLocale, setLocale, type Locale }

const catalogs: Record<Locale, unknown> = { pt: ptCatalog, en: enCatalog }

/**
 * Translate a key to its value in the currently selected locale (see
 * `useLocale`/`setLocale`). Defaults to Portuguese until a visitor switches.
 *
 * Supports dot notation for nested keys, e.g. 't("hero.headline_start")'
 * Also supports string interpolation for placeholders like {year}, {name}, etc.
 *
 * @example
 * t('hero.badge') // 'Disponível à hora, por pacote ou recorrente'
 * t('footer.copyright', { year: 2025 }) // '© 2025 EspaçoHora. Todos os direitos reservados.'
 */
export function t(
  key: string,
  replacements?: Record<string, string | number>
): string {
  let value: unknown = catalogs[getLocale()]
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
  const locale = useSyncExternalStore(subscribe, getLocale, getServerLocale)
  return [locale, setLocale]
}

/**
 * Returns the `t()` function, subscribed to locale changes so the calling
 * component re-renders (and its `t()` calls resolve against the new
 * catalog) whenever the visitor toggles the locale switcher.
 */
export function useT(): typeof t {
  useLocale()
  return t
}
