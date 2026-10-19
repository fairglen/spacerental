import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LOCALE_COOKIE,
  getLocale,
  localeFromCookieString,
  resetLocaleForTests,
  setLocale,
} from '@/lib/i18n'

// B64: the choice lives in a cookie the server can read; the old
// localStorage key is read once and moved.
beforeEach(() => {
  resetLocaleForTests()
  window.localStorage.clear()
})
afterEach(() => {
  resetLocaleForTests()
  window.localStorage.clear()
})

describe('the locale cookie', () => {
  it('setLocale writes a one-year, site-wide, Lax cookie and getLocale reads it back', () => {
    setLocale('en')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`)
    expect(getLocale()).toBe('en')
    expect(localeFromCookieString(document.cookie)).toBe('en')
    setLocale('pt')
    expect(localeFromCookieString(document.cookie)).toBe('pt')
  })

  it('reads the cookie out of a header string and ignores other or invalid values', () => {
    expect(localeFromCookieString('a=1; flowspace.locale=en; b=2')).toBe('en')
    expect(localeFromCookieString('flowspace.locale=fr')).toBeNull()
    expect(localeFromCookieString('other=en')).toBeNull()
    expect(localeFromCookieString(undefined)).toBeNull()
  })

  it('migrates the pre-B64 localStorage choice into the cookie once', async () => {
    window.localStorage.setItem('espacohora.locale', 'en')
    // A fresh module evaluation is what a page load does.
    const fresh = await import(`@/lib/i18n/locale?fresh=${Date.now()}`)
    expect(fresh.getLocale()).toBe('en')
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=en`)
    expect(window.localStorage.getItem('espacohora.locale')).toBeNull()
  })
})
