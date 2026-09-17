import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import type { Booking } from '@/types'

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
}

export const STATUS_COLORS: Record<Booking['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  completed: 'bg-gray-100 text-gray-800',
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
  booking: Pick<Booking, 'start_time' | 'status'>,
  now: Date = new Date(),
): { eligible: boolean; reason?: string } {
  if (booking.status === 'cancelled') return { eligible: false, reason: 'Reserva já cancelada.' }
  if (booking.status === 'completed') return { eligible: false, reason: 'Reserva já concluída.' }
  const hoursAhead = (parseISO(booking.start_time).getTime() - now.getTime()) / 3_600_000
  if (hoursAhead < CANCELLATION_WINDOW_HOURS) {
    return {
      eligible: false,
      reason: `Só é possível cancelar até ${CANCELLATION_WINDOW_HOURS} horas antes do início.`,
    }
  }
  return { eligible: true }
}

/** "10h", "7,5h" — a whole number of hours has no fraction, a real fraction
 * keeps the Portuguese decimal comma (B29/B30). */
export function formatHours(hours: number): string {
  return `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(hours)}h`
}
