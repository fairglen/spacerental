export type Locale = 'pt' | 'en'

export const DEFAULT_LOCALE: Locale = 'pt'
export const SUPPORTED_LOCALES: Locale[] = ['pt', 'en']
export const LOCALE_LABELS: Record<Locale, string> = { pt: 'PT', en: 'EN' }

// B64: the choice lives in a cookie, so the server renders the first paint in
// it (app/layout.tsx reads it) and nothing flips after hydration. One year,
// the whole site, SameSite=Lax; `Secure` wherever the page is https.
export const LOCALE_COOKIE = 'flowspace.locale'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
// Where the choice lived before B64 (localStorage): read once, moved to the
// cookie, so nobody loses their language on the upgrade.
const LEGACY_STORAGE_KEY = 'espacohora.locale'

type Listener = () => void

const listeners = new Set<Listener>()

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

export function isLocale(value: unknown): value is Locale {
  return value === 'pt' || value === 'en'
}

/** The locale a cookie header or `document.cookie` carries, if any. */
export function localeFromCookieString(cookie: string | undefined | null): Locale | null {
  if (!cookie) return null
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === LOCALE_COOKIE) {
      const value = decodeURIComponent(rest.join('='))
      return isLocale(value) ? value : null
    }
  }
  return null
}

function writeCookie(locale: Locale): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

function readStoredLocale(): Locale {
  if (!isBrowser()) return DEFAULT_LOCALE
  const fromCookie = localeFromCookieString(document.cookie)
  if (fromCookie) return fromCookie
  try {
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (isLocale(legacy)) {
      writeCookie(legacy)
      window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      return legacy
    }
  } catch {
    // Storage blocked: the cookie is the store; nothing to migrate.
  }
  return DEFAULT_LOCALE
}

// Module-level cache so every `t()`/`getLocale()` call in the same page load
// shares one source of truth without needing a React context provider.
let currentLocale: Locale = readStoredLocale()

export function getLocale(): Locale {
  return currentLocale
}

export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return
  currentLocale = locale
  if (isBrowser()) writeCookie(locale)
  listeners.forEach((listener) => listener())
}

/** Tests only: forget the choice (cookie and cache) between cases. */
export function resetLocaleForTests(): void {
  currentLocale = DEFAULT_LOCALE
  if (isBrowser()) document.cookie = `${LOCALE_COOKIE}=; Path=/; Max-Age=0`
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
