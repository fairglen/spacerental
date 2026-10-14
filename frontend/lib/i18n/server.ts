import { cookies } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from './locale'

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
