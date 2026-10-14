import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO, type Locale as DateFnsLocale } from 'date-fns'
import { enGB, pt } from 'date-fns/locale'
import type { Locale } from '@/lib/i18n/locale'
import { catalogFor, type Catalog } from '@/lib/i18n/registry'
import type { Booking, BookingPackageDebit } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// B65: the operator pages stay Portuguese and call these helpers without a
// locale; the customer pages pass the UI locale. The catalogs come from the
// registry rather than `@/lib/i18n`: that module carries React hooks, and
// `cn` sits in the graph of every server-rendered page.
export function catalog(locale: Locale): Catalog {
  return catalogFor(locale)
}

/** `{name}` placeholders, the way `t()` fills them. */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), template)
}

/** The date-fns locale for the UI locale (B65): month names follow the language. */
export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return locale === 'en' ? enGB : pt
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(amount)
}

export function formatDate(dateStr: string, locale: Locale = 'pt'): string {
  return format(parseISO(dateStr), catalog(locale).dashboard.long_datetime_format, { locale: dateFnsLocale(locale) })
}

export function formatDateShort(dateStr: string, locale: Locale = 'pt'): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm', { locale: dateFnsLocale(locale) })
}

/** The booking status labels in one language (B65). */
export function statusLabels(locale: Locale): Record<Booking['status'], string> {
  const s = catalog(locale).status
  return {
    pending: s.pending,
    confirmed: s.confirmed,
    cancelled: s.cancelled,
    completed: s.completed,
    expired: s.expired,
    paid_unfulfilled: s.paid_unfulfilled,
  }
}

export const STATUS_LABELS: Record<Booking['status'], string> = statusLabels('pt')

export const STATUS_COLORS: Record<Booking['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
  expired: 'bg-gray-100 text-gray-600',
  paid_unfulfilled: 'bg-orange-100 text-orange-800',
}

/** An hourly booking still waiting for its Checkout payment (C03). Series
 * occurrences are pending too but carry no hold deadline: the operator
 * confirms them, so they are not payable from the dashboard. */
export function isUnpaidHold(booking: Pick<Booking, 'status' | 'hold_expires_at'>): boolean {
  return booking.status === 'pending' && !!booking.hold_expires_at
}

export const CANCELLATION_WINDOW_HOURS = 24

/**
 * Whether the customer may cancel this booking right now, mirroring
 * `validate_cancellation` in backend/app/booking_cancellation.py: not already
 * cancelled/completed, and starting at least 24h from now (the backend rejects
 * strictly less than 24h, so exactly 24h is still allowed). The backend stays
 * authoritative; this only decides what the dashboard offers (C07).
 */
export function cancellationEligibility(
  booking: Pick<Booking, 'start_time' | 'status'> & Partial<Pick<Booking, 'hold_expires_at'>>,
  now: Date = new Date(),
  locale: Locale = 'pt',
): { eligible: boolean; reason?: string } {
  const s = catalog(locale).status
  if (booking.status === 'cancelled') return { eligible: false, reason: s.cancel_reason_cancelled }
  if (booking.status === 'completed') return { eligible: false, reason: s.cancel_reason_completed }
  if (booking.status === 'expired') return { eligible: false, reason: s.cancel_reason_expired }
  if (booking.status === 'paid_unfulfilled') {
    return { eligible: false, reason: s.cancel_reason_paid_unfulfilled }
  }
  // Nothing was paid for an unpaid hold, so letting it go is always allowed (C03).
  if (isUnpaidHold(booking)) return { eligible: true }
  const hoursAhead = (parseISO(booking.start_time).getTime() - now.getTime()) / 3_600_000
  if (hoursAhead < CANCELLATION_WINDOW_HOURS) {
    return {
      eligible: false,
      reason: fillTemplate(s.cancel_reason_window, { hours: CANCELLATION_WINDOW_HOURS }),
    }
  }
  return { eligible: true }
}

/** What a booking cost the customer: prepaid hours, money, or both (B29, C13). */
export function formatBookingCost(
  b: Pick<Booking, 'payment_method' | 'duration_hours' | 'total_amount' | 'package_hours_used'>,
  locale: Locale = 'pt',
): string {
  const p = catalog(locale).payment
  if (b.payment_method === 'package') {
    // H03: an operator can lengthen a pack booking past what the bank had;
    // the share stays what was actually debited and the rest is "por acertar".
    const share = b.package_hours_used ?? b.duration_hours
    const uncovered = b.duration_hours - share
    return uncovered > 0
      ? fillTemplate(p.cost_pack_share_uncovered, { hours: formatHours(share), uncovered: formatHours(uncovered) })
      : fillTemplate(p.cost_pack_share, { hours: formatHours(share) })
  }
  if (b.payment_method === 'mixed') {
    return fillTemplate(p.cost_mixed, { hours: formatHours(b.package_hours_used ?? 0), amount: formatCurrency(b.total_amount) })
  }
  // A01: arranged with the operator; the amount is the slot's value, not a charge.
  if (b.payment_method === 'manual') return p.cost_on_site
  return formatCurrency(b.total_amount)
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

/** "10h", "7,5h" — a whole number of hours has no fraction, a real fraction
 * keeps the Portuguese decimal comma (B29/B30). */
export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(hours)}h`
}
