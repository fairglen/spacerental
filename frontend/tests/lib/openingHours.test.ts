import { describe, it, expect } from 'vitest'
import { describeOpeningHours, toLocalClock } from '@/lib/openingHours'
import type { OpeningWindow } from '@/types'

const w = (day: number, open: string, close: string): OpeningWindow => ({ day_of_week: day, open_time: open, close_time: close })
const week = (open: string, close: string, days = [0, 1, 2, 3, 4, 5, 6]) => days.map((d) => w(d, open, close))
// A winter date: Lisbon is on UTC, so the rules' UTC clock reads as-is.
const WINTER = new Date('2026-01-15T12:00:00Z')
// A summer date: Lisbon is UTC+1.
const SUMMER = new Date('2026-07-15T12:00:00Z')

// V06: the "Horário" line of "Onde estamos" — the union of the rooms' rules,
// grouped into ranges, shown on the Lisbon clock.
describe('describeOpeningHours', () => {
  it('every day the same → one line', () => {
    const out = describeOpeningHours([{ availability_rules: week('08:00:00', '22:00:00') }], WINTER)
    expect(out).toEqual({ lines: ['Todos os dias 08:00–22:00'], differsByRoom: false })
  })

  it('Monday to Friday, a different Saturday, a closed Sunday → ranges and "Encerrado"', () => {
    const rules = [...week('08:00:00', '20:00:00', [0, 1, 2, 3, 4]), w(5, '09:00:00', '13:00:00')]
    const out = describeOpeningHours([{ availability_rules: rules }], WINTER)
    expect(out.lines).toEqual(['Seg–Sex 08:00–20:00', 'Sáb 09:00–13:00', 'Dom Encerrado'])
  })

  it('groups only consecutive days, and a lone day stands alone', () => {
    const rules = [w(0, '08:00:00', '20:00:00'), w(2, '08:00:00', '20:00:00'), w(3, '08:00:00', '20:00:00')]
    const out = describeOpeningHours([{ availability_rules: rules }], WINTER)
    expect(out.lines).toEqual(['Seg 08:00–20:00', 'Ter Encerrado', 'Qua–Qui 08:00–20:00', 'Sex–Dom Encerrado'])
  })

  it('takes the union across rooms and says so when they differ', () => {
    const out = describeOpeningHours(
      [
        { availability_rules: week('08:00:00', '20:00:00') },
        { availability_rules: week('10:00:00', '22:00:00') },
      ],
      WINTER,
    )
    expect(out).toEqual({ lines: ['Todos os dias 08:00–22:00'], differsByRoom: true })
  })

  it('identical rooms do not count as differing', () => {
    const out = describeOpeningHours(
      [{ availability_rules: week('08:00:00', '22:00:00') }, { availability_rules: week('08:00:00', '22:00:00') }],
      WINTER,
    )
    expect(out.differsByRoom).toBe(false)
  })

  it('two windows on one day (a lunch break) become that day\'s outer span', () => {
    const rules = [w(0, '08:00:00', '12:00:00'), w(0, '14:00:00', '20:00:00')]
    expect(describeOpeningHours([{ availability_rules: rules }], WINTER).lines[0]).toBe('Seg 08:00–20:00')
  })

  it('shows the Lisbon clock: the UTC rules read an hour later in summer (R01)', () => {
    const out = describeOpeningHours([{ availability_rules: week('08:00:00', '22:00:00') }], SUMMER)
    expect(out.lines).toEqual(['Todos os dias 09:00–23:00'])
  })

  it('no rules at all → closed', () => {
    expect(describeOpeningHours([{ availability_rules: [] }], WINTER).lines).toEqual(['Encerrado'])
    expect(describeOpeningHours([], WINTER).lines).toEqual(['Encerrado'])
  })

  it('a room without the field counts as having no rules', () => {
    expect(describeOpeningHours([{}], WINTER).lines).toEqual(['Encerrado'])
  })
})

describe('toLocalClock', () => {
  it('formats a UTC time on the Lisbon clock for the given day', () => {
    expect(toLocalClock('08:00:00', WINTER)).toBe('08:00')
    expect(toLocalClock('08:00:00', SUMMER)).toBe('09:00')
    expect(toLocalClock('22:30:00', SUMMER)).toBe('23:30')
  })
})
