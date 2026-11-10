'use client'
import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { accessApi } from '@/lib/api'
import type { Api } from '@/lib/api'
import type { CustomerPin } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { parseApiError } from '@/components/admin/crud/apiErrors'

/**
 * L01: the customer's one door PIN. Masked until they tap it, with the Keypad
 * hint and a two-step "Pedir um código novo". A customer whose spaces have no
 * lock (or who has no code yet) sees nothing — the card simply does not render.
 * Formal register, Portuguese.
 */
function label(access: CustomerPin): { text: string; variant: 'default' | 'secondary' } {
  if (access.status === 'active') {
    const settling = access.devices.length === 0 || access.devices.some((d) => d.sync_status !== 'synced')
    return settling ? { text: 'A ativar', variant: 'secondary' } : { text: 'Ativo', variant: 'default' }
  }
  return { text: 'Inativo', variant: 'secondary' }
}

export function AccessCard({ api }: { api: Api }) {
  const query = useQuery({ queryKey: ['access', 'me'], queryFn: () => accessApi.getMine(api) })
  const [revealed, setRevealed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rotate = useMutation({
    mutationFn: () => accessApi.rotate(api),
    onSuccess: () => { setConfirming(false); setRevealed(true); setError(null); void query.refetch() },
    onError: (err) => setError(parseApiError(err, 'Não foi possível gerar um novo código.').message ?? 'Não foi possível gerar um novo código.'),
  })

  if (query.isLoading) return <Skeleton className="mb-8 h-24 rounded-xl" />
  // No access, or none of the customer's spaces has a lock: show nothing.
  if (query.isError || !query.data || query.data.status === 'none') return null

  const access = query.data
  const state = label(access)
  const settling = state.text === 'A ativar'

  return (
    <section
      aria-labelledby="access-card-title"
      data-testid="access-card"
      className="mb-8 rounded-xl border border-border bg-white p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="access-card-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-primary" /> O seu código de acesso
        </h2>
        <Badge variant={state.variant} data-testid="access-status">{state.text}</Badge>
      </div>

      {access.pin ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? 'Ocultar o código' : 'Mostrar o código'}
            data-testid="access-pin"
            className="font-mono text-2xl font-semibold tracking-[0.3em] text-foreground"
          >
            {revealed ? access.pin : '• • • • • •'}
          </button>
          <p className="mt-1 text-sm text-muted-foreground">
            {settling
              ? 'O seu código fica ativo em instantes.'
              : 'Na porta, introduza o código no teclado e confirme com ✓.'}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">O seu código fica disponível em instantes.</p>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              O código atual deixa de funcionar. Quer continuar?
            </p>
            <Button size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending} data-testid="access-rotate-confirm">
              {rotate.isPending ? 'A gerar…' : 'Confirmar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={rotate.isPending}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirming(true) }} data-testid="access-rotate">
            Pedir um código novo
          </Button>
        )}
      </div>
    </section>
  )
}
