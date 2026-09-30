import type { AvailabilityRule } from '@/types'

// day_of_week follows Python's date.weekday(): 0 = Monday … 6 = Sunday.
export const DAYS = [
  { day_of_week: 0, label: 'Segunda-feira' },
  { day_of_week: 1, label: 'Terça-feira' },
  { day_of_week: 2, label: 'Quarta-feira' },
  { day_of_week: 3, label: 'Quinta-feira' },
  { day_of_week: 4, label: 'Sexta-feira' },
  { day_of_week: 5, label: 'Sábado' },
  { day_of_week: 6, label: 'Domingo' },
]

export type DayRow = { enabled: boolean; open_time: string; close_time: string }

/** The per-day editor's rows from the API's rules (G06). */
export function rowsFromRules(rules: AvailabilityRule[]): DayRow[] {
  return DAYS.map(({ day_of_week }) => {
    const rule = rules.find((r) => r.day_of_week === day_of_week && r.is_active)
    return rule
      ? { enabled: true, open_time: rule.open_time.slice(0, 5), close_time: rule.close_time.slice(0, 5) }
      : { enabled: false, open_time: '09:00', close_time: '18:00' }
  })
}

/** What the replace-all endpoint takes: the open days only. */
export function rulesFromRows(rows: DayRow[]): Array<{ day_of_week: number; open_time: string; close_time: string }> {
  return rows
    .map((row, i) => ({ ...row, day_of_week: DAYS[i].day_of_week }))
    .filter((r) => r.enabled)
    .map(({ day_of_week, open_time, close_time }) => ({ day_of_week, open_time, close_time }))
}
