'use client'
import { useState, useCallback } from 'react'
import { Calendar, dateFnsLocalizer, type Event } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { useQuery } from '@tanstack/react-query'
import { spacesApi } from '@/lib/api'
import type { Room, AvailabilitySlot } from '@/types'
import 'react-big-calendar/lib/css/react-big-calendar.css'

const locales = { 'pt': pt }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

interface BookingCalendarProps {
  room: Room
  onSlotSelect: (start: Date, end: Date) => void
}

export function BookingCalendar({ room, onSlotSelect }: BookingCalendarProps) {
  const [selectedDate, setSelectedDate] = useState(new Date())

  const dateStr = format(selectedDate, 'yyyy-MM-dd')
  const { data: slots } = useQuery({
    queryKey: ['availability', room.id, dateStr],
    queryFn: () => spacesApi.getAvailability(room.id, dateStr),
  })

  const events: Event[] = (slots ?? [])
    .filter((s: AvailabilitySlot) => !s.available)
    .map((s: AvailabilitySlot) => ({
      title: 'Ocupado',
      start: parseISO(s.start),
      end: parseISO(s.end),
      resource: { available: false },
    }))

  const handleSelectSlot = useCallback(
    ({ start, end }: { start: Date; end: Date }) => {
      const slotStr = format(start, 'HH:mm')
      const slot = (slots ?? []).find((s: AvailabilitySlot) =>
        format(parseISO(s.start), 'HH:mm') === slotStr
      )
      if (slot?.available) {
        onSlotSelect(parseISO(slot.start), parseISO(slot.end))
      }
    },
    [slots, onSlotSelect]
  )

  return (
    <div className="h-[500px] [&_.rbc-today]:bg-[#E8F4F0] [&_.rbc-selected]:bg-[#3D7A5E]/20 [&_.rbc-event]:bg-[#6B7280] [&_.rbc-toolbar-label]:font-semibold [&_.rbc-toolbar-label]:text-[#1A1A2E]">
      <Calendar
        localizer={localizer}
        events={events}
        defaultView="day"
        views={['day', 'week']}
        selectable
        onSelectSlot={handleSelectSlot}
        onNavigate={setSelectedDate}
        date={selectedDate}
        min={new Date(0, 0, 0, 8, 0)}
        max={new Date(0, 0, 0, 20, 0)}
        step={60}
        timeslots={1}
        culture="pt"
        messages={{
          today: 'Hoje', previous: '‹', next: '›',
          day: 'Dia', week: 'Semana', noEventsInRange: 'Sem reservas.',
        }}
        eventPropGetter={() => ({
          style: { backgroundColor: '#6B7280', border: 'none', borderRadius: '4px', opacity: 0.8 },
        })}
        slotPropGetter={(date) => {
          const slotStr = format(date, "yyyy-MM-dd'T'HH:mm:ss")
          const slot = (slots ?? []).find((s: AvailabilitySlot) => s.start.startsWith(slotStr.substring(0, 16)))
          if (slot?.available === false) return { style: { backgroundColor: '#f3f4f6' } }
          return { style: { cursor: 'pointer', backgroundColor: '#f0faf5' } }
        }}
      />
    </div>
  )
}
