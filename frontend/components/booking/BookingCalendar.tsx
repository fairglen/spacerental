'use client'
import { useState, useCallback, useRef } from 'react'
import { Calendar, dateFnsLocalizer, type Event, type SlotInfo, type View } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, parseISO, addDays } from 'date-fns'
import { pt } from 'date-fns/locale'
import { useQueries } from '@tanstack/react-query'
import { spacesApi } from '@/lib/api'
import type { Room, AvailabilitySlot } from '@/types'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = { 'pt': pt }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

interface BookingCalendarProps {
  room: Room
  onSlotSelect: (start: Date, end: Date) => void
}

function getDatesForView(date: Date, view: View): string[] {
  if (view === 'week') {
    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), 'yyyy-MM-dd'))
  }
  return [format(date, 'yyyy-MM-dd')]
}

type Resolution =
  | { kind: 'range'; start: Date; end: Date }
  | { kind: 'taken'; from: Date; to: Date }
  | { kind: 'past' }
  | { kind: 'closed' }
  | { kind: 'none' }

/**
 * A slot that has already started. The API also reports it as unavailable
 * (B24), but "past" is not "taken": it gets no "Ocupado" chip and its own
 * message, so the customer is not told someone else booked an hour that has
 * simply gone by.
 */
function isPastSlot(slot: AvailabilitySlot, now: Date): boolean {
  return parseISO(slot.start) < now
}

/**
 * Availability slots the selection `[start, end)` touches, in time order.
 *
 * Overlap, not equality: slots are backend-supplied UTC instants while the grid
 * the user drags on is in their own zone, so a grid line only ever coincides
 * with a slot boundary on whole-hour offsets (TODO.md T7).
 */
function slotsInRange(slots: AvailabilitySlot[], start: Date, end: Date): AvailabilitySlot[] {
  return slots
    .filter((s) => parseISO(s.start) < end && parseISO(s.end) > start)
    .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime())
}

/** The slot a point in time falls inside, if any. */
function slotAt(slots: AvailabilitySlot[], date: Date): AvailabilitySlot | undefined {
  return slots.find((s) => parseISO(s.start) <= date && date < parseISO(s.end))
}

/**
 * Turn a calendar selection into the booking it stands for.
 *
 * The whole dragged range is honoured — a 09:00→12:00 drag is a three-hour
 * booking — and it is only bookable if every hour it touches is free and the
 * hours are contiguous (a range straddling a closed window is refused rather
 * than silently booking through it).
 */
function resolveSelection(slots: AvailabilitySlot[], start: Date, end: Date, now: Date): Resolution {
  const covered = slotsInRange(slots, start, end)
  if (covered.length === 0) return { kind: 'none' }

  if (covered.some((s) => isPastSlot(s, now))) return { kind: 'past' }

  const taken = covered.find((s) => !s.available)
  if (taken) return { kind: 'taken', from: parseISO(taken.start), to: parseISO(taken.end) }

  const contiguous = covered.every(
    (s, i) => i === 0 || parseISO(covered[i - 1].end).getTime() === parseISO(s.start).getTime(),
  )
  if (!contiguous) return { kind: 'closed' }

  return {
    kind: 'range',
    start: parseISO(covered[0].start),
    end: parseISO(covered[covered.length - 1].end),
  }
}

// What the grid showed before B34; still the window while nothing is known.
const FALLBACK_MIN_HOUR = 8
const FALLBACK_MAX_HOUR = 20

/**
 * The hours the grid must show so every returned slot is visible (B34).
 *
 * Opening hours are evaluated in UTC on the backend (R01 owns the Lisbon
 * wall-clock version), so the 08:00–20:00 UTC seed is 09:00–21:00 Lisbon in
 * summer and a fixed 08:00–20:00 grid hid the last bookable hour. Derive the
 * window from the slots themselves, in the browser's zone (the zone
 * react-big-calendar lays the grid out in), with an hour of padding on each
 * side, clamped to the day.
 */
function visibleRange(slots: AvailabilitySlot[]): { min: Date; max: Date } {
  const day = (h: number, m = 0) => new Date(0, 0, 0, h, m)
  if (slots.length === 0) return { min: day(FALLBACK_MIN_HOUR), max: day(FALLBACK_MAX_HOUR) }
  let earliest = 24
  let latest = 0
  for (const s of slots) {
    const start = parseISO(s.start)
    const end = parseISO(s.end)
    earliest = Math.min(earliest, start.getHours())
    // An end on the hour belongs to the previous hour; midnight means 24.
    const endHour = end.getHours() === 0 && end.getMinutes() === 0 ? 24 : end.getHours() + (end.getMinutes() > 0 ? 1 : 0)
    latest = Math.max(latest, endHour)
  }
  const minHour = Math.max(0, earliest - 1)
  const maxHour = Math.min(24, latest + 1)
  // react-big-calendar cannot take 24:00 as `max`; 23:59 shows the last hour.
  return { min: day(minHour), max: maxHour === 24 ? day(23, 59) : day(maxHour) }
}

export function BookingCalendar({ room, onSlotSelect }: BookingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [view, setView] = useState<View>('day')
  const [selectionError, setSelectionError] = useState<string | null>(null)

  const datesToFetch = getDatesForView(selectedDate, view)

  const slotQueries = useQueries({
    queries: datesToFetch.map((dateStr) => ({
      queryKey: ['availability', room.id, dateStr],
      queryFn: () => spacesApi.getAvailability(room.id, dateStr),
      enabled: view !== 'month',
    })),
  })

  const allSlots: AvailabilitySlot[] = slotQueries.flatMap((q) => q.data ?? [])

  // Three states a blank grid used to hide (B26): still fetching, the fetch
  // failed, or the day simply has no opening hours. The grid stays mounted
  // underneath so the customer can still navigate away from a closed day.
  const isLoadingSlots = slotQueries.some((q) => q.isLoading)
  const failedQueries = slotQueries.filter((q) => q.isError)
  const isClosed =
    view !== 'month' && !isLoadingSlots && failedQueries.length === 0 && allSlots.length === 0
  const retryFailed = () => failedQueries.forEach((q) => q.refetch())
  // Keep the last known window while the next day's slots load, so the grid
  // does not snap to the fallback and back on every navigation.
  const lastRange = useRef(visibleRange([]))
  if (allSlots.length > 0) lastRange.current = visibleRange(allSlots)
  const range = lastRange.current

  const events: Event[] = allSlots
    .filter((s) => !s.available && !isPastSlot(s, new Date()))
    .map((s) => ({
      title: 'Ocupado',
      start: parseISO(s.start),
      end: parseISO(s.end),
    }))

  const handleSelectSlot = useCallback(
    ({ start, end }: SlotInfo) => {
      const resolution = resolveSelection(allSlots, start, end, new Date())
      if (resolution.kind === 'range') {
        setSelectionError(null)
        onSlotSelect(resolution.start, resolution.end)
        return
      }
      if (resolution.kind === 'taken') {
        setSelectionError(
          `A hora ${format(resolution.from, 'HH:mm', { locale: pt })}–${format(resolution.to, 'HH:mm', { locale: pt })} já está reservada. Escolhe um intervalo livre.`,
        )
        return
      }
      if (resolution.kind === 'past') {
        setSelectionError('Essa hora já passou. Escolhe um horário a partir de agora.')
        return
      }
      if (resolution.kind === 'closed') {
        setSelectionError('O intervalo escolhido inclui horas fora do horário de funcionamento.')
        return
      }
      // 'none': nothing bookable under the selection at all (closed day or
      // hours outside every open window).
      setSelectionError('Esse período está fora do horário de funcionamento. Escolhe uma hora a verde.')
    },
    [allSlots, onSlotSelect]
  )

  const handleDrillDown = useCallback((date: Date) => {
    setSelectedDate(date)
    setView('day')
  }, [])

  return (
    <>
      {selectionError && (
        <p role="alert" className="mb-3 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          {selectionError}
        </p>
      )}
      {isLoadingSlots && (
        <p role="status" className="mb-3 text-sm text-muted-foreground bg-background rounded-lg px-3 py-2">
          A carregar disponibilidade…
        </p>
      )}
      {failedQueries.length > 0 && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
          <span>Não foi possível carregar a disponibilidade desta sala.</span>
          <button type="button" onClick={retryFailed} className="font-medium underline">
            Tentar novamente
          </button>
        </div>
      )}
      {isClosed && (
        <p role="status" className="mb-3 text-sm text-foreground bg-accent rounded-lg px-3 py-2">
          {view === 'week' ? 'Fechado nesta semana.' : 'Fechado neste dia.'} Usa as setas para ver outro dia.
        </p>
      )}
      <div className="h-[600px] [&_.rbc-today]:bg-accent [&_.rbc-selected]:bg-primary/20 [&_.rbc-event]:bg-muted-foreground [&_.rbc-toolbar-label]:font-semibold [&_.rbc-toolbar-label]:text-foreground">
        <Calendar
          localizer={localizer}
          events={events}
          view={view}
          onView={setView}
          views={['day', 'week', 'month']}
          selectable={view !== 'month'}
          onSelectSlot={handleSelectSlot}
          onDrillDown={handleDrillDown}
          onNavigate={setSelectedDate}
          date={selectedDate}
          min={range.min}
          max={range.max}
          step={60}
          timeslots={1}
          culture="pt"
          formats={{
            // Default rbc labels come out as "sexta-feira set 18" (B33d).
            dayHeaderFormat: (date, culture, loc) => loc!.format(date, "EEEE, d 'de' MMMM", culture),
            dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
              `${loc!.format(start, "d 'de' MMM", culture)} – ${loc!.format(end, "d 'de' MMM", culture)}`,
            monthHeaderFormat: (date, culture, loc) => loc!.format(date, "MMMM 'de' yyyy", culture),
          }}
          messages={{
            today: 'Hoje',
            previous: '‹',
            next: '›',
            day: 'Dia',
            week: 'Semana',
            month: 'Mês',
            noEventsInRange: 'Sem reservas.',
            showMore: (total: number) => `+${total} mais`,
          }}
          eventPropGetter={() => ({
            style: { backgroundColor: '#6B7280', border: 'none', borderRadius: '4px', opacity: 0.85 },
          })}
          slotPropGetter={(date) => {
            if (view === 'month') return {}
            const slot = slotAt(allSlots, date)
            if (slot && isPastSlot(slot, new Date())) {
              return { style: { backgroundColor: '#fafafa', color: '#9ca3af', cursor: 'not-allowed', opacity: 0.6 } }
            }
            if (slot?.available === false) return { style: { backgroundColor: '#f3f4f6' } }
            if (slot?.available === true) return { style: { cursor: 'pointer', backgroundColor: '#f0faf5' } }
            return {}
          }}
        />
      </div>
    </>
  )
}
