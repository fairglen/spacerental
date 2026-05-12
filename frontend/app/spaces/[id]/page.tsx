'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { spacesApi } from '@/lib/api'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { RoomCard } from '@/components/spaces/RoomCard'
import { BookingCalendar } from '@/components/booking/BookingCalendar'
import { BookingModal } from '@/components/booking/BookingModal'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Room } from '@/types'

export default function SpacePage({ params }: { params: { id: string } }) {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [bookingStart, setBookingStart] = useState<Date | null>(null)
  const [bookingEnd, setBookingEnd] = useState<Date | null>(null)
  const [calendarRoom, setCalendarRoom] = useState<Room | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['space', params.id],
    queryFn: () => spacesApi.get(params.id),
  })

  const handleBook = (room: Room) => setCalendarRoom(room)
  const handleSlotSelect = (start: Date, end: Date) => {
    setSelectedRoom(calendarRoom)
    setBookingStart(start)
    setBookingEnd(end)
  }

  if (isLoading) return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-48 mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
        </div>
      </div>
      <Footer />
    </>
  )

  const { space, rooms } = data ?? { space: null, rooms: [] }

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-foreground">{space?.name}</h1>
            <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" /> {space?.address}, {space?.city}
            </div>
            {space?.description && <p className="mt-3 text-muted-foreground max-w-2xl">{space.description}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              {space?.amenities.map((a) => <Badge key={a} variant="secondary">{a}</Badge>)}
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="text-xl font-semibold text-foreground mb-6">Salas Disponíveis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            {rooms.filter((r) => r.is_active).map((room) => (
              <RoomCard key={room.id} room={room} onBook={handleBook} />
            ))}
          </div>
          {calendarRoom && (
            <div className="bg-white rounded-xl border border-border p-6">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Disponibilidade — {calendarRoom.name}
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Clica num slot disponível (verde) para reservar. Na vista Mês, clica num dia para ver os horários disponíveis.
              </p>
              <BookingCalendar room={calendarRoom} onSlotSelect={handleSlotSelect} />
            </div>
          )}
        </div>
      </main>
      <Footer />
      <BookingModal
        room={selectedRoom}
        start={bookingStart}
        end={bookingEnd}
        onClose={() => { setSelectedRoom(null); setBookingStart(null); setBookingEnd(null) }}
      />
    </>
  )
}
