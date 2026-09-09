const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Mirrors MAX_OCCURRENCES in backend/app/routers/recurrences.py — the preview
// must never promise more occurrences than the API will actually create.
export const MAX_WEEKLY_OCCURRENCES = 104

function utcDateOnly(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/**
 * Every occurrence start a weekly series would generate, mirroring
 * `expand_occurrences` in backend/app/routers/recurrences.py: the cadence
 * (7 days) is added to the UTC instant, and generation stops once an
 * occurrence's UTC calendar date passes `untilDate` (inclusive).
 *
 * `start` carries the booking's real instant — any local `Date` works, only
 * its UTC instant matters, exactly like `start.toISOString()` on submit.
 * `untilDate` is the raw `YYYY-MM-DD` value from an `<input type="date">`.
 *
 * Returns an empty array for a blank or out-of-range `untilDate` rather than
 * throwing — the caller renders "no dates yet" instead of crashing the modal
 * while the user is still typing.
 */
export function expandWeeklyOccurrences(start: Date, untilDate: string): Date[] {
  if (!untilDate) return []
  const until = new Date(`${untilDate}T00:00:00Z`)
  if (Number.isNaN(until.getTime())) return []
  const untilMs = utcDateOnly(until.getTime())

  if (untilMs >= utcDateOnly(start.getTime()) + MAX_WEEKLY_OCCURRENCES * WEEK_MS) return []

  const occurrences: Date[] = []
  let cursor = start.getTime()
  while (utcDateOnly(cursor) <= untilMs && occurrences.length < MAX_WEEKLY_OCCURRENCES) {
    occurrences.push(new Date(cursor))
    cursor += WEEK_MS
  }
  return occurrences
}
