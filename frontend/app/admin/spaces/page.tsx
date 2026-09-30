'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { useListState } from '@/components/admin/crud/useListState'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { addressLines } from '@/lib/location'
import type { Space } from '@/types'

const FILTERS = ['active'] as const

/** Espaços (G06): the list over the kit; each row opens its page. */
export default function AdminSpacesPage() {
  const { api, enabled, currentOrgId } = useCrud('spaces')
  const { state, set } = useListState(FILTERS, { sort: 'name' })
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'spaces', currentOrgId],
    queryFn: () => adminApi.getSpaces(api),
    enabled,
  })
  const q = state.q.trim().toLowerCase()
  const rows = (data ?? [])
    .filter((s) => !q || s.name.toLowerCase().includes(q) || addressLines(s).join(' ').toLowerCase().includes(q))
    .filter((s) => !state.filters.active || String(s.is_active) === state.filters.active)
    .sort((a, b) => {
      const dir = state.sort.startsWith('-') ? -1 : 1
      const key = state.sort.replace(/^-/, '')
      if (key === 'rooms') return dir * ((a.rooms?.length ?? 0) - (b.rooms?.length ?? 0))
      return dir * a.name.localeCompare(b.name, 'pt')
    })
  const pageSize = 20
  const paged = rows.slice((state.page - 1) * pageSize, state.page * pageSize)

  const columns: Column<Space>[] = [
    { key: 'name', header: 'Nome', sortKey: 'name', render: (s) => <span className="font-medium text-foreground">{s.name}</span> },
    { key: 'address', header: 'Morada', render: (s) => <span className="text-muted-foreground">{addressLines(s).join(', ') || '—'}</span> },
    { key: 'rooms', header: 'Salas', sortKey: 'rooms', render: (s) => String(s.rooms?.length ?? 0) },
    { key: 'state', header: 'Estado', render: (s) => <Badge variant={s.is_active ? 'default' : 'secondary'}>{s.is_active ? 'Ativo' : 'Inativo'}</Badge> },
  ]

  return (
    <div className="p-8">
      <PageHeader
        title="Espaços"
        description="Os locais e as suas salas."
        actions={<Button asChild className="gap-2"><Link href="/admin/spaces/new"><Plus className="h-4 w-4" /> Novo espaço</Link></Button>}
      />
      <EntityList<Space>
        caption="Espaços da organização"
        columns={columns}
        rows={isLoading ? undefined : paged}
        rowKey={(s) => s.id}
        rowHref={(s) => `/admin/spaces/${s.id}`}
        total={rows.length}
        page={state.page}
        pageSize={pageSize}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Nome ou morada' }}
        filters={{
          chips: [{ key: 'active', label: 'Estado', options: [{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }] }],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        sort={{ options: [{ value: 'name', label: 'Nome' }, { value: '-name', label: 'Nome ↓' }, { value: '-rooms', label: 'Mais salas' }], value: state.sort, onChange: (sort) => set({ sort }) }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Ainda não há espaços.', description: 'Crie o primeiro para começar a receber reservas.', action: <Button asChild><Link href="/admin/spaces/new">Novo espaço</Link></Button> }}
      />
    </div>
  )
}
