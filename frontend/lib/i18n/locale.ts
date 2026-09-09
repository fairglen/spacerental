export type Locale = 'pt' | 'en'

export const DEFAULT_LOCALE: Locale = 'pt'
export const SUPPORTED_LOCALES: Locale[] = ['pt', 'en']
export const LOCALE_LABELS: Record<Locale, string> = { pt: 'PT', en: 'EN' }

const STORAGE_KEY = 'espacohora.locale'

type Listener = () => void

const listeners = new Set<Listener>()

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function isLocale(value: unknown): value is Locale {
  return value === 'pt' || value === 'en'
}

function readStoredLocale(): Locale {
  if (!isBrowser()) return DEFAULT_LOCALE
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isLocale(stored) ? stored : DEFAULT_LOCALE
}

// Module-level cache so every `t()`/`getLocale()` call in the same page load
// shares one source of truth without needing a React context provider.
let currentLocale: Locale = readStoredLocale()

export function getLocale(): Locale {
  return currentLocale
}

export function getServerLocale(): Locale {
  return DEFAULT_LOCALE
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  if (isBrowser()) {
    window.localStorage.setItem(STORAGE_KEY, locale)
  }
  listeners.forEach((listener) => listener())
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
