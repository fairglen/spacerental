'use client'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Plus } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { useListState } from '@/components/admin/crud/useListState'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { ROLE_LABELS } from '@/components/admin/users/RoleDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { OrgUser } from '@/types'

const FILTERS = ['role', 'disabled'] as const
const PAGE_SIZE = 20

/** Clientes (G06): the org's members, searched, filtered and sorted server-side. */
export default function AdminUsersPage() {
  // Not keyed by organisation on purpose: `useListState` resets the page when
  // the organisation changes, and every query key carries the org already.
  return <UsersList />
}

function UsersList() {
  const { api, enabled, currentOrgId } = useCrud('users')
  const { state, set } = useListState(FILTERS, { sort: 'name' })
  const params = { page: state.page, page_size: PAGE_SIZE, sort: state.sort, ...(state.q ? { q: state.q } : {}), ...(state.filters.role ? { role: state.filters.role } : {}), ...(state.filters.disabled ? { disabled: state.filters.disabled } : {}) }
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'users', currentOrgId, 'list', params],
    queryFn: () => adminApi.getUsers(params, api),
    enabled,
  })
  const columns: Column<OrgUser>[] = [
    { key: 'name', header: 'Nome', sortKey: 'name', render: (u) => <span className="font-medium text-foreground">{u.name || '—'}{u.disabled_at && <Badge variant="destructive" className="ml-2 align-middle">Suspenso</Badge>}</span> },
    { key: 'email', header: 'Email', sortKey: 'email', render: (u) => <span className="text-muted-foreground">{u.email}</span> },
    { key: 'role', header: 'Função', render: (u) => <Badge variant={u.role === 'member' ? 'secondary' : 'default'}>{ROLE_LABELS[u.role]}</Badge> },
    { key: 'bookings', header: 'Reservas', render: (u) => String(u.bookings_count) },
    { key: 'joined', header: 'Desde', sortKey: 'joined_at', render: (u) => <span className="text-muted-foreground whitespace-nowrap">{format(parseISO(u.joined_at), 'd MMM yyyy', { locale: pt })}</span> },
  ]
  return (
    <div className="p-8">
      <PageHeader
        title="Clientes"
        description="Quem pertence a este espaço: clientes e equipa."
        actions={<Button asChild className="gap-2"><Link href="/admin/users/new"><Plus className="h-4 w-4" /> Novo cliente</Link></Button>}
      />
      <EntityList<OrgUser>
        caption="Membros da organização"
        columns={columns}
        rows={isLoading ? undefined : data?.users ?? []}
        rowKey={(u) => u.id}
        rowHref={(u) => `/admin/users/${u.id}`}
        total={data?.total}
        page={state.page}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Nome ou email' }}
        filters={{
          chips: [
            { key: 'role', label: 'Função', options: [{ value: 'member', label: 'Clientes' }, { value: 'admin', label: 'Administradores' }, { value: 'owner', label: 'Proprietários' }] },
            { key: 'disabled', label: 'Estado', options: [{ value: 'false', label: 'Ativos' }, { value: 'true', label: 'Suspensos' }] },
          ],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        sort={{ options: [{ value: 'name', label: 'Nome' }, { value: '-name', label: 'Nome ↓' }, { value: '-joined_at', label: 'Mais recentes' }, { value: 'joined_at', label: 'Mais antigos' }], value: state.sort, onChange: (sort) => set({ sort }) }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Nenhum cliente para estes filtros.', action: <Button asChild><Link href="/admin/users/new">Novo cliente</Link></Button> }}
      />
    </div>
  )
}
