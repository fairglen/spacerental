'use client'
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Download, FileText } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { detailOf } from '@/lib/httpError'
import { saveBlob } from '@/lib/download'
import { isValidRange, PRESET_LABELS, presetRange, type PeriodPreset } from '@/lib/billingPeriods'
import { formatCurrency, formatHours } from '@/lib/utils'
import { useCrud } from '@/components/admin/crud/useCrud'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { ThisMonthCard, periodLabel } from '@/components/admin/ThisMonthCard'
import { KIND_LABELS, RegisterInvoiceDialog } from '@/components/admin/billing/RegisterInvoiceDialog'
import { InvoiceDialog } from '@/components/admin/billing/InvoiceDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { BillingPeriod, Invoice, InvoicedFilter, InvoiceCreateBody, InvoiceUpdateBody, StatementLine } from '@/types'

const INVOICED_LABELS: Record<InvoicedFilter, string> = { pending: 'Por faturar', done: 'Faturadas', all: 'Todas' }
type Tab = 'statement' | 'invoices'

/** Faturação (I06): what was received in a period, per customer, and the invoices registered against it. */
export default function AdminBillingPage() {
  const { currentOrgId } = useCrud('billing')
  return <Billing key={currentOrgId} />
}

function Billing() {
  const { api, enabled, currentOrgId, invalidate } = useCrud('billing')
  const { toast } = useToast()
  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const [custom, setCustom] = useState<BillingPeriod>(() => presetRange('this_month') ?? { from: '', to: '' })
  const [invoiced, setInvoiced] = useState<InvoicedFilter>('all')
  const [tab, setTab] = useState<Tab>('statement')
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [registering, setRegistering] = useState<StatementLine | null>(null)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [deleting, setDeleting] = useState<Invoice | null>(null)

  const period = useMemo(() => presetRange(preset) ?? custom, [preset, custom])
  const rangeOk = isValidRange(period)

  const summary = useQuery({
    queryKey: ['admin', 'billing', currentOrgId, 'summary', period],
    queryFn: () => adminApi.getBillingSummary(period, api),
    enabled: enabled && rangeOk,
  })
  const statement = useQuery({
    queryKey: ['admin', 'billing', currentOrgId, 'statement', period, invoiced],
    queryFn: () => adminApi.getBillingStatement({ ...period, invoiced }, api),
    enabled: enabled && rangeOk,
  })
  const invoices = useQuery({
    queryKey: ['admin', 'billing', currentOrgId, 'invoices'],
    queryFn: () => adminApi.getInvoices({}, api),
    enabled,
  })
  const invoiceNumbers = useMemo(() => new Map((invoices.data ?? []).map((i) => [i.id, i.number])), [invoices.data])

  const done = async (message: string) => { toast({ title: message, variant: 'success' }); await invalidate() }
  const fail = (fallback: string) => (err: unknown) => toast({ title: detailOf(err) ?? fallback, variant: 'error' })

  const create = useMutation({
    mutationFn: (body: InvoiceCreateBody) => adminApi.createInvoice(body, api),
    onSuccess: async (invoice) => { setRegistering(null); await done(`Fatura ${invoice.number} registada.`) },
  })
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: InvoiceUpdateBody }) => adminApi.updateInvoice(id, body, api),
    onSuccess: async () => { setEditing(null); await done('Fatura guardada.') },
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.deleteInvoice(id, api),
    onSuccess: async () => { setDeleting(null); await done('Registo eliminado. As transações voltam a estar por faturar.') },
    onError: fail('Não foi possível eliminar o registo.'),
  })
  const exportCsv = useMutation({
    mutationFn: async () => saveBlob(await adminApi.downloadBillingCsv({ ...period, invoiced }, api), `extrato-${period.from}_${period.to}.csv`),
    onError: fail('Não foi possível exportar o CSV.'),
  })
  const downloadPdf = useMutation({
    mutationFn: async (invoice: Invoice) => saveBlob(await adminApi.downloadInvoicePdf(invoice.id, api), `fatura-${invoice.number.replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`),
    onError: fail('Não foi possível transferir o PDF.'),
  })

  const needle = q.trim().toLowerCase()
  const lines = (statement.data?.lines ?? []).filter((line) =>
    !needle || line.user.email.toLowerCase().includes(needle) || (line.user.name ?? '').toLowerCase().includes(needle) || (line.user.billing_name ?? '').toLowerCase().includes(needle),
  )
  const toggleExpanded = (id: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <div className="p-8 pb-24">
      <PageHeader
        title="Faturação"
        description="O que foi recebido no período, por cliente, e as faturas registadas. As faturas são emitidas no seu software certificado; aqui ficam registadas."
        actions={
          <Button variant="outline" className="gap-2" onClick={() => exportCsv.mutate()} disabled={!rangeOk || exportCsv.isPending}>
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="billing-preset">Período</Label>
          <select id="billing-preset" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)}>
            {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => <option key={p} value={p}>{PRESET_LABELS[p]}</option>)}
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="billing-from">De</Label>
              <Input id="billing-from" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="billing-to">Até</Label>
              <Input id="billing-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label htmlFor="billing-invoiced">Estado da faturação</Label>
          <select id="billing-invoiced" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={invoiced} onChange={(e) => setInvoiced(e.target.value as InvoicedFilter)}>
            {(['all', 'pending', 'done'] as InvoicedFilter[]).map((f) => <option key={f} value={f}>{INVOICED_LABELS[f]}</option>)}
          </select>
        </div>
        {!rangeOk && <p role="alert" className="text-sm text-destructive">Indique duas datas por ordem, no máximo um ano.</p>}
      </div>

      <div className="mb-8">
        {summary.isLoading || !summary.data ? <Skeleton className="h-40 rounded-xl" /> : <ThisMonthCard summary={summary.data} title="Resumo do período" showLink={false} testId="billing-summary" />}
      </div>

      <div role="tablist" aria-label="Secções" className="mb-4 flex gap-2 border-b border-border">
        {(['statement', 'invoices'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            {t === 'statement' ? 'Extrato' : `Faturas registadas${invoices.data ? ` (${invoices.data.length})` : ''}`}
          </button>
        ))}
      </div>

      {tab === 'statement' && (
        <section aria-label="Extrato por cliente" className="rounded-xl border border-border bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
            <div className="space-y-1">
              <Label htmlFor="billing-search" className="sr-only">Pesquisar cliente</Label>
              <Input id="billing-search" placeholder="Pesquisar cliente" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" aria-label="Pesquisar cliente" />
            </div>
            {rangeOk && <p className="text-sm text-muted-foreground">{periodLabel(period.from, period.to)}</p>}
          </div>
          {statement.isLoading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : statement.isError ? (
            <p className="p-6 text-sm text-destructive">Não foi possível carregar o extrato.</p>
          ) : lines.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{needle ? 'Nenhum cliente corresponde à pesquisa.' : 'Sem movimentos neste período.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Extrato por cliente</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium text-right">Transações</th>
                    <th className="px-4 py-3 font-medium text-right">Horas</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                    <th className="px-4 py-3 font-medium text-right">Faturado</th>
                    <th className="px-4 py-3 font-medium text-right">Por faturar</th>
                    <th className="px-4 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((line) => {
                    const open = expanded.has(line.user.id)
                    const pending = line.transactions.filter((t) => t.invoice_id === null).length
                    return [
                      <tr key={line.user.id} data-testid="statement-line">
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">{line.user.billing_name || line.user.name || line.user.email}</span>
                          <span className="block text-xs text-muted-foreground">{line.user.email}{line.user.tax_id ? ` · NIF ${line.user.tax_id}` : ' · sem NIF'}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{line.transactions_count}</td>
                        <td className="px-4 py-3 text-right">{formatHours(Number(line.hours))}</td>
                        <td className="px-4 py-3 text-right font-medium text-foreground">{formatCurrency(Number(line.amount))}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">{formatCurrency(Number(line.invoiced_amount))}</td>
                        <td className="px-4 py-3 text-right">
                          {pending === 0 ? <Badge>Faturada</Badge> : <span className="font-medium text-foreground">{formatCurrency(Number(line.pending_amount))}</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Button variant="ghost" size="sm" onClick={() => toggleExpanded(line.user.id)} aria-expanded={open}>{open ? 'Ocultar' : 'Ver transações'}</Button>
                          <Button size="sm" className="ml-2" onClick={() => setRegistering(line)} disabled={pending === 0}>Registar fatura emitida</Button>
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${line.user.id}-transactions`} className="bg-muted/30">
                          <td colSpan={7} className="px-4 py-3">
                            <table className="w-full text-xs">
                              <caption className="sr-only">Transações de {line.user.email}</caption>
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="py-1 pr-3 font-medium">Data</th>
                                  <th className="py-1 pr-3 font-medium">Tipo</th>
                                  <th className="py-1 pr-3 font-medium">Descrição</th>
                                  <th className="py-1 pr-3 font-medium text-right">Horas</th>
                                  <th className="py-1 pr-3 font-medium text-right">Valor</th>
                                  <th className="py-1 font-medium text-right">Fatura</th>
                                </tr>
                              </thead>
                              <tbody>
                                {line.transactions.map((t) => (
                                  <tr key={`${t.kind}-${t.id}`}>
                                    <td className="py-1 pr-3 whitespace-nowrap">{format(parseISO(t.paid_at), 'd MMM yyyy', { locale: pt })}</td>
                                    <td className="py-1 pr-3">{KIND_LABELS[t.kind]}{t.channel === 'manual' ? ' · fora da plataforma' : ''}</td>
                                    <td className="py-1 pr-3 text-foreground">{t.label}</td>
                                    <td className="py-1 pr-3 text-right">{formatHours(Number(t.hours))}</td>
                                    <td className="py-1 pr-3 text-right">{formatCurrency(Number(t.amount))}</td>
                                    <td className="py-1 text-right">{t.invoice_id ? (invoiceNumbers.get(t.invoice_id) ?? 'Faturada') : <span className="text-muted-foreground">Por faturar</span>}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'invoices' && (
        <section aria-label="Faturas registadas" className="rounded-xl border border-border bg-white">
          {invoices.isLoading ? (
            <div className="p-4"><Skeleton className="h-32 w-full" /></div>
          ) : (invoices.data ?? []).length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Ainda não há faturas registadas. Registe a primeira a partir de uma linha do extrato.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Faturas registadas</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Nº</th>
                    <th className="px-4 py-3 font-medium">Data</th>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Período</th>
                    <th className="px-4 py-3 font-medium text-right">Horas</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                    <th className="px-4 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(invoices.data ?? []).map((invoice) => (
                    <tr key={invoice.id} data-testid="invoice-row">
                      <td className="px-4 py-3 font-medium text-foreground">{invoice.number}{invoice.note && <span className="block text-xs font-normal text-muted-foreground">{invoice.note}</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{format(parseISO(invoice.issued_at), 'd MMM yyyy', { locale: pt })}</td>
                      <td className="px-4 py-3">{invoice.user.billing_name || invoice.user.name || invoice.user.email}<span className="block text-xs text-muted-foreground">{invoice.user.email}</span></td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{periodLabel(invoice.period_from, invoice.period_to)}</td>
                      <td className="px-4 py-3 text-right">{formatHours(Number(invoice.hours))}</td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">{formatCurrency(Number(invoice.amount))}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {invoice.has_pdf && (
                          <Button variant="ghost" size="sm" className="gap-1" onClick={() => downloadPdf.mutate(invoice)} aria-label={`Transferir PDF ${invoice.number}`}>
                            <FileText className="h-4 w-4" /> PDF
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setEditing(invoice)} aria-label={`Editar ${invoice.number}`}>Editar</Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(invoice)} aria-label={`Eliminar ${invoice.number}`}>Eliminar</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {registering && (
        <RegisterInvoiceDialog
          line={registering}
          period={period}
          busy={create.isPending}
          error={create.isError ? (detailOf(create.error) ?? 'Não foi possível registar a fatura.') : null}
          onSubmit={(body) => create.mutate(body)}
          onClose={() => { setRegistering(null); create.reset() }}
        />
      )}
      {editing && (
        <InvoiceDialog
          invoice={editing}
          busy={update.isPending}
          error={update.isError ? (detailOf(update.error) ?? 'Não foi possível guardar a fatura.') : null}
          onSubmit={(body) => update.mutate({ id: editing.id, body })}
          onClose={() => { setEditing(null); update.reset() }}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={(open) => { if (!open) setDeleting(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Eliminar o registo da fatura {deleting.number}?</DialogTitle>
              <DialogDescription>
                O registo e o PDF desaparecem daqui e da conta do cliente; as transações ({formatCurrency(Number(deleting.amount))}) voltam a estar por faturar. A fatura emitida no seu software não é afetada.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={remove.isPending}>Cancelar</Button>
              <Button variant="destructive" onClick={() => remove.mutate(deleting.id)} disabled={remove.isPending}>Eliminar registo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
