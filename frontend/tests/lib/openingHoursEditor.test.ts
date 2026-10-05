import { describe, it, expect } from 'vitest'
import { rowsFromRules, rulesFromRows, DEFAULT_WINDOW } from '@/lib/admin/openingHoursEditor'
import type { AvailabilityRule } from '@/types'

const rule = (day_of_week: number, open_time: string, close_time: string, is_active = true): AvailabilityRule =>
  ({ id: `${day_of_week}-${open_time}`, room_id: 'r', day_of_week, open_time, close_time, is_active }) as AvailabilityRule

// Review on #65: a day with two windows (a lunch break) must survive the editor.
describe('openingHoursEditor', () => {
  it('keeps every active window of a day, in order, and marks the others closed', () => {
    const rows = rowsFromRules([
      rule(0, '14:00:00', '18:00:00'),
      rule(0, '09:00:00', '12:00:00'),
      rule(2, '10:00:00', '16:00:00'),
      rule(3, '10:00:00', '16:00:00', false),
    ])
    expect(rows[0]).toEqual({ enabled: true, windows: [{ open_time: '09:00', close_time: '12:00' }, { open_time: '14:00', close_time: '18:00' }] })
    expect(rows[2]).toEqual({ enabled: true, windows: [{ open_time: '10:00', close_time: '16:00' }] })
    expect(rows[3]).toEqual({ enabled: false, windows: [DEFAULT_WINDOW] })
    expect(rows).toHaveLength(7)
  })

  it('sends every window of every open day back, and nothing for a closed one', () => {
    const rows = rowsFromRules([rule(0, '09:00:00', '12:00:00'), rule(0, '14:00:00', '18:00:00'), rule(5, '09:00:00', '13:00:00')])
    rows[5] = { ...rows[5], enabled: false }
    expect(rulesFromRows(rows)).toEqual([
      { day_of_week: 0, open_time: '09:00', close_time: '12:00' },
      { day_of_week: 0, open_time: '14:00', close_time: '18:00' },
    ])
  })
})
