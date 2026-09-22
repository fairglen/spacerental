'use client'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { spacesApi } from '@/lib/api'
import { RoomCard } from '@/components/spaces/RoomCard'
import { SpaceLocation } from '@/components/spaces/SpaceLocation'
import { PhotoMosaic } from '@/components/spaces/PhotoMosaic'
import { BookingCalendar } from '@/components/booking/BookingCalendar'
import { BookingModal } from '@/components/booking/BookingModal'
import { ContactNote } from '@/components/booking/ContactNote'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { Room } from '@/types'

export function SpaceRoomsSkeleton() {
  return (
    <div className="min-h-screen bg-background p-8" data-testid="page-skeleton">
      <Skeleton className="h-8 w-64 mb-4" />
      <Skeleton className="h-4 w-48 mb-8" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 w-full rounded-xl" />)}
      </div>
    </div>
  )
}

/**
 * A space's rooms and booking calendar — the body of `/spaces/[id]`, and of
 * `/spaces` itself while there is only one space (C11).
 *
 * `?room=<id>` preselects a room and opens its calendar, which is how a room
 * card on the landing page lands here. It works on either URL.
 */
export function SpaceRoomsView({ spaceId }: { spaceId: string }) {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [bookingStart, setBookingStart] = useState<Date | null>(null)
  const [bookingEnd, setBookingEnd] = useState<Date | null>(null)
  const [calendarRoom, setCalendarRoom] = useState<Room | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['space', spaceId],
    queryFn: () => spacesApi.get(spaceId),
  })

  const handleBook = (room: Room) => setCalendarRoom(room)

  // Applied once, when the rooms first arrive: after that the customer's own
  // clicks decide. An id that is not one of this space's active rooms (stale
  // link, typo, a room since deactivated) is ignored without comment — the
  // page is still perfectly usable, so there is nothing to report.
  const requestedRoomId = useSearchParams().get('room')
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current || !data) return
    deepLinkApplied.current = true
    const requested = data.rooms.find((r) => r.id === requestedRoomId && r.is_active)
    if (requested) setCalendarRoom(requested)
  }, [data, requestedRoomId])

  // The calendar mounts below the fold, so without this "Reservar Esta Sala"
  // looked like it did nothing (B27). Bring the section on screen and move
  // focus to its heading so keyboard/screen-reader users land there too.
  const calendarSectionRef = useRef<HTMLDivElement>(null)
  const calendarHeadingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!calendarRoom) return
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    calendarSectionRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    calendarHeadingRef.current?.focus({ preventScroll: true })
  }, [calendarRoom])
  const handleSlotSelect = (start: Date, end: Date) => {
    setSelectedRoom(calendarRoom)
    setBookingStart(start)
    setBookingEnd(end)
  }

  if (isLoading) return <SpaceRoomsSkeleton />

  const { space, rooms } = data ?? { space: null, rooms: [] }

  return (
    <>
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-foreground">{space?.name}</h1>
            {space && <SpaceLocation space={space} variant="compact" className="mt-3 max-w-2xl" />}
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
              <RoomCard key={room.id} room={room} onBook={handleBook} selected={calendarRoom?.id === room.id} />
            ))}
          </div>
          {calendarRoom && (
            <div ref={calendarSectionRef} className="bg-white rounded-xl border border-border p-6 scroll-mt-20">
              {/* The room being booked, across the content width (V01): a
                  mosaic on wide screens, the carousel below; the same
                  placeholder the card carries, at the mosaic's size, when
                  there are no photos. */}
              <PhotoMosaic
                photos={calendarRoom.photos ?? []}
                label={calendarRoom.name}
                className="mb-6"
                placeholder={
                  <div
                    data-testid="photo-placeholder"
                    className="mb-6 flex aspect-[2/1] w-full items-center justify-center rounded-xl text-5xl"
                    style={{ backgroundColor: calendarRoom.color + '33' }}
                    aria-hidden="true"
                  >
                    🛋️
                  </div>
                }
              />
              <h3 ref={calendarHeadingRef} tabIndex={-1} className="text-lg font-semibold text-foreground mb-2 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                Disponibilidade — {calendarRoom.name}
              </h3>
              <p data-testid="calendar-help" className="text-sm text-muted-foreground mb-3">
                Clique numa hora livre para reservar 1 hora, ou arraste para reservar várias seguidas.
              </p>
              <ContactNote roomName={calendarRoom.name} className="mb-4" />
              <BookingCalendar room={calendarRoom} onSlotSelect={handleSlotSelect} />
            </div>
          )}
        </div>
      </main>
      <BookingModal
        room={selectedRoom}
        start={bookingStart}
        end={bookingEnd}
        onClose={() => { setSelectedRoom(null); setBookingStart(null); setBookingEnd(null) }}
      />
    </>
  )
}
