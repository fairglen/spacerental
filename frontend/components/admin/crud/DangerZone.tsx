'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { blockerLines, parseApiError } from './apiErrors'

/**
 * The bottom of every entity page (G05): deactivate/reactivate (soft) and
 * the hard delete behind type-to-confirm — the name or the short id, which
 * is exactly what the API's `confirm=` accepts (G02). When the backend
 * refuses (409) the blockers are listed and the button stays disabled until
 * the operator changes something.
 */
export type DangerZoneProps = {
  entityLabel: string
  name: string
  shortId: string
  keeps: string
  soft?: { active: boolean; onToggle: () => Promise<unknown>; activeLabel?: string; inactiveLabel?: string; hint?: string; buttonLabel?: string }
  hard?: { onDelete: (confirm: string) => Promise<unknown>; label?: string; hint?: string; disabledReason?: string }
  onDone?: () => void
}

export function DangerZone({ entityLabel, name, shortId, keeps, soft, hard, onDone }: DangerZoneProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState<'soft' | 'hard' | null>(null)
  const [error, setError] = useState<{ message?: string; blockers: string[] } | null>(null)
  const matches = typed.trim() === name.trim() || typed.trim() === shortId

  async function run(kind: 'soft' | 'hard', fn: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      setTyped('')
      onDone?.()
    } catch (err) {
      const parsed = parseApiError(err, 'Não foi possível concluir a ação.')
      setError({ message: parsed.message, blockers: blockerLines(parsed.blockers) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="danger-zone" className="rounded-xl border border-red-200 bg-white p-5">
      <h2 id="danger-zone" className="text-base font-semibold text-red-700">Zona de perigo</h2>
      <p className="text-sm text-muted-foreground mt-1">{keeps}</p>
      {soft && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{soft.active ? (soft.activeLabel ?? `Desativar ${entityLabel}`) : (soft.inactiveLabel ?? `Reativar ${entityLabel}`)}</p>
            <p className="text-xs text-muted-foreground">{soft.hint ?? (soft.active ? 'Deixa de estar disponível; nada é apagado.' : 'Volta a estar disponível.')}</p>
          </div>
          <Button type="button" variant={soft.active ? 'destructive' : 'outline'} disabled={busy !== null} onClick={() => run('soft', soft.onToggle)}>
            {busy === 'soft' ? 'A guardar…' : soft.buttonLabel ?? (soft.active ? 'Desativar' : 'Reativar')}
          </Button>
        </div>
      )}
      {hard && (
        <div className="mt-4 rounded-lg border border-red-200 p-3">
          <p className="text-sm font-medium text-foreground">{hard.label ?? `Eliminar ${entityLabel} definitivamente`}</p>
          <p className="text-xs text-muted-foreground mt-1">{hard.hint ?? 'Não pode ser anulado.'}</p>
          {hard.disabledReason ? (
            <p className="mt-2 text-sm text-muted-foreground" data-testid="danger-disabled">{hard.disabledReason}</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-56">
                <Label htmlFor="danger-confirm">Escreva <strong>{name}</strong> (ou <code>{shortId}</code>) para confirmar</Label>
                <Input id="danger-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1" autoComplete="off" />
              </div>
              <Button type="button" variant="destructive" disabled={!matches || busy !== null} onClick={() => run('hard', () => hard.onDelete(typed.trim()))}>
                {busy === 'hard' ? 'A eliminar…' : 'Eliminar'}
              </Button>
            </div>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error.message}</p>
          {error.blockers.length > 0 && <ul className="mt-1 list-disc pl-5">{error.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        </div>
      )}
    </section>
  )
}
