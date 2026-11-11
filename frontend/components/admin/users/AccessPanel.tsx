'use client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import type { Api } from '@/lib/api'
import type { AdminAccess } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { detailOf } from '@/lib/httpError'

/**
 * L01: the operator's view of a customer's door PIN — its status and per-lock
 * sync — and the actions (rotate, revoke, re-activate). The operator never
 * sees the clear PIN; the customer sees it on their own dashboard.
 */
const STATUS: Record<string, { text: string; variant: 'default' | 'secondary' }> = {
  active: { text: 'Ativo', variant: 'default' },
  dormant: { text: 'Inativo (sem reservas recentes)', variant: 'secondary' },
  revoked: { text: 'Revogado', variant: 'secondary' },
}
const SYNC: Record<string, string> = {
  synced: 'no fecho',
  pending: 'a ativar',
  failed: 'falhou',
  revoke_pending: 'a remover',
}

export function AccessPanel({ userId, api, enabled }: { userId: string; api: Api; enabled: boolean }) {
  const query = useQuery({ queryKey: ['admin', 'access', userId], queryFn: () => adminApi.getAccess(userId, api), enabled })
  const { toast } = useToast()
  const after = (message: string) => ({
    onSuccess: async () => { toast({ title: message, variant: 'success' }); await query.refetch() },
    onError: (err: unknown) => toast({ title: detailOf(err) ?? 'A operação falhou.', variant: 'error' }),
  })
  const rotate = useMutation({ mutationFn: () => adminApi.rotateAccess(userId, api), ...after('Novo código gerado. O cliente vê-o no painel.') })
  const revoke = useMutation({ mutationFn: () => adminApi.revokeAccess(userId, api), ...after('Acesso revogado.') })
  const reactivate = useMutation({ mutationFn: () => adminApi.reactivateAccess(userId, api), ...after('Acesso reativado.') })
  const busy = rotate.isPending || revoke.isPending || reactivate.isPending

  return (
    <section aria-labelledby="acesso-fechadura" data-testid="admin-access-panel" className="rounded-xl border border-border bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="acesso-fechadura" className="text-base font-semibold text-foreground">Código de acesso</h2>
        {status(query.data) && <Badge variant={status(query.data)!.variant} data-testid="admin-access-status">{status(query.data)!.text}</Badge>}
      </div>
      {query.isLoading && <Skeleton className="mt-3 h-12 rounded-lg" />}
      {query.isError && <p role="alert" className="mt-3 text-sm text-red-600">Não foi possível obter o estado do código.</p>}
      {query.data && (
        <div className="mt-3 space-y-3 text-sm">
          {query.data.status === null ? (
            <p className="text-muted-foreground">Este cliente ainda não tem um código (nenhuma reserva confirmada numa sala com fechadura).</p>
          ) : (
            <>
              <ul className="text-muted-foreground">
                {query.data.devices.length === 0 && <li>Sem fechaduras associadas.</li>}
                {query.data.devices.map((d) => (
                  <li key={d.device_id}>
                    Fechadura <code className="rounded bg-[#F8FAF9] px-1">{d.device_id}</code> — {SYNC[d.sync_status] ?? d.sync_status}
                    {d.last_error && <span className="text-red-600"> ({d.last_error})</span>}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                {query.data.status !== 'revoked' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => rotate.mutate()} data-testid="admin-access-rotate">Gerar novo código</Button>
                )}
                {query.data.status !== 'revoked' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => revoke.mutate()} data-testid="admin-access-revoke">Revogar</Button>
                )}
                {query.data.status !== 'active' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => reactivate.mutate()} data-testid="admin-access-reactivate">Reativar</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function status(access: AdminAccess | undefined): { text: string; variant: 'default' | 'secondary' } | null {
  if (!access || access.status === null) return null
  return STATUS[access.status] ?? null
}
