import { addDays, format, parseISO } from 'date-fns'
import { catalog, dateFnsLocale, fillTemplate, isUnpaidHold } from '@/lib/utils'
import type { Locale } from '@/lib/i18n/locale'
import type { Booking, UserPackagePurchase } from '@/types'

/**
 * K01 — cancelling a paid booking never refunds money: the paid hours go to
 * the customer's hour bank. Mirrors the backend's
 * `CANCELLATION_CREDIT_VALIDITY_DAYS` so the cancel dialog can say until
 * when; the API is authoritative for the credit it actually creates.
 *
 * DECISION: unset means the backend's own default (365); a value that is
 * set but not a positive integer fails loudly (§9: no silent fallbacks).
 */
export const DEFAULT_CANCELLATION_CREDIT_VALIDITY_DAYS = 365

export function cancellationCreditValidityDays(): number {
  const raw = process.env.NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS
  if (raw === undefined || raw === '') return DEFAULT_CANCELLATION_CREDIT_VALIDITY_DAYS
  const days = Number(raw)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`NEXT_PUBLIC_CANCELLATION_CREDIT_VALIDITY_DAYS must be a positive integer, got "${raw}"`)
  }
  return days
}

/**
 * What cancelling this booking would put in the bank, the backend's way:
 * `total_amount / hourly_rate` to the cent of an hour, for a paid
 * (confirmed) hourly, mixed or manual booking. null when nothing was paid —
 * an unpaid hold, a `package` booking (its hours go back the H02 way), or a
 * zero amount.
 */
export function creditHoursFor(booking: Booking): number | null {
  if (booking.payment_method === 'package') return null
  if (booking.status !== 'confirmed' && booking.status !== 'completed') return null
  if (isUnpaidHold(booking)) return null
  const rate = booking.room?.hourly_rate
  if (!rate || rate <= 0 || booking.total_amount <= 0) return null
  return Math.round((booking.total_amount / rate) * 100) / 100
}

/** The day a credit created now would lapse, as the dialog states it. */
export function creditExpiry(now: Date = new Date()): Date {
  return addDays(now, cancellationCreditValidityDays())
}

/** The bank-card label of a purchase row: the pack's name, or the credit's
 * origin. Portuguese unless the caller passes the UI locale (B65). */
export function purchaseLabel(p: Pick<UserPackagePurchase, 'source' | 'purchased_at' | 'package'>, locale: Locale = 'pt'): string {
  const packs = catalog(locale).packs
  if (p.source === 'cancellation_credit') {
    return fillTemplate(packs.credit_label, { date: format(parseISO(p.purchased_at), 'd MMM', { locale: dateFnsLocale(locale) }) })
  }
  return p.package?.name ?? packs.pack_fallback
}

export function purchaseSourceLabels(locale: Locale): Record<UserPackagePurchase['source'], string> {
  const packs = catalog(locale).packs
  return {
    purchase: packs.source_purchase,
    complimentary: packs.source_complimentary,
    cancellation_credit: packs.source_cancellation_credit,
  }
}

export const PURCHASE_SOURCE_LABELS: Record<UserPackagePurchase['source'], string> = purchaseSourceLabels('pt')
