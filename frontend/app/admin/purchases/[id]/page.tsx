'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { detailOf } from '@/lib/httpError'
import { useCrud } from '@/components/admin/crud/useCrud'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryPanel } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { ReasonDialog } from '@/components/admin/crud/ReasonDialog'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { ExtendValidityDialog } from '@/components/admin/users/ExtendValidityDialog'
import { formatCurrency, formatHours, STATUS_LABELS } from '@/lib/utils'
import { PURCHASE_SOURCE_LABELS, purchaseLabel } from '@/lib/cancellationCredit'
import type { Booking } from '@/types'

const PURCHASE_STATUS: Record<'pending' | 'active' | 'cancelled', string> = { pending: 'Por pagar', active: 'Ativo', cancelled: 'Cancelado' }

/** One purchase (G06): the customer, the debits → bookings, adjust/extend/cancel/delete, Histórico. */
export default function AdminPurchasePage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('purchases')
  return <PurchaseDetail key={`${currentOrgId}-${id}`} purchaseId={id} />
}

function PurchaseDetail({ purchaseId }: { purchaseId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('purchases')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'purchases', currentOrgId, purchaseId], queryFn: () => adminApi.getPurchase(purchaseId, api), enabled })
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [hours, setHours] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [extending, setExtending] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const done = async (message: string) => { toast({ title: message, variant: 'success' }); await invalidate(purchaseId) }
  const extend = useMutation({
    mutationFn: (body: { expires_at: string; reason: string }) => adminApi.extendPurchase(purchaseId, body, api),
    onSuccess: async () => { setExtending(false); await done('Validade prolongada.') },
  })
  const saveNote = useMutation({
    mutationFn: () => adminApi.updatePurchase(purchaseId, { admin_note: (note ?? '').trim() || null }, api),
    onSuccess: () => done('Nota guardada.'),
    onError: (err) => toast({ title: detailOf(err) ?? 'Não foi possível guardar a nota.', variant: 'error' }),
  })
  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar esta compra. <Link href="/admin/purchases" className="underline">Voltar à lista</Link>.</p></div>
  const { purchase: p, user, debits } = data
  const short = p.id.replace(/-/g, '').slice(0, 8)
  const lapsed = p.status === 'active' && parseISO(p.expires_at).getTime() < Date.now()
  return (
    <div className="p-8 max-w-4xl space-y-6">
      <PageHeader
        title={`${purchaseLabel(p)} · ${user.name || user.email}`}
        crumbs={[{ label: 'Banco de horas', href: '/admin/purchases' }, { label: `#${short.toUpperCase()}` }]}
        badge={<Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{PURCHASE_STATUS[p.status]}</Badge>}
        description={`${formatHours(p.hours_remaining)} de ${formatHours(p.hours_total)} por gastar · ${p.amount_paid === 0 ? 'oferta' : formatCurrency(p.amount_paid)} · válido até ${format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}${lapsed ? ' (caducou)' : ''}`}
        actions={p.status === 'active' && (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => { setHours(''); setAdjustOpen(true) }}>Ajustar horas</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setExtending(true)}>Prolongar validade</Button>
          </>
        )}
      />
      <section aria-labelledby="cliente" className="rounded-xl border border-border bg-white p-5">
        <h2 id="cliente" className="text-base font-semibold text-foreground">Cliente</h2>
        <p className="text-sm mt-2">{user.name || '—'} · <Link href={`/admin/users/${user.id}`} className="text-primary underline underline-offset-2">{user.email}</Link></p>
        <p className="text-sm mt-1" data-testid="purchase-source">
          <span className="text-muted-foreground">Origem: </span>{PURCHASE_SOURCE_LABELS[p.source]}
          {p.source === 'cancellation_credit' && p.source_booking_id && (
            <> · <Link href={`/admin/bookings/${p.source_booking_id}`} className="underline underline-offset-2">reserva cancelada</Link></>
          )}
        </p>
      </section>
      <section aria-labelledby="descontos" className="rounded-xl border border-border bg-white p-5">
        <h2 id="descontos" className="text-base font-semibold text-foreground">Horas descontadas por reservas</h2>
        {debits.length === 0 ? <p className="text-sm text-muted-foreground mt-2">Nenhuma reserva está a usar horas deste pack.</p> : (
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Reservas que descontam deste pack</caption>
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{['Reserva', 'Sala', 'Horas', 'Estado'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {debits.map((d) => (
                <tr key={d.booking_id}>
                  <td className="px-2 py-2 whitespace-nowrap"><Link href={`/admin/bookings/${d.booking_id}`} className="underline underline-offset-2">{format(parseISO(d.start_time), 'd MMM yyyy, HH:mm', { locale: pt })}–{format(parseISO(d.end_time), 'HH:mm')}</Link></td>
                  <td className="px-2 py-2">{d.room_name ?? '—'}</td>
                  <td className="px-2 py-2">{formatHours(d.hours)}</td>
                  <td className="px-2 py-2"><Badge variant="secondary">{STATUS_LABELS[d.status as Booking['status']] ?? d.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-labelledby="nota" className="rounded-xl border border-border bg-white p-5">
        <h2 id="nota" className="text-base font-semibold text-foreground">Nota interna</h2>
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); saveNote.mutate() }}>
          <Label htmlFor="admin_note" className="sr-only">Nota interna</Label>
          <Textarea id="admin_note" rows={3} value={note ?? p.admin_note ?? ''} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={saveNote.isPending || note === null}>Guardar nota</Button></div>
        </form>
      </section>
      <DangerZone
        entityLabel="compra"
        name={short}
        shortId={short}
        keeps="Cancelar põe as horas restantes a 0 sem devolver dinheiro; as reservas já pagas com este pack ficam. Eliminar só é possível para uma oferta que nenhuma reserva usou."
        soft={p.status !== 'pending' ? {
          active: p.status === 'active',
          onToggle: async () => { if (p.status === 'active') setCancelOpen(true); else setReactivateOpen(true) },
          activeLabel: 'Cancelar o pack', inactiveLabel: 'Reativar o pack', buttonLabel: p.status === 'active' ? 'Cancelar pack' : 'Reativar',
          hint: p.status === 'active' ? 'Pede um motivo.' : 'Devolve as horas não gastas.',
        } : undefined}
        hard={{
          onDelete: async (confirm) => { await adminApi.deletePurchase(purchaseId, confirm, api); toast({ title: 'Compra eliminada.', variant: 'success' }); await invalidate(); router.push('/admin/purchases') },
          disabledReason: p.amount_paid !== 0 || debits.length > 0 ? 'Esta compra foi paga ou já foi usada por reservas: cancele-a em vez de a eliminar.' : undefined,
        }}
        onDone={() => undefined}
      />
      <HistoryPanel entity="purchases" id={purchaseId} />

      <ReasonDialog open={adjustOpen} title="Ajustar horas" description="Positivo acrescenta, negativo retira. O saldo nunca fica abaixo das horas já descontadas por reservas." confirmLabel="Ajustar"
        canConfirm={hours.trim() !== '' && Number(hours) !== 0 && Number.isFinite(Number(hours))}
        onConfirm={async (reason) => { await adminApi.adjustPurchase(purchaseId, { hours: Number(hours), reason }, api); await done('Horas ajustadas.') }}
        onClose={() => setAdjustOpen(false)}>
        <div><Label htmlFor="hours">Horas (±)</Label><Input id="hours" type="number" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1" /></div>
      </ReasonDialog>
      <ReasonDialog open={cancelOpen} title="Cancelar o pack" description="As horas restantes passam a 0; nada é devolvido em dinheiro." confirmLabel="Cancelar pack" destructive
        onConfirm={async (reason) => { await adminApi.updatePurchase(purchaseId, { status: 'cancelled', reason }, api); await done('Pack cancelado.') }}
        onClose={() => setCancelOpen(false)} />
      <ReasonDialog open={reactivateOpen} title="Reativar o pack" description="As horas não gastas voltam a estar disponíveis." confirmLabel="Reativar"
        onConfirm={async (reason) => { await adminApi.updatePurchase(purchaseId, { status: 'active', reason }, api); await done('Pack reativado.') }}
        onClose={() => setReactivateOpen(false)} />
      <ExtendValidityDialog purchase={extending ? p : null} busy={extend.isPending} error={extend.isError ? (detailOf(extend.error) ?? 'Não foi possível prolongar.') : null} onSubmit={(body) => extend.mutate(body)} onClose={() => { setExtending(false); extend.reset() }} />
    </div>
  )
}
