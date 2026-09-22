import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import type { Booking, BookingPackageDebit } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(amount)
}

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: pt })
}

export function formatDateShort(dateStr: string): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy HH:mm', { locale: pt })
}

export const STATUS_LABELS: Record<Booking['status'], string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  expired: 'Expirada',
  paid_unfulfilled: 'Paga, sem horário',
}

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
): { eligible: boolean; reason?: string } {
  if (booking.status === 'cancelled') return { eligible: false, reason: 'Reserva já cancelada.' }
  if (booking.status === 'completed') return { eligible: false, reason: 'Reserva já concluída.' }
  if (booking.status === 'expired') return { eligible: false, reason: 'A reserva expirou sem pagamento.' }
  if (booking.status === 'paid_unfulfilled') {
    return { eligible: false, reason: 'O espaço vai contactá-lo sobre este pagamento.' }
  }
  // Nothing was paid for an unpaid hold, so letting it go is always allowed (C03).
  if (isUnpaidHold(booking)) return { eligible: true }
  const hoursAhead = (parseISO(booking.start_time).getTime() - now.getTime()) / 3_600_000
  if (hoursAhead < CANCELLATION_WINDOW_HOURS) {
    return {
      eligible: false,
      reason: `Só é possível cancelar até ${CANCELLATION_WINDOW_HOURS} horas antes do início.`,
    }
  }
  return { eligible: true }
}

/** What a booking cost the customer: prepaid hours, money, or both (B29, C13). */
export function formatBookingCost(
  b: Pick<Booking, 'payment_method' | 'duration_hours' | 'total_amount' | 'package_hours_used'>,
): string {
  if (b.payment_method === 'package') return `${formatHours(b.duration_hours)} do pack`
  if (b.payment_method === 'mixed') {
    return `${formatHours(b.package_hours_used ?? 0)} do pack + ${formatCurrency(b.total_amount)}`
  }
  // A01: arranged with the operator; the amount is the slot's value, not a charge.
  if (b.payment_method === 'manual') return 'Pago no local'
  return formatCurrency(b.total_amount)
}

/**
 * The operator's per-pack split of a booking's hours (H02): one line per
 * purchase, "2h · Pack 10h · expira 3 out". Empty when the booking holds no
 * hours or the response did not carry the split.
 */
export function packSplitLines(debits: BookingPackageDebit[] | undefined): string[] {
  return (debits ?? []).map((d) => {
    const parts = [formatHours(d.hours), d.package_name ?? 'Pack']
    if (d.expires_at) parts.push(`expira ${format(parseISO(d.expires_at), 'd MMM', { locale: pt })}`)
    return parts.join(' · ')
  })
}

/** "10h", "7,5h" — a whole number of hours has no fraction, a real fraction
 * keeps the Portuguese decimal comma (B29/B30). */
export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(hours)}h`
}
