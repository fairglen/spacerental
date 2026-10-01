'use client'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { useListState } from '@/components/admin/crud/useListState'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Badge } from '@/components/ui/badge'
import { formatBookingCost, STATUS_LABELS } from '@/lib/utils'
import { PAYMENT_LABELS } from '@/lib/admin/bookingLabels'
import type { Booking } from '@/types'

const FILTERS = ['room_id', 'status', 'payment_method', 'from', 'to', 'cancelled'] as const
const PAGE_SIZE = 20

/** Reservas (G06): search by customer or id, filters, cancelled toggle, sort — all server-side. */
export default function AdminBookingsPage() {
  // Not keyed by organisation on purpose: `useListState` resets the page when
  // the organisation changes, and every query key carries the org already.
  return <BookingsList />
}

function BookingsList() {
  const { api, enabled, currentOrgId } = useCrud('bookings')
  const { state, set } = useListState(FILTERS, { sort: '-start_time' })
  const params: Record<string, string | number> = { page: state.page, page_size: PAGE_SIZE, sort: state.sort }
  if (state.q) params.q = state.q
  for (const key of ['room_id', 'status', 'payment_method'] as const) if (state.filters[key]) params[key] = state.filters[key]
  if (state.filters.from) params.from = new Date(`${state.filters.from}T00:00:00`).toISOString()
  if (state.filters.to) params.to = new Date(`${state.filters.to}T23:59:59`).toISOString()
  if (state.filters.cancelled === 'hide') params.include_cancelled = 'false'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'bookings', currentOrgId, 'list', params],
    queryFn: () => adminApi.getBookings(params, api),
    enabled,
  })
  const { data: spaces } = useQuery({ queryKey: ['admin', 'spaces', currentOrgId], queryFn: () => adminApi.getSpaces(api), enabled })
  const rooms = (spaces ?? []).flatMap((s) => s.rooms ?? [])

  const columns: Column<Booking>[] = [
    { key: 'when', header: 'Quando', sortKey: 'start_time', render: (b) => (
      <span className="whitespace-nowrap font-medium text-foreground">
        {format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: pt })}–{format(parseISO(b.end_time), 'HH:mm', { locale: pt })}
      </span>
    ) },
    { key: 'customer', header: 'Cliente', render: (b) => <span>{b.user?.name || b.user?.email || '—'}<span className="block text-xs text-muted-foreground">{b.user?.email}</span></span> },
    { key: 'room', header: 'Sala', render: (b) => b.room?.name ?? '—' },
    { key: 'payment', header: 'Pagamento', render: (b) => <span>{PAYMENT_LABELS[b.payment_method]}<span className="block text-xs text-muted-foreground">{formatBookingCost(b)}</span></span> },
    { key: 'status', header: 'Estado', render: (b) => <Badge variant={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' || b.status === 'expired' ? 'secondary' : b.status === 'pending' ? 'warning' : 'default'}>{STATUS_LABELS[b.status]}</Badge> },
    { key: 'created', header: 'Criada', sortKey: 'created_at', render: (b) => <span className="text-muted-foreground whitespace-nowrap">{format(parseISO(b.created_at), 'd MMM', { locale: pt })}</span> },
  ]

  return (
    <div className="p-8">
      <PageHeader title="Reservas" description="Todas as reservas do espaço." />
      <EntityList<Booking>
        caption="Reservas"
        columns={columns}
        rows={isLoading ? undefined : data?.bookings ?? []}
        rowKey={(b) => b.id}
        rowHref={(b) => `/admin/bookings/${b.id}`}
        total={data?.total}
        page={state.page}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Cliente, email ou nº da reserva' }}
        filters={{
          chips: [
            { key: 'room_id', label: 'Sala', options: rooms.map((r) => ({ value: r.id, label: r.name })) },
            { key: 'status', label: 'Estado', options: (Object.keys(STATUS_LABELS) as Booking['status'][]).map((s) => ({ value: s, label: STATUS_LABELS[s] })) },
            { key: 'payment_method', label: 'Pagamento', options: (Object.keys(PAYMENT_LABELS) as Booking['payment_method'][]).map((m) => ({ value: m, label: PAYMENT_LABELS[m] })) },
            { key: 'cancelled', label: 'Canceladas', options: [{ value: 'hide', label: 'Ocultar canceladas' }] },
          ],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        sort={{
          options: [
            { value: '-start_time', label: 'Mais recentes primeiro' }, { value: 'start_time', label: 'Mais antigas primeiro' },
            { value: '-created_at', label: 'Criadas há menos tempo' }, { value: 'created_at', label: 'Criadas há mais tempo' },
          ],
          value: state.sort,
          onChange: (sort) => set({ sort }),
        }}
        toolbarExtra={
          <span className="flex items-center gap-1 text-sm">
            <label className="sr-only" htmlFor="from">De</label>
            <input id="from" type="date" aria-label="De" value={state.filters.from ?? ''} onChange={(e) => set({ filters: { from: e.target.value || undefined } })} className="h-10 rounded-lg border border-border px-2 text-sm bg-white" />
            <span aria-hidden>–</span>
            <label className="sr-only" htmlFor="to">Até</label>
            <input id="to" type="date" aria-label="Até" value={state.filters.to ?? ''} onChange={(e) => set({ filters: { to: e.target.value || undefined } })} className="h-10 rounded-lg border border-border px-2 text-sm bg-white" />
          </span>
        }
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Sem reservas para estes filtros.' }}
      />
    </div>
  )
}
