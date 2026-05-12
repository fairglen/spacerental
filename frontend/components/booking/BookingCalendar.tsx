'use client'
import { useState, useCallback } from 'react'
import { Calendar, dateFnsLocalizer, type Event, type View } from 'react-big-calendar'
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

export function BookingCalendar({ room, onSlotSelect }: BookingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [view, setView] = useState<View>('day')

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
    ({ start }: { start: Date }) => {
      const slot = allSlots.find((s) => parseISO(s.start).getTime() === start.getTime())
      if (slot?.available) {
        onSlotSelect(parseISO(slot.start), parseISO(slot.end))
      }
    },
    [allSlots, onSlotSelect]
  )

  const handleDrillDown = useCallback((date: Date) => {
    setSelectedDate(date)
    setView('day')
  }, [])

  return (
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
          const slot = allSlots.find((s) => parseISO(s.start).getTime() === date.getTime())
          if (slot?.available === false) return { style: { backgroundColor: '#f3f4f6' } }
          if (slot?.available === true) return { style: { cursor: 'pointer', backgroundColor: '#f0faf5' } }
          return {}
        }}
      />
    </div>
  )
}
