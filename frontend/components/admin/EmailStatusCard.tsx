'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import type { Api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { parseApiError } from '@/components/admin/crud/apiErrors'

/**
 * B61: which email gateway the API runs, a self-addressed test send, and the
 * last delivery failures. In stub mode nothing leaves this machine — the two
 * places to read the messages are named, so "the reset email never arrives"
 * is answered on the page that configures the space.
 */
export function EmailStatusCard({ api, enabled, orgId }: { api: Api; enabled: boolean; orgId: string | null }) {
  const status = useQuery({ queryKey: ['admin', 'email', 'status', orgId], queryFn: () => adminApi.getEmailStatus(api), enabled })
  const [result, setResult] = useState<{ kind: 'ok'; to: string } | { kind: 'error'; message: string } | null>(null)
  const send = useMutation({
    mutationFn: () => adminApi.sendTestEmail(api),
    onSuccess: (data) => { setResult({ kind: 'ok', to: data.to }); void status.refetch() },
    onError: (error) => {
      const fallback = 'Não foi possível enviar o email de teste.'
      setResult({ kind: 'error', message: parseApiError(error, fallback).message ?? fallback })
      void status.refetch()
    },
  })

  return (
    <section aria-labelledby="email-card-title" className="mt-10 rounded-xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="email-card-title" className="text-lg font-semibold text-foreground">Email</h2>
        {status.data && (
          <Badge variant={status.data.mode === 'live' ? 'default' : 'secondary'} data-testid="email-mode">
            {status.data.mode === 'live' ? 'Envio real' : 'Modo de teste'}
          </Badge>
        )}
      </div>
      {status.isLoading && <Skeleton className="mt-4 h-20 rounded-lg" />}
      {status.isError && <p role="alert" className="mt-4 text-sm text-red-600">Não foi possível obter o estado do email.</p>}
      {status.data && (
        <div className="mt-4 space-y-4 text-sm">
          {status.data.mode === 'stub' ? (
            <div>
              <p className="font-medium text-foreground">Modo de teste: os emails não saem desta máquina.</p>
              <p className="mt-1 text-muted-foreground">
                Cada mensagem fica registada no servidor. Pode lê-la em dois sítios:
              </p>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                <li><code className="rounded bg-[#F8FAF9] px-1">docker compose logs backend</code> (linhas &quot;STUB EMAIL&quot;)</li>
                <li>
                  {status.data.test_hooks_enabled
                    ? <><code className="rounded bg-[#F8FAF9] px-1">GET /__test__/emails</code> na API (as últimas 20, com as ligações)</>
                    : <>a rota <code className="rounded bg-[#F8FAF9] px-1">/__test__/emails</code>, quando os ganchos de teste estão ativos</>}
                </li>
              </ul>
              <p className="mt-2 text-muted-foreground">Para enviar emails a sério, siga &quot;Pôr os emails a funcionar (Resend)&quot; no README.</p>
            </div>
          ) : (
            <div>
              <p className="font-medium text-foreground">Envio real através do fornecedor de email.</p>
              <p className="mt-1 text-muted-foreground">Remetente: <span className="text-foreground">{status.data.from_address}</span></p>
            </div>
          )}
          <p className="text-muted-foreground">Pedidos de ajuda entregues em <span className="text-foreground">{status.data.support_inbox}</span>.</p>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending ? 'A enviar…' : 'Enviar email de teste'}
            </Button>
            <span className="text-muted-foreground">Envia uma mensagem curta para o seu próprio endereço.</span>
          </div>
          {result?.kind === 'ok' && (
            <p role="status" className="text-sm text-primary">
              Email de teste enviado para {result.to}.
              {status.data.mode === 'stub' && ' Em modo de teste, procure-o nos dois sítios acima.'}
            </p>
          )}
          {result?.kind === 'error' && <p role="alert" className="text-sm text-red-600">{result.message}</p>}

          <div>
            <h3 className="font-medium text-foreground">Últimas falhas</h3>
            {status.data.recent_failures.length === 0 ? (
              <p className="mt-1 text-muted-foreground">Sem falhas de envio registadas desde o arranque.</p>
            ) : (
              <ul className="mt-1 divide-y divide-border" data-testid="email-failures">
                {status.data.recent_failures.map((f) => (
                  <li key={`${f.at}-${f.to}`} className="py-2">
                    <p className="text-foreground">{new Date(f.at).toLocaleString('pt-PT')} · {f.to} · {f.subject}</p>
                    <p className="text-muted-foreground">{f.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
