import { addDays, startOfDay, startOfWeek } from 'date-fns'
import type { AvailabilitySlot } from '@/types'
import type { CalendarView } from '@/lib/hooks/useCalendarView'

const DAY_MS = 86_400_000

/**
 * How far ahead a customer may book (H01). Mirrors the backend's
 * `BOOKING_MAX_ADVANCE_DAYS`: the API is authoritative (it refuses a later
 * `start_time` and reports such slots as `reason: 'beyond_window'`); this copy
 * only drives the calendar's › button and its "Reservas abertas até" hint.
 *
 * DECISION: unset means the backend's own default (30), the value a fresh
 * checkout runs with; a value that is set but not a positive integer fails
 * loudly (§9: no silent fallbacks) rather than quietly disabling the hint.
 */
export const DEFAULT_BOOKING_MAX_ADVANCE_DAYS = 30

export function bookingMaxAdvanceDays(): number {
  const raw = process.env.NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS
  if (raw === undefined || raw === '') return DEFAULT_BOOKING_MAX_ADVANCE_DAYS
  const days = Number(raw)
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error(`NEXT_PUBLIC_BOOKING_MAX_ADVANCE_DAYS must be a positive integer, got "${raw}"`)
  }
  return days
}

/**
 * The last instant a customer may start a booking at: now + N days, inclusive.
 * Exact 24-hour days from the instant, as the backend's `timedelta(days=N)`
 * — not calendar days in the browser's zone, which drift an hour across a
 * DST change and can put the hint a day off the API's boundary.
 */
export function bookingWindowEnd(now: Date = new Date()): Date {
  return new Date(now.getTime() + bookingMaxAdvanceDays() * DAY_MS)
}

/** The last calendar day (in the browser's zone) with any bookable hour. */
export function bookingWindowLastDay(now: Date = new Date()): Date {
  return startOfDay(bookingWindowEnd(now))
}

/**
 * True when the whole of the NEXT day/week lies past the window, so › would
 * only ever show closed hours. The window's last day itself stays reachable —
 * it still holds bookable hours up to the exact instant.
 */
export function nextPeriodIsBeyondWindow(visible: Date, view: CalendarView, now: Date = new Date()): boolean {
  const nextStart =
    view === 'week'
      ? addDays(startOfWeek(visible, { weekStartsOn: 1 }), 7)
      : addDays(startOfDay(visible), 1)
  return nextStart > bookingWindowLastDay(now)
}

/** Only the dates the API will answer for: none after the window's last day. */
export function datesWithinWindow(dates: string[], now: Date = new Date()): string[] {
  const last = bookingWindowLastDay(now)
  return dates.filter((d) => new Date(`${d}T00:00:00`) <= last)
}

/** The API's own verdict; a slot without a reason field is never "beyond". */
export function isBeyondWindow(slot: AvailabilitySlot): boolean {
  return slot.reason === 'beyond_window'
}
