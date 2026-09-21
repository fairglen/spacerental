import { useCallback, useState } from 'react'

export type CalendarView = 'day' | 'week'
export const CALENDAR_VIEWS: CalendarView[] = ['day', 'week']

/** Tailwind's `lg`. Below it a seven-column hour grid is unusable. */
export const WEEK_VIEW_MIN_WIDTH = 1024
const STORAGE_KEY = 'espacohora.calendarView'

const isCalendarView = (value: unknown): value is CalendarView =>
  CALENDAR_VIEWS.includes(value as CalendarView)

// Session storage can throw (blocked cookies, some private modes). The view is
// a convenience; losing the memory of it must never break booking.
function remembered(): CalendarView | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY)
    return isCalendarView(value) ? value : null
  } catch {
    return null
  }
}

function remember(view: CalendarView) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, view)
  } catch {
    // Kept in component state for this mount; nothing else to do.
  }
}

function viewForViewport(): CalendarView {
  if (typeof window === 'undefined') return 'day'
  const wide =
    typeof window.matchMedia === 'function'
      ? window.matchMedia(`(min-width: ${WEEK_VIEW_MIN_WIDTH}px)`).matches
      : window.innerWidth >= WEEK_VIEW_MIN_WIDTH
  return wide ? 'week' : 'day'
}

/**
 * Which of the two booking views to show (C12): the week on a screen wide
 * enough for it, the day on a phone — until the customer picks one, after
 * which their choice wins for the rest of the browser session, across rooms
 * and page loads. The default is read once, on mount: a view that flipped
 * under someone rotating a tablet mid-selection would be worse than a stale one.
 */
export function useCalendarView(): [CalendarView, (view: string) => void] {
  const [view, setView] = useState<CalendarView>(() => {
    if (typeof window === 'undefined') return 'day'
    return remembered() ?? viewForViewport()
  })
  const choose = useCallback((next: string) => {
    if (!isCalendarView(next)) return
    remember(next)
    setView(next)
  }, [])
  return [view, choose]
}
