import type { OpeningWindow } from '@/types'

/**
 * The "Horário" of "Onde estamos" (V06): what the space's rooms' availability
 * rules add up to, as a few human lines.
 *
 * Rules are per room and evaluated in UTC on the backend (R01 owns the Lisbon
 * wall-clock version). Here they are shown on the Lisbon clock for the day in
 * question — display only, nothing is booked from these lines — so in summer
 * a 08:00–22:00 UTC rule reads 09:00–23:00, which is when the door is open.
 */

/** The space's local zone; the product has one location (C11). */
export const SPACE_TIME_ZONE = 'Europe/Lisbon'

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const ALL_DAYS = 'Todos os dias'
const CLOSED = 'Encerrado'

type RoomLike = { availability_rules?: OpeningWindow[] | null }
type Span = { open: string; close: string } | null

/** "08:00:00" (UTC, as the API sends it) on the Lisbon clock of `day`. */
export function toLocalClock(utcTime: string, day: Date): string {
  const [h, m] = utcTime.split(':').map(Number)
  const instant = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m))
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: SPACE_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(instant)
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

export function describeOpeningHours(rooms: RoomLike[], today: Date = new Date()): { lines: string[]; differsByRoom: boolean } {
  const spans = unionByDay(rooms)
  const label = (span: Span) => (span ? `${toLocalClock(span.open, today)}–${toLocalClock(span.close, today)}` : CLOSED)
  const labels = spans.map(label)

  const differsByRoom = new Set(rooms.map(signature)).size > 1

  if (labels.every((l) => l === CLOSED)) return { lines: [CLOSED], differsByRoom }
  if (labels.every((l) => l === labels[0])) return { lines: [`${ALL_DAYS} ${labels[0]}`], differsByRoom }

  // Consecutive days with the same hours fold into "Seg–Sex".
  const lines: string[] = []
  let start = 0
  for (let day = 1; day <= 7; day++) {
    if (day < 7 && labels[day] === labels[start]) continue
    const end = day - 1
    const days = start === end ? DAY_LABELS[start] : `${DAY_LABELS[start]}–${DAY_LABELS[end]}`
    lines.push(`${days} ${labels[start]}`)
    start = day
  }
  return { lines, differsByRoom }
}
