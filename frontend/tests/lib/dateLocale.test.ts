import { describe, expect, it } from 'vitest'
import { format, getDay, parse, startOfWeek } from 'date-fns'
import { pt } from 'date-fns/locale'
import { dateFnsLocalizer } from 'react-big-calendar'
import { ptMonday } from '@/lib/dateLocale'

// D21 (#103): date-fns 4 changed the stock `pt` locale to a Sunday week start,
// which moved both calendars' columns by one day. The product's week starts on
// Monday; this pins it where the calendars read it.
describe('ptMonday', () => {
  const monday = new Date(2026, 10, 9)

  it('starts the week on Monday from every day of that week', () => {
    for (let day = 9; day <= 15; day++) {
      expect(startOfWeek(new Date(2026, 10, day), { locale: ptMonday })).toEqual(monday)
    }
  })

  it('is the stock pt locale in everything but the week start', () => {
    const { options: _options, ...rest } = pt
    expect(ptMonday).toMatchObject(rest)
    expect(ptMonday.options).toEqual({ ...pt.options, weekStartsOn: 1 })
    expect(format(monday, "EEEE, d 'de' MMMM", { locale: ptMonday })).toBe('segunda-feira, 9 de novembro')
  })

  it('gives react-big-calendar a Monday first column, as both calendars build it', () => {
    const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { pt: ptMonday } })
    expect(localizer.startOfWeek('pt')).toBe(1)
  })
})
