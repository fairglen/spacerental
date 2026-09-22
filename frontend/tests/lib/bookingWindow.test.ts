import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  bookingMaxAdvanceDays,
  bookingWindowEnd,
  isBeyondWindow,
  nextPeriodIsBeyondWindow,
  DEFAULT_BOOKING_MAX_ADVANCE_DAYS,
} from '@/lib/bookingWindow'

// H01: the calendar's copy of the customer's horizon. The API decides what is
// bookable; these only decide when › goes quiet and what the hint says.
describe('bookingMaxAdvanceDays', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is the backend default when nothing is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS', '')
    expect(bookingMaxAdvanceDays()).toBe(DEFAULT_BOOKING_MAX_ADVANCE_DAYS)
  })

  it('reads a configured number of days', () => {
    vi.stubEnv('NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS', '14')
    expect(bookingMaxAdvanceDays()).toBe(14)
    expect(bookingWindowEnd(new Date('2026-09-22T10:00:00Z'))).toEqual(new Date('2026-10-06T10:00:00Z'))
  })

  it('fails loudly on a value that is not a positive integer', () => {
    for (const bad of ['0', '-3', 'abc', '2.5']) {
      vi.stubEnv('NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS', bad)
      expect(() => bookingMaxAdvanceDays()).toThrow(/positive integer/)
    }
  })
})

describe('nextPeriodIsBeyondWindow', () => {
  const now = new Date(2026, 8, 22, 10, 0) // Tue 22 Sep 2026, local; window ends Thu 22 Oct
  afterEach(() => vi.unstubAllEnvs())

  it('keeps › live until the day after the window\'s last day', () => {
    expect(nextPeriodIsBeyondWindow(new Date(2026, 9, 20), 'day', now)).toBe(false)
    expect(nextPeriodIsBeyondWindow(new Date(2026, 9, 21), 'day', now)).toBe(false) // next = the last day
    expect(nextPeriodIsBeyondWindow(new Date(2026, 9, 22), 'day', now)).toBe(true)
  })

  it('in the week view, disables › once the next Monday is past the window', () => {
    // Week of Mon 12 Oct: next week (19–25 Oct) still contains the 22nd.
    expect(nextPeriodIsBeyondWindow(new Date(2026, 9, 14), 'week', now)).toBe(false)
    // Week of Mon 19 Oct: next week starts the 26th, past the window.
    expect(nextPeriodIsBeyondWindow(new Date(2026, 9, 21), 'week', now)).toBe(true)
  })

  it('follows the configured horizon', () => {
    vi.stubEnv('NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS', '7')
    expect(nextPeriodIsBeyondWindow(new Date(2026, 8, 28), 'day', now)).toBe(false)
    expect(nextPeriodIsBeyondWindow(new Date(2026, 8, 29), 'day', now)).toBe(true)
  })
})

describe('isBeyondWindow', () => {
  it('trusts the API reason and nothing else', () => {
    expect(isBeyondWindow({ start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z', available: false, reason: 'beyond_window' })).toBe(true)
    expect(isBeyondWindow({ start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z', available: false, reason: 'booked' })).toBe(false)
    expect(isBeyondWindow({ start: '2030-01-01T09:00:00Z', end: '2030-01-01T10:00:00Z', available: false })).toBe(false)
  })
})
