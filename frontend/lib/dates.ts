import { format, parseISO, type Locale as DateFnsLocale } from 'date-fns'
import { enGB, pt } from 'date-fns/locale'
import type { Locale } from '@/lib/i18n/locale'
import type { BookingPackageDebit } from '@/types'
import { catalog, fillTemplate, formatHours } from '@/lib/utils'

// D26: everything in lib/ that needs date-fns lives here, apart from
// lib/utils.ts — `cn` and the money/hours formatters sit in every page's
// graph, the landing's included, and date-fns (format + a locale) is ~18 KB
// gzipped the landing never used. Import this only where a date is shown.

/** The date-fns locale for the UI locale (B65): month names follow the language. */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return locale === 'en' ? enGB : pt
}

export function formatDate(dateStr: string, locale: Locale = 'pt'): string {
  return format(parseISO(dateStr), catalog(locale).dashboard.long_datetime_format, { locale: dateFnsLocale(locale) })
}

export function formatDateShort(dateStr: string, locale: Locale = 'pt'): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm', { locale: dateFnsLocale(locale) })
}

/**
 * The operator's per-pack split of a booking's hours (H02): one line per
 * purchase, "2h · Pack 10h · expira 3 out". Empty when the booking holds no
 * hours or the response did not carry the split.
 */
export function packSplitLine(d: BookingPackageDebit, locale: Locale = 'pt'): string {
  const packs = catalog(locale).packs
  const parts = [formatHours(d.hours), d.package_name ?? packs.pack_fallback]
  if (d.expires_at) {
    parts.push(fillTemplate(packs.split_expires, { date: format(parseISO(d.expires_at), 'd MMM', { locale: dateFnsLocale(locale) }) }))
  }
  return parts.join(' · ')
}

export function packSplitLines(debits: BookingPackageDebit[] | undefined, locale: Locale = 'pt'): string[] {
  return (debits ?? []).map((d) => packSplitLine(d, locale))
}
