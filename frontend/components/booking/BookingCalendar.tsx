'use client'
import { useState, useCallback } from 'react'
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
  | { kind: 'closed' }
  | { kind: 'none' }

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
function resolveSelection(slots: AvailabilitySlot[], start: Date, end: Date): Resolution {
  const covered = slotsInRange(slots, start, end)
  if (covered.length === 0) return { kind: 'none' }

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

  const events: Event[] = allSlots
    .filter((s) => !s.available)
    .map((s) => ({
      title: 'Ocupado',
      start: parseISO(s.start),
      end: parseISO(s.end),
    }))

  const handleSelectSlot = useCallback(
    ({ start, end }: SlotInfo) => {
      const resolution = resolveSelection(allSlots, start, end)
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
      if (resolution.kind === 'closed') {
        setSelectionError('O intervalo escolhido inclui horas fora do horário de funcionamento.')
      }
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
          min={new Date(0, 0, 0, 8, 0)}
          max={new Date(0, 0, 0, 20, 0)}
          step={60}
          timeslots={1}
          culture="pt"
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
            if (slot?.available === false) return { style: { backgroundColor: '#f3f4f6' } }
            if (slot?.available === true) return { style: { cursor: 'pointer', backgroundColor: '#f0faf5' } }
            return {}
          }}
        />
      </div>
    </>
  )
}
