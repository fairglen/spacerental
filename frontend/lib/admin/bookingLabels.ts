import type { Booking } from '@/types'

export const PAYMENT_LABELS: Record<Booking['payment_method'], string> = {
  hourly: 'Pagamento único',
  package: 'Pack',
  mixed: 'Pack + pagamento',
  manual: 'Pago no local',
}

/**
 * When a booking may be hard-deleted (G02): never held money and holds no
 * pack hours — an expired hold, a cancelled one at 0 €, or an operator's
 * manual booking (with a reason). Everything else is "cancel instead".
 */
export function hardDeleteAllowed(b: Pick<Booking, 'status' | 'payment_method' | 'total_amount' | 'package_debits'>): boolean {
  if (b.payment_method === 'manual') return (b.package_debits?.length ?? 0) === 0
  if (b.status === 'expired') return true
  return b.status === 'cancelled' && b.total_amount === 0 && (b.package_debits?.length ?? 0) === 0
}
