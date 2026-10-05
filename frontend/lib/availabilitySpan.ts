// The days a calendar view shows, as the one availability request they make
// (P1.4) — shared by the calendar and by the rooms view that prefetches it
// the moment a room is picked, so the request does not wait for the
// calendar's own module to load.
import { addDays, format, startOfWeek } from 'date-fns'
import { datesWithinWindow } from '@/lib/bookingWindow'
import type { CalendarView } from '@/lib/hooks/useCalendarView'

export type AvailabilitySpan = { from: string; to: string }

/** The days of the view holding `date`, as the API's YYYY-MM-DD, Monday first for a week. */
export function datesForView(date: Date, view: CalendarView): string[] {
  if (view === 'week') {
    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), 'yyyy-MM-dd'))
  }
  return [format(date, 'yyyy-MM-dd')]
}

/**
 * The range to ask for: the view's days inside the booking window, first to
 * last. Null when the whole view lies past the window (the API refuses those
 * days, and they simply have no slots).
 */
export function availabilitySpan(date: Date, view: CalendarView, now: Date = new Date()): AvailabilitySpan | null {
  const days = datesWithinWindow(datesForView(date, view), now)
  return days.length > 0 ? { from: days[0], to: days[days.length - 1] } : null
}

export function availabilityQueryKey(roomId: string, span: AvailabilitySpan | null) {
  return ['availability', roomId, span?.from, span?.to] as const
}
