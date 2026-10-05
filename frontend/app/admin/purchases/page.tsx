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
import { formatCurrency, formatHours } from '@/lib/utils'
import { PURCHASE_SOURCE_LABELS, purchaseLabel } from '@/lib/cancellationCredit'
import type { AdminPurchaseRow, PurchaseFilters } from '@/types'

const FILTERS = ['user_id', 'package_id', 'status', 'expiring'] as const
const PAGE_SIZE = 20
const PURCHASE_STATUS: Record<'pending' | 'active' | 'cancelled', string> = { pending: 'Por pagar', active: 'Ativo', cancelled: 'Cancelado' }

/** Banco de horas (G06): every purchase, with its customer. */
export default function AdminPurchasesPage() {
  // Not keyed by organisation on purpose: `useListState` resets the page when
  // the organisation changes, and every query key carries the org already.
  return <PurchasesList />
}

function PurchasesList() {
  const { api, enabled, currentOrgId } = useCrud('purchases')
  const { state, set } = useListState(FILTERS)
  const params: PurchaseFilters = { page: state.page, page_size: PAGE_SIZE }
  if (state.filters.user_id) params.user_id = state.filters.user_id
  if (state.filters.package_id) params.package_id = state.filters.package_id
  if (state.filters.status) params.status = state.filters.status as PurchaseFilters['status']
  if (state.filters.expiring === '30') params.expiring_before = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['admin', 'purchases', currentOrgId, 'list', params], queryFn: () => adminApi.getPurchases(params, api), enabled })
  const { data: packages = [] } = useQuery({ queryKey: ['admin', 'packages', currentOrgId], queryFn: () => adminApi.getPackages(api), enabled })
  // The customer filter is a name/email search resolved client-side from the loaded page.
  const q = state.q.trim().toLowerCase()
  const rows = (data?.purchases ?? []).filter((p) => !q || p.user.email.toLowerCase().includes(q) || (p.user.name ?? '').toLowerCase().includes(q))

  const columns: Column<AdminPurchaseRow>[] = [
    { key: 'customer', header: 'Cliente', render: (p) => <span className="font-medium text-foreground">{p.user.name || p.user.email}<span className="block text-xs text-muted-foreground">{p.user.email}</span></span> },
    { key: 'package', header: 'Pack', render: (p) => <span>{purchaseLabel(p)}<span className="block text-xs text-muted-foreground">{PURCHASE_SOURCE_LABELS[p.source]}</span></span> },
    { key: 'hours', header: 'Horas', render: (p) => `${formatHours(p.hours_remaining)} de ${formatHours(p.hours_total)}` },
    { key: 'paid', header: 'Pago', render: (p) => (p.amount_paid === 0 ? <Badge variant="secondary">Oferta</Badge> : formatCurrency(p.amount_paid)) },
    { key: 'status', header: 'Estado', render: (p) => <Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{PURCHASE_STATUS[p.status]}</Badge> },
    { key: 'expires', header: 'Validade', render: (p) => <span className="whitespace-nowrap text-muted-foreground">{format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}</span> },
  ]
  return (
    <div className="p-8">
      <PageHeader title="Banco de horas" description="As compras e ofertas de horas de todos os clientes." />
      <EntityList<AdminPurchaseRow>
        caption="Compras de packs"
        columns={columns}
        rows={isLoading ? undefined : rows}
        rowKey={(p) => p.id}
        rowHref={(p) => `/admin/purchases/${p.id}`}
        total={data?.total}
        page={state.page}
        pageSize={PAGE_SIZE}
        onPageChange={(page) => set({ page })}
        search={{ value: state.q, onChange: (q) => set({ q }), placeholder: 'Cliente (nesta página)' }}
        filters={{
          chips: [
            { key: 'package_id', label: 'Pack', options: packages.map((p) => ({ value: p.id, label: p.name })) },
            { key: 'status', label: 'Estado', options: [{ value: 'active', label: 'Ativos' }, { value: 'pending', label: 'Por pagar' }, { value: 'cancelled', label: 'Cancelados' }] },
            { key: 'expiring', label: 'Validade', options: [{ value: '30', label: 'Expiram em 30 dias' }] },
          ],
          values: state.filters,
          onChange: (key, value) => set({ filters: { [key]: value } }),
        }}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        empty={{ title: 'Sem compras para estes filtros.' }}
      />
    </div>
  )
}
