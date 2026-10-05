'use client'
import { useEffect, useState } from 'react'
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
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { SUPPORT_CATEGORY_LABELS } from '@/components/help/HelpDialog'
import type { SupportStatus } from '@/types'

const STATUS: Record<SupportStatus, string> = { new: 'Nova', in_progress: 'Em curso', closed: 'Fechada' }

/** One help request (G06): the message and context, links, status, note, reply by email, delete. */
export default function AdminSupportRequestPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('support')
  return <RequestDetail key={`${currentOrgId}-${id}`} requestId={id} />
}

function RequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('support')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'support', currentOrgId, requestId], queryFn: () => adminApi.getSupportRequest(requestId, api), enabled })
  const [note, setNote] = useState('')
  useEffect(() => { if (data) setNote(data.admin_note ?? '') }, [data])
  const done = async (message: string) => { toast({ title: message, variant: 'success' }); await invalidate(requestId) }
  const update = useMutation({
    mutationFn: (body: { status?: SupportStatus; admin_note?: string | null }) => adminApi.updateSupportRequestDetail(requestId, body, api),
    onError: (err) => toast({ title: detailOf(err) ?? 'Não foi possível guardar.', variant: 'error' }),
  })
  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar este pedido. <Link href="/admin/support" className="underline">Voltar à lista</Link>.</p></div>
  const r = data
  const subject = `Re: pedido #${r.reference} — ${SUPPORT_CATEGORY_LABELS[r.category]}`
  const context = r.context as Record<string, string | undefined>
  return (
    <div className="p-8 max-w-4xl space-y-6">
      <PageHeader
        title={`Pedido #${r.reference}`}
        crumbs={[{ label: 'Pedidos de ajuda', href: '/admin/support' }, { label: `#${r.reference}` }]}
        badge={<Badge variant={r.status === 'closed' ? 'secondary' : 'default'}>{STATUS[r.status]}</Badge>}
        description={`${SUPPORT_CATEGORY_LABELS[r.category]} · ${format(parseISO(r.created_at), "d MMM yyyy, HH:mm", { locale: pt })} · ${r.contact_email}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><a href={`mailto:${r.contact_email}?subject=${encodeURIComponent(subject)}`}>Responder por email</a></Button>
            {r.status === 'new' && <Button type="button" size="sm" onClick={() => update.mutate({ status: 'in_progress' }, { onSuccess: () => done('Marcado em curso.') })}>Marcar em curso</Button>}
            {r.status !== 'closed' && <Button type="button" size="sm" variant="outline" onClick={() => update.mutate({ status: 'closed' }, { onSuccess: () => done('Pedido fechado.') })}>Fechar</Button>}
            {r.status !== 'new' && <Button type="button" size="sm" variant="ghost" onClick={() => update.mutate({ status: 'new' }, { onSuccess: () => done('Pedido reaberto.') })}>Reabrir</Button>}
          </>
        }
      />
      <section aria-labelledby="mensagem" className="rounded-xl border border-border bg-white p-5">
        <h2 id="mensagem" className="text-base font-semibold text-foreground">Mensagem</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{r.message}</p>
      </section>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="ligacoes" className="rounded-xl border border-border bg-white p-5">
          <h2 id="ligacoes" className="text-base font-semibold text-foreground">Ligações</h2>
          <dl className="mt-2 text-sm space-y-1">
            <div><dt className="inline text-muted-foreground">Pessoa: </dt><dd className="inline">{r.user ? <Link href={`/admin/users/${r.user.id}`} className="underline underline-offset-2">{r.user.name || r.user.email}</Link> : <span>{r.contact_email} (sem conta)</span>}</dd></div>
            <div><dt className="inline text-muted-foreground">Reserva: </dt><dd className="inline">{r.booking ? <Link href={`/admin/bookings/${r.booking.id}`} className="underline underline-offset-2">{r.booking.room?.name ?? 'Sala'} · {format(parseISO(r.booking.start_time), 'd MMM, HH:mm', { locale: pt })}</Link> : '—'}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="contexto" className="rounded-xl border border-border bg-white p-5">
          <h2 id="contexto" className="text-base font-semibold text-foreground">Contexto</h2>
          <dl className="mt-2 text-sm space-y-1">
            {[['Página', context.page_url], ['Ecrã', context.viewport], ['Browser', context.user_agent], ['Versão', context.app_version], ['Enviado às', context.timestamp]].map(([k, v]) => (
              <div key={k}><dt className="inline text-muted-foreground">{k}: </dt><dd className="inline break-all">{v || '—'}</dd></div>
            ))}
          </dl>
        </section>
      </div>
      <section aria-labelledby="nota" className="rounded-xl border border-border bg-white p-5">
        <h2 id="nota" className="text-base font-semibold text-foreground">Nota interna</h2>
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); update.mutate({ admin_note: note.trim() || null }, { onSuccess: () => done('Nota guardada.') }) }}>
          <Label htmlFor="admin_note" className="sr-only">Nota interna</Label>
          <Textarea id="admin_note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Só a equipa vê." />
          <div className="flex justify-end"><Button type="submit" size="sm" disabled={update.isPending}>Guardar nota</Button></div>
        </form>
      </section>
      <DangerZone
        entityLabel="pedido"
        name={r.reference}
        shortId={r.id.replace(/-/g, '').slice(0, 8)}
        keeps="Eliminar é para spam: o pedido desaparece da caixa; o histórico guarda uma cópia."
        hard={{ label: 'Eliminar o pedido (spam)', onDelete: async (confirm) => { await adminApi.deleteSupportRequest(requestId, confirm, api); toast({ title: 'Pedido eliminado.', variant: 'success' }); await invalidate(); router.push('/admin/support') } }}
      />
      <HistoryPanel entity="support" id={requestId} />
    </div>
  )
}
