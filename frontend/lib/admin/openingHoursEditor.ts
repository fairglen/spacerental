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

export type Window = { open_time: string; close_time: string }
/** A day on the editor: closed, or open on one or more windows (a lunch break makes two). */
export type DayRow = { enabled: boolean; windows: Window[] }

export const DEFAULT_WINDOW: Window = { open_time: '09:00', close_time: '18:00' }

/**
 * The per-day editor's rows from the API's rules (G06). Every active window
 * of a day is kept, in order (review on #65): the backend allows several per
 * day and copy-to-all-days copies all of them, so an editor that showed one
 * would delete the rest on save.
 */
export function rowsFromRules(rules: AvailabilityRule[]): DayRow[] {
  return DAYS.map(({ day_of_week }) => {
    const windows = rules
      .filter((r) => r.day_of_week === day_of_week && r.is_active)
      .map((r) => ({ open_time: r.open_time.slice(0, 5), close_time: r.close_time.slice(0, 5) }))
      .sort((a, b) => a.open_time.localeCompare(b.open_time))
    return windows.length > 0 ? { enabled: true, windows } : { enabled: false, windows: [DEFAULT_WINDOW] }
  })
}

/** What the replace-all endpoint takes: every window of every open day. */
export function rulesFromRows(rows: DayRow[]): Array<{ day_of_week: number; open_time: string; close_time: string }> {
  return rows.flatMap((row, i) =>
    row.enabled ? row.windows.map((w) => ({ day_of_week: DAYS[i].day_of_week, open_time: w.open_time, close_time: w.close_time })) : [],
  )
}
