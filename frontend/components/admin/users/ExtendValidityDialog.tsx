'use client'
import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatHours } from '@/lib/utils'
import type { AdminPurchase } from '@/types'

interface ExtendValidityDialogProps {
  purchase: AdminPurchase | null
  busy: boolean
  error: string | null
  onSubmit: (body: { expires_at: string; reason: string }) => void
  onClose: () => void
}

/**
 * "Prolongar validade" (A06): a later date and why. Extending only — the
 * backend refuses an earlier date — so the picker starts the day after the
 * current expiry (or tomorrow, for a lapsed pack).
 */
export function ExtendValidityDialog({ purchase, busy, error, onSubmit, onClose }: ExtendValidityDialogProps) {
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const current = purchase ? parseISO(purchase.expires_at) : null
  const floor = current ? new Date(Math.max(current.getTime(), Date.now()) + 24 * 3600 * 1000) : null
  const min = floor ? format(floor, 'yyyy-MM-dd') : undefined

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!date || (min && date < min)) return setProblem(`Escolha uma data a partir de ${min ? format(parseISO(min), 'd MMM yyyy', { locale: pt }) : 'amanhã'}.`)
    if (reason.trim().length < 3) return setProblem('Escreva o motivo — fica anotado na compra.')
    setProblem(null)
    onSubmit({ expires_at: new Date(`${date}T23:59:59`).toISOString(), reason: reason.trim() })
  }

  return (
    <Dialog open={!!purchase} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {purchase && current && (
          <>
            <DialogHeader>
              <DialogTitle>Prolongar validade</DialogTitle>
              <DialogDescription>
                {purchase.package?.name ?? 'Pack'} com {formatHours(purchase.hours_remaining)} por usar, válido até {format(current, "d 'de' MMMM 'de' yyyy", { locale: pt })}
                {current.getTime() < Date.now() ? ' (já caducou)' : ''}.
              </DialogDescription>
            </DialogHeader>
            <form className="space-y-3" onSubmit={submit} noValidate>
              <div>
                <Label htmlFor="extend-date">Nova validade</Label>
                <Input id="extend-date" type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="extend-reason">Motivo</Label>
                <Textarea id="extend-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" placeholder="ex: esteve de baixa em outubro" />
              </div>
              {(problem || error) && <p role="alert" className="text-sm text-red-600">{problem ?? error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
                <Button type="submit" disabled={busy}>{busy ? 'A guardar…' : 'Prolongar'}</Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
