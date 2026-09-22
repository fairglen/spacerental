'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { SUPPORT_CATEGORY_LABELS } from '@/components/help/HelpDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import type { SupportRequestRow } from '@/types'

const PAGE_SIZE = 20
const STATUS_LABELS = { new: 'Nova', closed: 'Fechada' } as const

/**
 * The minimal inbox for help requests (C19): the first slice of D06. Read,
 * open, mark closed or reopen. Answering happens by email (Reply-To is the
 * customer); nothing here sends anything.
 */
export default function AdminSupportPage() {
  const { currentOrgId } = useOrg()
  return <OrgInbox key={currentOrgId} currentOrgId={currentOrgId} />
}

function OrgInbox({ currentOrgId }: { currentOrgId: string | null }) {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<'' | 'new' | 'closed'>('')
  const [openRow, setOpenRow] = useState<SupportRequestRow | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'support', currentOrgId, status, page],
    queryFn: () => adminApi.getSupportRequests({ page, page_size: PAGE_SIZE, ...(status ? { status } : {}) }, api),
    enabled: !!session?.accessToken && !!currentOrgId,
  })
  const update = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'new' | 'closed' }) => adminApi.updateSupportRequest(id, next, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'support'] }),
  })

  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pedidos de ajuda</h1>
          <p className="text-muted-foreground text-sm">
            O que os clientes enviaram pelo formulário &quot;Ajuda&quot;. Responda por email; aqui só marca o que está tratado.
          </p>
        </div>
        <div>
          <Label htmlFor="support-status">Estado</Label>
          <select
            id="support-status"
            value={status}
            onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1) }}
            className="mt-1 flex h-9 rounded-lg border border-border bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todos</option>
            <option value="new">Novos</option>
            <option value="closed">Fechados</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : isError ? (
        <p role="alert" className="text-sm text-red-600">Não foi possível carregar os pedidos. Tente novamente.</p>
      ) : (data?.requests.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">Sem pedidos{status ? ' neste estado' : ''}.</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background border-b border-border">
                  <tr>
                    {['Data', 'Assunto', 'Email', 'Mensagem', 'Reserva', 'Estado', 'Ações'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data!.requests.map((r) => (
                    <tr key={r.id} className={r.status === 'closed' ? 'opacity-60' : undefined}>
                      <td className="px-4 py-3 whitespace-nowrap text-foreground">
                        {format(parseISO(r.created_at), 'd MMM, HH:mm', { locale: pt })}
                        <span className="block text-xs text-muted-foreground">#{r.reference}</span>
                      </td>
                      <td className="px-4 py-3 text-foreground">{SUPPORT_CATEGORY_LABELS[r.category]}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <a href={`mailto:${r.contact_email}`} className="hover:underline">{r.contact_email}</a>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <span className="line-clamp-2 text-foreground">{r.message}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {r.booking
                          ? `${r.booking.room?.name ?? 'Sala'} · ${format(parseISO(r.booking.start_time), 'd MMM, HH:mm', { locale: pt })}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={r.status === 'new' ? 'default' : 'secondary'}>{STATUS_LABELS[r.status]}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setOpenRow(r)} aria-label={`Ver pedido #${r.reference}`}>Ver pedido</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: r.id, next: r.status === 'new' ? 'closed' : 'new' })}
                            aria-label={r.status === 'new' ? `Marcar como fechada #${r.reference}` : `Reabrir #${r.reference}`}
                          >
                            {r.status === 'new' ? 'Marcar como fechada' : 'Reabrir'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                <span className="text-muted-foreground">Página {page} de {totalPages}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Seguinte</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {update.isError && <p role="alert" className="mt-3 text-sm text-red-600">Não foi possível alterar o estado. Tente novamente.</p>}

      <Dialog open={!!openRow} onOpenChange={(open) => !open && setOpenRow(null)}>
        <DialogContent>
          {openRow && (
            <>
              <DialogHeader>
                <DialogTitle>Pedido #{openRow.reference} — {SUPPORT_CATEGORY_LABELS[openRow.category]}</DialogTitle>
                <DialogDescription>
                  {openRow.contact_email} · {format(parseISO(openRow.created_at), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: pt })}
                </DialogDescription>
              </DialogHeader>
              {/* Text, never HTML: this is whatever the customer typed. */}
              <p className="whitespace-pre-wrap rounded-lg bg-accent p-4 text-sm text-foreground">{openRow.message}</p>
              {openRow.booking && (
                <p className="text-sm text-muted-foreground">
                  Reserva: {openRow.booking.room?.name ?? 'Sala'}, {format(parseISO(openRow.booking.start_time), "d 'de' MMMM, HH:mm", { locale: pt })}
                  {' '}({openRow.booking.status})
                </p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(['page_url', 'viewport', 'user_agent', 'app_version', 'timestamp'] as const).map((key) => (
                  openRow.context[key] ? (
                    <div key={key} className="contents">
                      <dt className="font-medium">{{ page_url: 'Página', viewport: 'Ecrã', user_agent: 'Browser', app_version: 'Versão', timestamp: 'Enviado' }[key]}</dt>
                      <dd className="break-all">{openRow.context[key]}</dd>
                    </div>
                  ) : null
                ))}
              </dl>
              <Button asChild variant="outline" className="self-start">
                <a href={`mailto:${openRow.contact_email}?subject=${encodeURIComponent(`Re: [Ajuda] ${SUPPORT_CATEGORY_LABELS[openRow.category]} — #${openRow.reference}`)}`}>
                  Responder por email
                </a>
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
