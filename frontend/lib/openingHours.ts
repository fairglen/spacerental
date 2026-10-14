import { t as globalT } from '@/lib/i18n'
import type { OpeningWindow } from '@/types'

/**
 * The "Horário" of "Onde estamos" (V06): what the space's rooms' availability
 * rules add up to, as a few human lines.
 *
 * Rules are per room and are the SPACE's wall clock (R01, `Space.timezone`,
 * Europe/Lisbon for the pilot): "08:00:00" means 08:00 on the door, summer
 * and winter. Nothing here converts — the backend does the UTC conversion
 * when it books; these lines only read the rules back.
 */

type Translate = typeof globalT

// Indexed by the API's day_of_week (0 = Monday).
const DAY_KEYS = ['day_mon', 'day_tue', 'day_wed', 'day_thu', 'day_fri', 'day_sat', 'day_sun']

type RoomLike = { availability_rules?: OpeningWindow[] | null }
type Span = { open: string; close: string } | null

/** "08:00:00" as the API sends it → "08:00" as the door shows it. */
export function toClock(wallTime: string): string {
  const [h, m] = wallTime.split(':')
  return `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`
}

/** Per weekday (0 = Monday), the outer span of every window of every room. */
function unionByDay(rooms: RoomLike[]): Span[] {
  const spans: Span[] = Array.from({ length: 7 }, () => null)
  for (const room of rooms) {
    for (const rule of room.availability_rules ?? []) {
      const current = spans[rule.day_of_week]
      spans[rule.day_of_week] = current
        ? { open: rule.open_time < current.open ? rule.open_time : current.open, close: rule.close_time > current.close ? rule.close_time : current.close }
        : { open: rule.open_time, close: rule.close_time }
    }
  }
  return spans
}

function signature(room: RoomLike): string {
  return (room.availability_rules ?? [])
    .map((r) => `${r.day_of_week}|${r.open_time}|${r.close_time}`)
    .sort()
    .join(';')
}

/**
 * `t` is the caller's (a component's `useT()`, or `tFor(locale)`); the
 * global reads the browser's current locale and serves client-only callers (B65).
 */
export function describeOpeningHours(rooms: RoomLike[], t: Translate = globalT): { lines: string[]; differsByRoom: boolean } {
  const closed = t('openingHours.closed')
  const spans = unionByDay(rooms)
  const label = (span: Span) => (span ? `${toClock(span.open)}–${toClock(span.close)}` : closed)
  const labels = spans.map(label)

  const differsByRoom = new Set(rooms.map(signature)).size > 1

  if (labels.every((l) => l === closed)) return { lines: [closed], differsByRoom }
  if (labels.every((l) => l === labels[0])) return { lines: [`${t('openingHours.all_days')} ${labels[0]}`], differsByRoom }

  // Consecutive days with the same hours fold into "Seg–Sex".
  const dayLabel = (day: number) => t(`openingHours.${DAY_KEYS[day]}`)
  const lines: string[] = []
  let start = 0
  for (let day = 1; day <= 7; day++) {
    if (day < 7 && labels[day] === labels[start]) continue
    const end = day - 1
    const days = start === end ? dayLabel(start) : `${dayLabel(start)}–${dayLabel(end)}`
    lines.push(`${days} ${labels[start]}`)
    start = day
  }
  return { lines, differsByRoom }
}
