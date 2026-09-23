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

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const ALL_DAYS = 'Todos os dias'
const CLOSED = 'Encerrado'

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

export function describeOpeningHours(rooms: RoomLike[]): { lines: string[]; differsByRoom: boolean } {
  const spans = unionByDay(rooms)
  const label = (span: Span) => (span ? `${toClock(span.open)}–${toClock(span.close)}` : CLOSED)
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
