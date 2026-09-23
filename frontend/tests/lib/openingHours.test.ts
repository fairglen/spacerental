import { describe, it, expect, vi, afterEach } from 'vitest'
import { describeOpeningHours, toClock } from '@/lib/openingHours'
import type { OpeningWindow } from '@/types'

const w = (day: number, open: string, close: string): OpeningWindow => ({ day_of_week: day, open_time: open, close_time: close })
const week = (open: string, close: string, days = [0, 1, 2, 3, 4, 5, 6]) => days.map((d) => w(d, open, close))

// V06/R01: the "Horário" line of "Onde estamos" — the union of the rooms'
// rules, grouped into ranges, read back as the wall clock they are written in.
describe('describeOpeningHours', () => {
  afterEach(() => vi.useRealTimers())

  it('every day the same → one line', () => {
    const out = describeOpeningHours([{ availability_rules: week('08:00:00', '22:00:00') }])
    expect(out).toEqual({ lines: ['Todos os dias 08:00–22:00'], differsByRoom: false })
  })

  it('Monday to Friday, a different Saturday, a closed Sunday → ranges and "Encerrado"', () => {
    const rules = [...week('08:00:00', '20:00:00', [0, 1, 2, 3, 4]), w(5, '09:00:00', '13:00:00')]
    const out = describeOpeningHours([{ availability_rules: rules }])
    expect(out.lines).toEqual(['Seg–Sex 08:00–20:00', 'Sáb 09:00–13:00', 'Dom Encerrado'])
  })

  it('groups only consecutive days, and a lone day stands alone', () => {
    const rules = [w(0, '08:00:00', '20:00:00'), w(2, '08:00:00', '20:00:00'), w(3, '08:00:00', '20:00:00')]
    const out = describeOpeningHours([{ availability_rules: rules }])
    expect(out.lines).toEqual(['Seg 08:00–20:00', 'Ter Encerrado', 'Qua–Qui 08:00–20:00', 'Sex–Dom Encerrado'])
  })

  it('takes the union across rooms and says so when they differ', () => {
    const out = describeOpeningHours([
      { availability_rules: week('08:00:00', '20:00:00') },
      { availability_rules: week('10:00:00', '22:00:00') },
    ])
    expect(out).toEqual({ lines: ['Todos os dias 08:00–22:00'], differsByRoom: true })
  })

  it('identical rooms do not count as differing', () => {
    const out = describeOpeningHours([
      { availability_rules: week('08:00:00', '22:00:00') },
      { availability_rules: week('08:00:00', '22:00:00') },
    ])
    expect(out.differsByRoom).toBe(false)
  })

  it('two windows on one day (a lunch break) become that day\'s outer span', () => {
    const rules = [w(0, '08:00:00', '12:00:00'), w(0, '14:00:00', '20:00:00')]
    expect(describeOpeningHours([{ availability_rules: rules }]).lines[0]).toBe('Seg 08:00–20:00')
  })

  it('reads the rules as the wall clock they are, whatever the season (R01)', () => {
    // Before R01 this line converted UTC→Lisbon and read 09:00–23:00 in summer.
    vi.useFakeTimers({ now: new Date('2026-07-15T12:00:00Z') })
    const out = describeOpeningHours([{ availability_rules: week('08:00:00', '22:00:00') }])
    expect(out.lines).toEqual(['Todos os dias 08:00–22:00'])
  })

  it('no rules at all → closed', () => {
    expect(describeOpeningHours([{ availability_rules: [] }]).lines).toEqual(['Encerrado'])
    expect(describeOpeningHours([]).lines).toEqual(['Encerrado'])
  })

  it('a room without the field counts as having no rules', () => {
    expect(describeOpeningHours([{}]).lines).toEqual(['Encerrado'])
  })
})

describe('toClock', () => {
  it('trims the API\'s seconds and keeps the wall time', () => {
    expect(toClock('08:00:00')).toBe('08:00')
    expect(toClock('22:30:00')).toBe('22:30')
    expect(toClock('9:05')).toBe('09:05')
  })
})
