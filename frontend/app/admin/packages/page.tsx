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
import { formatCurrency } from '@/lib/utils'
import type { Package } from '@/types'

const FILTERS = ['active'] as const

/** Pacotes (G06): the packs on sale, each opening its page. */
export default function AdminPackagesPage() {
  const { api, enabled, currentOrgId } = useCrud('packages')
  const { state, set } = useListState(FILTERS, { sort: 'hours' })
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'packages', currentOrgId], queryFn: () => adminApi.getPackages(api), enabled })
  const q = state.q.trim().toLowerCase()
  const rows = (data ?? [])
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .filter((p) => !state.filters.active || String(p.is_active) === state.filters.active)
    .sort((a, b) => {
      const dir = state.sort.startsWith('-') ? -1 : 1
      const key = state.sort.replace(/^-/, '')
      if (key === 'price') return dir * (a.price - b.price)
      if (key === 'name') return dir * a.name.localeCompare(b.name, 'pt')
      return dir * (a.hours - b.hours)
    })
  const columns: Column<Package>[] = [
    { key: 'name', header: 'Pack', sortKey: 'name', render: (p) => <span className="font-medium text-foreground">{p.name}</span> },
    { key: 'hours', header: 'Horas', sortKey: 'hours', render: (p) => `${p.hours}h` },
    { key: 'price', header: 'Preço', sortKey: 'price', render: (p) => formatCurrency(p.price) },
    { key: 'validity', header: 'Validade', render: (p) => `${p.validity_days} dias` },
    { key: 'state', header: 'Estado', render: (p) => <Badge variant={p.is_active ? 'default' : 'secondary'}>{p.is_active ? 'À venda' : 'Inativo'}</Badge> },
  ]
  return (
    <div className="p-8">
      <PageHeader title="Pacotes" description="Os packs de horas à venda." actions={<Button asChild className="gap-2"><Link href="/admin/packages/new"><Plus className="h-4 w-4" /> Novo pack</Link></Button>} />
      <EntityList<Package>
        caption="Packs"
        columns={columns}
        rows={isLoading ? undefined : rows}
        rowKey={(p) => p.id}
        rowHref={(p) => `/admin/packages/${p.id}`}
        total={rows.length}
        page={1}
        pageSize={100}
        onPageChange={() => undefined}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Nome' }}
        filters={{ chips: [{ key: 'active', label: 'Estado', options: [{ value: 'true', label: 'À venda' }, { value: 'false', label: 'Inativos' }] }], values: state.filters, onChange: (key, value) => set({ filters: { [key]: value } }) }}
        sort={{ options: [{ value: 'hours', label: 'Horas' }, { value: '-hours', label: 'Horas ↓' }, { value: 'price', label: 'Preço' }, { value: 'name', label: 'Nome' }], value: state.sort, onChange: (sort) => set({ sort }) }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Ainda não há packs.', action: <Button asChild><Link href="/admin/packages/new">Novo pack</Link></Button> }}
      />
    </div>
  )
}
