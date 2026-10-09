import { describe, it, expect } from 'vitest'
import { isValidRange, presetRange } from '@/lib/billingPeriods'

// I06: the presets are local calendar days, as the API bounds a period.

describe('billing period presets', () => {
  const today = new Date(2026, 9, 9) // 9 October 2026, local

  it('this month runs from the 1st to the last day', () => {
    expect(presetRange('this_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('last month is the whole previous month, across a year boundary too', () => {
    expect(presetRange('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(presetRange('last_month', new Date(2027, 0, 15))).toEqual({ from: '2026-12-01', to: '2026-12-31' })
  })

  it('the last 30 days end today', () => {
    expect(presetRange('last_30', today)).toEqual({ from: '2026-09-10', to: '2026-10-09' })
  })

  it('custom leaves the dates to the inputs', () => {
    expect(presetRange('custom', today)).toBeNull()
  })

  it('a custom range must be two dates in order, a year at most', () => {
    expect(isValidRange({ from: '2026-09-01', to: '2026-09-30' })).toBe(true)
    expect(isValidRange({ from: '2026-09-01', to: '2026-09-01' })).toBe(true)
    expect(isValidRange({ from: '2026-09-30', to: '2026-09-01' })).toBe(false)
    expect(isValidRange({ from: '2026-01-01', to: '2027-01-02' })).toBe(false)
    expect(isValidRange({ from: '', to: '2026-09-30' })).toBe(false)
  })
})
