import { describe, it, expect } from 'vitest'
import { cn, formatCurrency, STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'

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
