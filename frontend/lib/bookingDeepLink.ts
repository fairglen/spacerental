/**
 * K02 — the slot a booking page is asked to select again, from
 * `?start=&end=`: two ISO instants on whole hours, end after start, at most
 * a day apart. Anything else is ignored (a stale or hand-edited link is not
 * worth an error on a page that works without it).
 */
export function parseSlotParams(start: string | null, end: string | null): { start: Date; end: Date } | null {
  if (!start || !end) return null
  const from = new Date(start)
  const to = new Date(end)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const wholeHour = (d: Date) => d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  if (!wholeHour(from) || !wholeHour(to)) return null
  if (to <= from || to.getTime() - from.getTime() > 24 * 3_600_000) return null
  return { start: from, end: to }
}

/** The `?room=&start=&end=` query that brings the customer back to a slot. */
export function slotReturnPath(pathname: string, roomId: string, start: Date, end: Date): string {
  const q = new URLSearchParams({ room: roomId, start: start.toISOString(), end: end.toISOString() })
  return `${pathname}?${q.toString()}`
}
