'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { Calendar, dateFnsLocalizer, type View } from 'react-big-calendar'
import withDragAndDrop, { type EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop'
import { addDays, endOfDay, endOfWeek, format, getDay, parse, parseISO, startOfDay, startOfWeek } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'
import { STATUS_LABELS, isUnpaidHold } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { BookingSheet } from '@/components/admin/calendar/BookingSheet'
import { MoveConfirm, type MoveProposal } from '@/components/admin/calendar/MoveConfirm'
import { NewEntryDialog } from '@/components/admin/calendar/NewEntryDialog'
import type { Booking, Room, RoomBlock, Space } from '@/types'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'

const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { pt } })

type CalEvent = {
  id: string
  title: string
  start: Date
  end: Date
  resourceId: string
  kind: 'booking' | 'block'
  booking?: Booking
  block?: RoomBlock
}
const DnDCalendar = withDragAndDrop<CalEvent, Room>(Calendar as never)

const DAY_START = 7
const DAY_END = 22
const STATUS_MARK: Record<Booking['status'], string> = {
  confirmed: '✓', pending: '⏳', cancelled: '✕', completed: '✓', expired: '⌛', paid_unfulfilled: '!',
}
const STATUS_BG: Record<Booking['status'], string> = {
  confirmed: '#3D7A5E', pending: '#B45309', cancelled: '#9CA3AF', completed: '#6B7280', expired: '#9CA3AF', paid_unfulfilled: '#B91C1C',
}
const PAY_TAG: Record<Booking['payment_method'], string> = { hourly: '', package: 'pack', mixed: 'pack+', manual: 'local' }

/**
 * /admin/calendar (A03). "Dia por sala": one column per active room of the
 * selected space; "Semana": one room. Every write goes through a confirm step
 * and the A01/A02 endpoints — never optimistic on money-bearing objects.
 */
export default function AdminCalendarPage() {
  const { currentOrgId } = useOrg()
  return <OrgCalendar key={currentOrgId} />
}

function OrgCalendar() {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  const router = useRouter()
  const params = useSearchParams()

  // View, room, date and space live in the URL so a reload (and a shared
  // link) lands on the same screen.
  const view: 'day' | 'week' = params.get('view') === 'week' ? 'week' : 'day'
  const date = useMemo(() => { const d = params.get('date'); return d ? parseISO(d) : new Date() }, [params])
  const spaceParam = params.get('space')
  const roomParam = params.get('room')
  const showCancelled = params.get('cancelled') === '1'
  const setParams = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') next.delete(k); else next.set(k, v) }
    router.replace(`/admin/calendar?${next.toString()}`)
  }, [params, router])

  const { data: spaces = [], isLoading: spacesLoading, isError: spacesError } = useQuery({
    queryKey: ['admin', 'spaces', session?.accessToken],
    queryFn: () => adminApi.getSpaces(api),
    enabled: !!session?.accessToken,
  })
  const activeSpaces = spaces.filter((s) => s.is_active)
  const space: Space | undefined = activeSpaces.find((s) => s.id === spaceParam) ?? activeSpaces[0]
  const rooms: Room[] = (space?.rooms ?? []).filter((r) => r.is_active)
  const weekRoom: Room | undefined = rooms.find((r) => r.id === roomParam) ?? rooms[0]
  const visibleRooms = view === 'week' ? (weekRoom ? [weekRoom] : []) : rooms

  const from = view === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : startOfDay(date)
  const to = view === 'week' ? endOfWeek(date, { weekStartsOn: 1 }) : endOfDay(date)

  const bookingsQuery = useQuery({
    queryKey: ['admin', 'calendar', 'bookings', space?.id, view, from.toISOString()],
    queryFn: () => adminApi.getBookings({ from: from.toISOString(), to: to.toISOString(), page_size: 100 }, api),
    enabled: !!session?.accessToken && !!space,
    refetchOnWindowFocus: true,
  })
  const blockQueries = useQueries({
    queries: visibleRooms.map((r) => ({
      queryKey: ['admin', 'calendar', 'blocks', r.id, from.toISOString()],
      queryFn: () => adminApi.getBlocks(r.id, { from: from.toISOString(), to: to.toISOString() }, api),
      enabled: !!session?.accessToken,
      refetchOnWindowFocus: true,
    })),
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'calendar'] })
    qc.invalidateQueries({ queryKey: ['admin', 'bookings'] })
  }

  const roomIds = new Set(visibleRooms.map((r) => r.id))
  const events: CalEvent[] = useMemo(() => {
    const bookings = (bookingsQuery.data?.bookings ?? [])
      .filter((b) => roomIds.has(b.room_id) && (showCancelled || !['cancelled', 'expired'].includes(b.status)))
      .map((b) => ({
        id: b.id,
        title: `${STATUS_MARK[b.status]} ${b.user?.name ?? b.user?.email ?? 'Cliente'}${PAY_TAG[b.payment_method] ? ` · ${PAY_TAG[b.payment_method]}` : ''}`,
        start: parseISO(b.start_time), end: parseISO(b.end_time), resourceId: b.room_id, kind: 'booking' as const, booking: b,
      }))
    const blocks = blockQueries.flatMap((q) => q.data ?? []).map((k) => ({
      id: k.id, title: `⛔ ${k.reason}`, start: parseISO(k.start_time), end: parseISO(k.end_time), resourceId: k.room_id, kind: 'block' as const, block: k,
    }))
    return [...bookings, ...blocks]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingsQuery.data, blockQueries.map((q) => q.data), showCancelled, view, weekRoom?.id, rooms.length])

  const [selected, setSelected] = useState<Booking | null>(null)
  const [proposal, setProposal] = useState<MoveProposal | null>(null)
  const [newSlot, setNewSlot] = useState<{ room: Room; start: Date; end: Date } | null>(null)
  const [blockToEdit, setBlockToEdit] = useState<RoomBlock | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)

  // Opening hours union for the vertical range; 07–22 at least.
  const { min, max } = useMemo(() => {
    const d = (h: number, m = 0) => new Date(1970, 0, 1, h, m)
    return { min: d(DAY_START), max: d(DAY_END) }
  }, [])

  const onEventDrop = ({ event, start, end, resourceId }: EventInteractionArgs<CalEvent>) => {
    if (event.kind !== 'booking' || !event.booking) return
    const room = rooms.find((r) => r.id === String(resourceId ?? event.resourceId))
    if (!room) return
    setProposal({ booking: event.booking, room, start: new Date(start), end: new Date(end) })
  }
  const onEventResize = ({ event, start, end }: EventInteractionArgs<CalEvent>) => {
    if (event.kind !== 'booking' || !event.booking) return
    const room = rooms.find((r) => r.id === event.resourceId)
    if (!room) return
    setProposal({ booking: event.booking, room, start: new Date(start), end: new Date(end) })
  }
  const confirmMove = async () => {
    if (!proposal) return
    const body = { start_time: proposal.start.toISOString(), end_time: proposal.end.toISOString(), ...(proposal.room.id !== proposal.booking.room_id ? { room_id: proposal.room.id } : {}) }
    await adminApi.updateBookingDetails(proposal.booking.id, body, api)
    setProposal(null)
    refresh()
  }
  const deleteBlock = async (block: RoomBlock) => {
    setPageError(null)
    try { await adminApi.deleteBlock(block.room_id, block.id, api); setBlockToEdit(null); refresh() } catch (e) { setPageError(adminBookingErrorMessage(e)) }
  }

  const [wide, setWide] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(mq.matches)
    update(); mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (spacesLoading) return <div className="p-8"><Skeleton className="h-[70vh] rounded-xl" /></div>
  if (spacesError) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar os espaços. Recarregue a página.</p></div>
  if (!space) return <div className="p-8"><p className="text-sm text-muted-foreground">Ainda não há espaços ativos. Crie um em Espaços.</p></div>

  const loading = bookingsQuery.isLoading || blockQueries.some((q) => q.isLoading)
  const failed = bookingsQuery.isError || blockQueries.some((q) => q.isError)

  return (
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Calendário</h1>
          <p className="text-sm text-muted-foreground">Arraste para mover; clique numa reserva para ver e alterar; clique num espaço vazio para reservar ou bloquear.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {activeSpaces.length > 1 && (
            <div>
              <Label htmlFor="cal-space">Espaço</Label>
              <select id="cal-space" value={space.id} onChange={(e) => setParams({ space: e.target.value, room: null })} className="mt-1 flex h-9 rounded-lg border border-border bg-white px-3 text-sm">
                {activeSpaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {view === 'week' && (
            <div>
              <Label htmlFor="cal-room">Sala</Label>
              <select id="cal-room" value={weekRoom?.id ?? ''} onChange={(e) => setParams({ room: e.target.value })} className="mt-1 flex h-9 rounded-lg border border-border bg-white px-3 text-sm">
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="cal-date">Data</Label>
            <input id="cal-date" type="date" value={format(date, 'yyyy-MM-dd')} onChange={(e) => setParams({ date: e.target.value })} className="mt-1 flex h-9 rounded-lg border border-border bg-white px-3 text-sm" />
          </div>
          <div role="group" aria-label="Vista" className="flex rounded-lg border border-border bg-white p-0.5">
            <Button size="sm" variant={view === 'day' ? 'default' : 'ghost'} onClick={() => setParams({ view: 'day' })}>Dia por sala</Button>
            <Button size="sm" variant={view === 'week' ? 'default' : 'ghost'} onClick={() => setParams({ view: 'week', room: weekRoom?.id ?? null })}>Semana</Button>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setParams({ cancelled: e.target.checked ? '1' : null })} className="h-4 w-4 rounded border-border" />
            mostrar canceladas
          </label>
        </div>
      </div>

      {pageError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{pageError}</p>}
      {failed && (
        <p role="alert" className="mb-3 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar o calendário.
          <Button size="sm" variant="outline" onClick={refresh}>Tentar novamente</Button>
        </p>
      )}
      {loading && <p role="status" className="mb-3 text-sm text-muted-foreground">A carregar…</p>}
      {!loading && !failed && events.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">{view === 'week' ? 'Sem reservas nem bloqueios nesta semana.' : 'Sem reservas nem bloqueios neste dia.'}</p>
      )}

      {wide ? (
        <div className="h-[calc(100vh-14rem)] min-h-[560px] [&_.rbc-today]:bg-accent [&_.rbc-toolbar]:hidden [&_.rbc-time-view]:bg-white [&_.rbc-time-view]:rounded-xl [&_.rbc-time-view]:border-border">
          <DnDCalendar
            localizer={localizer}
            culture="pt"
            date={date}
            onNavigate={(d) => setParams({ date: format(d, 'yyyy-MM-dd') })}
            view={view as View}
            onView={() => undefined}
            views={['day', 'week']}
            events={events}
            resources={view === 'day' ? rooms : undefined}
            resourceIdAccessor={(r: Room) => r.id}
            resourceTitleAccessor={(r: Room) => r.name}
            min={min}
            max={max}
            step={60}
            timeslots={1}
            selectable
            resizable
            draggableAccessor={(e: CalEvent) => e.kind === 'booking' && ['pending', 'confirmed'].includes(e.booking?.status ?? '')}
            resizableAccessor={(e: CalEvent) => e.kind === 'booking' && ['pending', 'confirmed'].includes(e.booking?.status ?? '')}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
            onSelectEvent={(e: CalEvent) => { if (e.kind === 'booking' && e.booking) { setSelected(e.booking); setBlockToEdit(null) } else if (e.block) { setBlockToEdit(e.block); setSelected(null) } }}
            onSelectSlot={({ start, end, resourceId }) => {
              const room = rooms.find((r) => r.id === String(resourceId ?? weekRoom?.id))
              if (room) setNewSlot({ room, start: new Date(start), end: new Date(end) })
            }}
            eventPropGetter={(e: CalEvent) => ({
              style: e.kind === 'block'
                ? { backgroundImage: 'repeating-linear-gradient(45deg, #9CA3AF 0 6px, #D1D5DB 6px 12px)', color: '#111827', border: 'none', borderRadius: 4 } as CSSProperties
                : { backgroundColor: STATUS_BG[e.booking!.status], border: 'none', borderRadius: 4, opacity: ['cancelled', 'expired'].includes(e.booking!.status) ? 0.55 : 1 },
              title: e.kind === 'booking' && e.booking ? `${STATUS_LABELS[e.booking.status]} — ${e.booking.user?.email ?? ''}` : e.block?.reason,
            })}
            slotPropGetter={(d: Date) => (d.getHours() < 8 || d.getHours() >= 20 ? { style: { backgroundColor: '#f3f4f6' } } : {})}
            formats={{
              dayHeaderFormat: (d, culture, loc) => loc!.format(d, "EEEE, d 'de' MMMM", culture),
              dayRangeHeaderFormat: ({ start, end }, culture, loc) => `${loc!.format(start, "d 'de' MMM", culture)} – ${loc!.format(end, "d 'de' MMM", culture)}`,
            }}
            messages={{ today: 'Hoje', previous: '‹', next: '›', day: 'Dia', week: 'Semana', noEventsInRange: 'Sem reservas.' }}
          />
        </div>
      ) : (
        <AgendaList events={events} rooms={rooms} onOpen={(b) => setSelected(b)} />
      )}

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ backgroundColor: STATUS_BG.confirmed }} /> ✓ confirmada</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ backgroundColor: STATUS_BG.pending }} /> ⏳ pendente / a aguardar pagamento</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm align-middle" style={{ backgroundImage: 'repeating-linear-gradient(45deg, #9CA3AF 0 3px, #D1D5DB 3px 6px)' }} /> ⛔ bloqueio</span>
        <span>pack · pack+ · local = como foi paga</span>
        {!wide && <span>Arrastar para mover está disponível em ecrãs largos; aqui use "Alterar horário" na reserva.</span>}
      </div>

      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => setParams({ date: format(new Date(), 'yyyy-MM-dd') })}>Hoje</Button>
        <Button size="sm" variant="outline" aria-label="Anterior" onClick={() => setParams({ date: format(addDays(date, view === 'week' ? -7 : -1), 'yyyy-MM-dd') })}>‹</Button>
        <Button size="sm" variant="outline" aria-label="Seguinte" onClick={() => setParams({ date: format(addDays(date, view === 'week' ? 7 : 1), 'yyyy-MM-dd') })}>›</Button>
        <span className="self-center text-sm font-medium text-foreground">
          {view === 'week' ? `${format(from, "d 'de' MMM", { locale: pt })} – ${format(to, "d 'de' MMM", { locale: pt })}` : format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt })}
        </span>
      </div>

      {selected && (
        <BookingSheet
          booking={selected}
          rooms={rooms}
          onClose={() => setSelected(null)}
          onChanged={(b) => { setSelected(b); refresh() }}
        />
      )}
      {blockToEdit && (
        <aside role="dialog" aria-labelledby="block-title" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-white p-4 shadow-xl">
          <h2 id="block-title" className="text-lg font-semibold text-foreground">Bloqueio</h2>
          <p className="mt-2 text-sm text-foreground">{blockToEdit.reason}</p>
          <p className="text-sm text-muted-foreground">{rooms.find((r) => r.id === blockToEdit.room_id)?.name} · {format(parseISO(blockToEdit.start_time), "d MMM, HH:mm", { locale: pt })}–{format(parseISO(blockToEdit.end_time), 'HH:mm')}</p>
          <div className="mt-4 flex gap-2">
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void deleteBlock(blockToEdit)}>Remover bloqueio</Button>
            <Button size="sm" variant="outline" onClick={() => setBlockToEdit(null)}>Fechar</Button>
          </div>
        </aside>
      )}
      {proposal && <MoveConfirm proposal={proposal} onConfirm={confirmMove} onCancel={() => setProposal(null)} />}
      {/* Keyed per slot: the form's initial values come from the slot picked, every time. */}
      {newSlot && <NewEntryDialog key={`${newSlot.room.id}-${newSlot.start.toISOString()}`} slot={newSlot} rooms={rooms} onClose={() => setNewSlot(null)} onCreated={refresh} />}
    </div>
  )
}

/** Below 1024px: a read-only list per day; the sheet still opens. */
function AgendaList({ events, rooms, onOpen }: { events: CalEvent[]; rooms: Room[]; onOpen: (b: Booking) => void }) {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime())
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-white">
      {sorted.map((e) => (
        <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">{format(e.start, 'HH:mm')}–{format(e.end, 'HH:mm')} · {rooms.find((r) => r.id === e.resourceId)?.name}</p>
            <p className="text-muted-foreground">{e.title}</p>
          </div>
          {e.kind === 'booking' && e.booking && (
            <Button size="sm" variant="outline" onClick={() => onOpen(e.booking!)}>Ver</Button>
          )}
        </li>
      ))}
    </ul>
  )
}
