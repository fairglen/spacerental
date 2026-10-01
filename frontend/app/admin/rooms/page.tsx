'use client'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { useListState } from '@/components/admin/crud/useListState'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'
import type { Room } from '@/types'

type RoomRow = Room & { spaceName: string }
const FILTERS = ['space', 'active'] as const

/** Salas across every space (G06); a room is created from its space's page. */
export default function AdminRoomsListPage() {
  const { api, enabled, currentOrgId } = useCrud('rooms')
  const { state, set } = useListState(FILTERS, { sort: 'name' })
  const { data: spaces, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'spaces', currentOrgId],
    queryFn: () => adminApi.getSpaces(api),
    enabled,
  })
  const q = state.q.trim().toLowerCase()
  const all: RoomRow[] = (spaces ?? []).flatMap((s) => (s.rooms ?? []).map((r) => ({ ...r, spaceName: s.name })))
  const rows = all
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.spaceName.toLowerCase().includes(q))
    .filter((r) => !state.filters.space || r.space_id === state.filters.space)
    .filter((r) => !state.filters.active || String(r.is_active) === state.filters.active)
    .sort((a, b) => {
      const dir = state.sort.startsWith('-') ? -1 : 1
      const key = state.sort.replace(/^-/, '')
      if (key === 'rate') return dir * (a.hourly_rate - b.hourly_rate)
      return dir * a.name.localeCompare(b.name, 'pt')
    })
  const pageSize = 20
  const columns: Column<RoomRow>[] = [
    { key: 'name', header: 'Sala', sortKey: 'name', render: (r) => <span className="font-medium text-foreground"><span className="inline-block h-3 w-3 rounded-full mr-2 align-middle" style={{ backgroundColor: r.color }} aria-hidden />{r.name}</span> },
    { key: 'space', header: 'Espaço', render: (r) => <span className="text-muted-foreground">{r.spaceName}</span> },
    { key: 'rate', header: '€/hora', sortKey: 'rate', render: (r) => formatCurrency(r.hourly_rate) },
    { key: 'capacity', header: 'Lotação', render: (r) => String(r.capacity) },
    { key: 'state', header: 'Estado', render: (r) => <Badge variant={r.is_active ? 'default' : 'secondary'}>{r.is_active ? 'Ativa' : 'Inativa'}</Badge> },
  ]
  return (
    <div className="p-8">
      <PageHeader title="Salas" description="Todas as salas, de todos os espaços. Uma sala nova cria-se na página do seu espaço." />
      <EntityList<RoomRow>
        caption="Salas da organização"
        columns={columns}
        rows={isLoading ? undefined : rows.slice((state.page - 1) * pageSize, state.page * pageSize)}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/rooms/${r.id}`}
        total={rows.length}
        page={state.page}
        pageSize={pageSize}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Sala ou espaço' }}
        filters={{
          chips: [
            { key: 'space', label: 'Espaço', options: (spaces ?? []).map((s) => ({ value: s.id, label: s.name })) },
            { key: 'active', label: 'Estado', options: [{ value: 'true', label: 'Ativas' }, { value: 'false', label: 'Inativas' }] },
          ],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        sort={{ options: [{ value: 'name', label: 'Nome' }, { value: '-name', label: 'Nome ↓' }, { value: 'rate', label: 'Preço' }, { value: '-rate', label: 'Preço ↓' }], value: state.sort, onChange: (sort) => set({ sort }) }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Ainda não há salas.', description: 'Crie uma sala na página de um espaço.' }}
      />
    </div>
  )
}
