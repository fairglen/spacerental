/**
 * Wall-clock ↔ UTC in an IANA time zone, without a library (review on #65).
 *
 * Operators' forms show and take a space's wall clock (R01: rooms open on
 * the space's own clock), not the browser's; the API speaks UTC instants.
 * `date-fns` has no zone support and `date-fns-tz` is not a dependency, so
 * this uses `Intl.DateTimeFormat`, which every target browser ships.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    partsFormatter.set(timeZone, f)
  }
  return f
}

/** The zone's wall clock at `instant`, as numbers. */
function wallParts(instant: Date, timeZone: string) {
  const out: Record<string, number> = {}
  for (const p of formatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second }
}

/** The zone's UTC offset at `instant`, in ms (positive east of UTC). */
function offsetAt(instant: Date, timeZone: string): number {
  const w = wallParts(instant, timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - instant.getTime()
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `YYYY-MM-DD` and `HH:mm` of `iso` on the zone's wall clock. */
export function utcToWall(iso: string, timeZone: string): { date: string; time: string } {
  const w = wallParts(new Date(iso), timeZone)
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` }
}

/**
 * The UTC instant of a wall-clock `YYYY-MM-DD` + `HH:mm` in the zone. Every
 * offset the zone uses around that day gives one candidate instant; the
 * ones that really show that wall clock are kept. A wall time that happens
 * twice (clocks going back) resolves to its first occurrence; one that
 * never happens (clocks going forward) to the same elapsed time after the
 * gap, as the browser does for `datetime-local`.
 */
export function wallToUtc(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const asIfUtc = Date.UTC(y, m - 1, d, hh, mm)
  const day = 86_400_000
  const offsets = Array.from(new Set([-day, 0, day].map((delta) => offsetAt(new Date(asIfUtc + delta), timeZone))))
  const shows = (instant: number) => {
    const w = wallParts(new Date(instant), timeZone)
    return w.year === y && w.month === m && w.day === d && w.hour === hh && w.minute === mm
  }
  const valid = offsets.map((off) => asIfUtc - off).filter(shows)
  const instant = valid.length > 0 ? Math.min(...valid) : asIfUtc - Math.min(...offsets)
  return new Date(instant).toISOString()
}

/** `datetime-local` value (`YYYY-MM-DDTHH:mm`) ↔ UTC, same rules. */
export function localInputToUtc(value: string, timeZone: string): string {
  const [date, time] = value.split('T')
  return wallToUtc(date, time, timeZone)
}
