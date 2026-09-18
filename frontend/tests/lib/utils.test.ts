import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, STATUS_LABELS, STATUS_COLORS, cancellationEligibility, formatHours } from '@/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toContain('a')
    expect(cn('a', 'b')).toContain('b')
  })
  it('handles conditional classes', () => {
    expect(cn('a', false && 'b', 'c')).not.toContain('b')
  })
})

describe('formatCurrency', () => {
  it('formats euros in pt-PT', () => {
    expect(formatCurrency(11)).toMatch(/11/)
    expect(formatCurrency(11)).toMatch(/€/)
  })
  it('handles decimals', () => {
    expect(formatCurrency(11.5)).toMatch(/11/)
  })
})

describe('STATUS_LABELS', () => {
  it('has Portuguese labels for all statuses', () => {
    expect(STATUS_LABELS.pending).toBe('Pendente')
    expect(STATUS_LABELS.confirmed).toBe('Confirmado')
    expect(STATUS_LABELS.cancelled).toBe('Cancelado')
    expect(STATUS_LABELS.completed).toBe('Concluído')
  })
})

describe('STATUS_COLORS', () => {
  it('returns CSS classes for each status', () => {
    expect(STATUS_COLORS.confirmed).toBeTruthy()
    expect(STATUS_COLORS.cancelled).toBeTruthy()
  })
})

describe('cancellationEligibility (C07)', () => {
  const now = new Date('2026-09-17T12:00:00Z')
  const at = (iso: string, status: 'pending' | 'confirmed' | 'cancelled' | 'completed' = 'confirmed') => ({
    start_time: iso,
    status,
  })

  it('allows a booking exactly 24h ahead (backend rejects only strictly less)', () => {
    expect(cancellationEligibility(at('2026-09-18T12:00:00Z'), now).eligible).toBe(true)
  })
  it('refuses one second inside the window and says why', () => {
    const result = cancellationEligibility(at('2026-09-18T11:59:59Z'), now)
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/24 horas/)
  })
  it('refuses cancelled and completed bookings', () => {
    expect(cancellationEligibility(at('2026-09-25T12:00:00Z', 'cancelled'), now).eligible).toBe(false)
    expect(cancellationEligibility(at('2026-09-25T12:00:00Z', 'completed'), now).eligible).toBe(false)
  })
})

describe('formatHours (B29/B30)', () => {
  it('drops a zero fraction and keeps real ones with a Portuguese comma', () => {
    expect(formatHours(10)).toBe('10h')
    expect(formatHours(3)).toBe('3h')
    expect(formatHours(7.5)).toBe('7,5h')
    expect(formatHours(0.25)).toBe('0,25h')
  })
})

describe('cancellationEligibility for checkout holds (C03)', () => {
  const now = new Date('2026-09-17T12:00:00Z')
  it('lets an unpaid hold go at any time, even inside 24h', () => {
    expect(cancellationEligibility({ start_time: '2026-09-17T14:00:00Z', status: 'pending', hold_expires_at: '2026-09-17T12:15:00Z' }, now).eligible).toBe(true)
  })
  it('keeps the 24h rule for a pending series occurrence (no hold deadline)', () => {
    expect(cancellationEligibility({ start_time: '2026-09-17T14:00:00Z', status: 'pending', hold_expires_at: null }, now).eligible).toBe(false)
  })
  it('has nothing to cancel on expired or paid-unfulfilled rows', () => {
    expect(cancellationEligibility({ start_time: '2026-09-25T14:00:00Z', status: 'expired' }, now).eligible).toBe(false)
    expect(cancellationEligibility({ start_time: '2026-09-25T14:00:00Z', status: 'paid_unfulfilled' }, now).eligible).toBe(false)
  })
  it('labels every status in Portuguese', () => {
    expect(STATUS_LABELS.expired).toBe('Expirada')
    expect(STATUS_LABELS.paid_unfulfilled).toMatch(/Paga/)
    expect(STATUS_COLORS.expired).toBeTruthy()
    expect(STATUS_COLORS.paid_unfulfilled).toBeTruthy()
  })
})
