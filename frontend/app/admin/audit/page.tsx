'use client'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { useListState } from '@/components/admin/crud/useListState'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { actionLabel, HistoryRow } from '@/components/admin/crud/HistoryPanel'
import type { AdminAction, AuditEntityType, AuditFilters } from '@/types'

const FILTERS = ['entity_type', 'entity_id', 'actor', 'from', 'to'] as const
const PAGE_SIZE = 25
const ENTITY_LABELS: Record<AuditEntityType, string> = {
  space: 'Espaço', room: 'Sala', availability_rule: 'Horário', room_block: 'Bloqueio', booking: 'Reserva', user: 'Cliente',
  package: 'Pack', purchase: 'Compra', support_request: 'Pedido de ajuda', organization: 'Organização',
}

/** Histórico (G06): the whole trail, filtered; a row expands to its diff. */
export default function AdminAuditPage() {
  // Not keyed by organisation on purpose: `useListState` resets the page when
  // the organisation changes, and every query key carries the org already.
  return <AuditList />
}

function AuditList() {
  const { api, enabled, currentOrgId } = useCrud('audit')
  const { state, set } = useListState(FILTERS)
  const params: AuditFilters = { page: state.page, page_size: PAGE_SIZE }
  if (state.filters.entity_type) params.entity_type = state.filters.entity_type as AuditEntityType
  if (state.filters.entity_id) params.entity_id = state.filters.entity_id
  if (state.filters.actor) params.actor = state.filters.actor
  if (state.filters.from) params.from = new Date(`${state.filters.from}T00:00:00`).toISOString()
  if (state.filters.to) params.to = new Date(`${state.filters.to}T23:59:59`).toISOString()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'audit', currentOrgId, 'list', params], queryFn: () => adminApi.getAudit(params, api), enabled })
  const { data: users } = useQuery({ queryKey: ['admin', 'users', currentOrgId, 'actors'], queryFn: () => adminApi.getUsers({ page_size: 100, role: 'admin' }, api).then(async (admins) => [...admins.users, ...(await adminApi.getUsers({ page_size: 100, role: 'owner' }, api)).users]), enabled })
  const q = state.q.trim().toLowerCase()
  const rows = (data?.actions ?? []).filter((a) => !q || actionLabel(a.action).toLowerCase().includes(q) || (a.reason ?? '').toLowerCase().includes(q) || (a.actor?.email ?? '').toLowerCase().includes(q))

  const columns: Column<AdminAction>[] = [
    { key: 'when', header: 'Quando', render: (a) => <span className="whitespace-nowrap text-muted-foreground">{format(parseISO(a.created_at), 'd MMM yyyy, HH:mm', { locale: pt })}</span> },
    { key: 'actor', header: 'Quem', render: (a) => a.actor ? (a.actor.name || a.actor.email) : 'Sistema' },
    { key: 'action', header: 'O quê', render: (a) => <span className="font-medium text-foreground">{actionLabel(a.action)}</span> },
    { key: 'entity', header: 'Em', render: (a) => <span>{ENTITY_LABELS[a.entity_type] ?? a.entity_type} <code className="text-xs text-muted-foreground">{a.entity_id.replace(/-/g, '').slice(0, 8)}</code></span> },
    { key: 'diff', header: 'Alterações', className: 'min-w-[16rem]', render: (a) => <ul className="m-0 list-none"><HistoryRow action={{ ...a, created_at: a.created_at }} /></ul> },
  ]
  return (
    <div className="p-8">
      <PageHeader title="Histórico" description="Quem fez o quê, em tudo o que a equipa altera. Cada linha abre a diferença." />
      <EntityList<AdminAction>
        caption="Histórico de ações"
        columns={columns}
        rows={isLoading ? undefined : rows}
        rowKey={(a) => a.id}
        total={data?.total}
        page={state.page}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Ação, motivo ou quem (nesta página)' }}
        filters={{
          chips: [
            { key: 'entity_type', label: 'Tipo', options: (Object.keys(ENTITY_LABELS) as AuditEntityType[]).map((k) => ({ value: k, label: ENTITY_LABELS[k] })) },
            { key: 'actor', label: 'Quem', options: (users ?? []).map((u) => ({ value: u.id, label: u.name || u.email })) },
          ],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        toolbarExtra={
          <span className="flex items-center gap-1 text-sm">
            <input type="date" aria-label="De" value={state.filters.from ?? ''} onChange={(e) => set({ filters: { from: e.target.value || undefined } })} className="h-10 rounded-lg border border-border px-2 text-sm bg-white" />
            <span aria-hidden>–</span>
            <input type="date" aria-label="Até" value={state.filters.to ?? ''} onChange={(e) => set({ filters: { to: e.target.value || undefined } })} className="h-10 rounded-lg border border-border px-2 text-sm bg-white" />
            {state.filters.entity_id && <button type="button" className="ml-2 text-xs underline" onClick={() => set({ filters: { entity_id: undefined } })}>Só {state.filters.entity_id.slice(0, 8)} ✕</button>}
          </span>
        }
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Ainda sem ações registadas.' }}
      />
    </div>
  )
}
