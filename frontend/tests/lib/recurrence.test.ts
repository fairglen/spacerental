import { describe, it, expect } from 'vitest'
import { expandWeeklyOccurrences, MAX_WEEKLY_OCCURRENCES } from '@/lib/recurrence'

describe('expandWeeklyOccurrences', () => {
  it('generates one occurrence per week, inclusive of the until date', () => {
    const start = new Date('2026-08-10T09:00:00Z') // a Monday
    const result = expandWeeklyOccurrences(start, '2026-08-24')

    expect(result.map((d) => d.toISOString())).toEqual([
      '2026-08-10T09:00:00.000Z',
      '2026-08-17T09:00:00.000Z',
      '2026-08-24T09:00:00.000Z',
    ])
  })

  it('excludes the week after the until date', () => {
    const start = new Date('2026-08-10T09:00:00Z')
    const result = expandWeeklyOccurrences(start, '2026-08-23')

    // 2026-08-24 is one day past the cutoff, so only two occurrences fit.
    expect(result).toHaveLength(2)
  })

  it('returns just the start when until date equals the start date', () => {
    const start = new Date('2026-08-10T09:00:00Z')
    const result = expandWeeklyOccurrences(start, '2026-08-10')
    expect(result).toHaveLength(1)
    expect(result[0].toISOString()).toBe(start.toISOString())
  })

  it('returns an empty array when the until date is before the start date', () => {
    const start = new Date('2026-08-10T09:00:00Z')
    expect(expandWeeklyOccurrences(start, '2026-08-01')).toEqual([])
  })

  it('returns an empty array for a blank until date', () => {
    const start = new Date('2026-08-10T09:00:00Z')
    expect(expandWeeklyOccurrences(start, '')).toEqual([])
  })

  it('never generates more than MAX_WEEKLY_OCCURRENCES, mirroring the backend cap', () => {
    const start = new Date('2026-01-01T09:00:00Z')
    // Ten years out — far beyond the 104-week (~2 year) cap.
    const result = expandWeeklyOccurrences(start, '2036-01-01')
    expect(result.length).toBe(MAX_WEEKLY_OCCURRENCES)
  })
})
