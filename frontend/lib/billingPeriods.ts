// The periods the billing page offers (I06). Dates are the browser's local
// calendar days — the operator works in Lisbon, which is also how the API
// bounds a period — sent as ISO `YYYY-MM-DD`.

import type { BillingPeriod } from '@/types'

export type PeriodPreset = 'this_month' | 'last_month' | 'last_30' | 'custom'

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'Este mês',
  last_month: 'Mês passado',
  last_30: 'Últimos 30 dias',
  custom: 'Personalizado',
}

const pad = (n: number) => String(n).padStart(2, '0')

export function isoLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The preset's `from`/`to`, or null for "Personalizado" (the inputs decide). */
export function presetRange(preset: PeriodPreset, today: Date = new Date()): BillingPeriod | null {
  const y = today.getFullYear()
  const m = today.getMonth()
  switch (preset) {
    case 'this_month':
      return { from: isoLocalDate(new Date(y, m, 1)), to: isoLocalDate(new Date(y, m + 1, 0)) }
    case 'last_month':
      return { from: isoLocalDate(new Date(y, m - 1, 1)), to: isoLocalDate(new Date(y, m, 0)) }
    case 'last_30': {
      const from = new Date(y, m, today.getDate() - 29)
      return { from: isoLocalDate(from), to: isoLocalDate(today) }
    }
    default:
      return null
  }
}

/** A custom range the API would accept: both dates, in order, a year at most. */
export function isValidRange(period: BillingPeriod): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to)) return false
  const from = new Date(`${period.from}T00:00:00`)
  const to = new Date(`${period.to}T00:00:00`)
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  return days >= 0 && days < 366
}
