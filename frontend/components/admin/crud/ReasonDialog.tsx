'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { blockerLines, parseApiError } from './apiErrors'

/**
 * One dialog for every action that needs a reason (G05): the price override,
 * a purchase adjustment, a cancellation, anonymisation. The reason must have
 * at least five characters; the API's refusal is shown inline.
 */
export type ReasonDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  /** Extra fields rendered above the reason (an amount, a number of hours). */
  children?: React.ReactNode
  /** Disable the confirm until the extra fields are valid. */
  canConfirm?: boolean
  onConfirm: (reason: string) => Promise<unknown>
  onClose: () => void
}

export const MIN_REASON = 5

export function ReasonDialog({ open, title, description, confirmLabel = 'Confirmar', destructive, children, canConfirm = true, onConfirm, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message?: string; blockers: string[] } | null>(null)
  useEffect(() => { if (open) { setReason(''); setError(null) } }, [open])
  const ok = reason.trim().length >= MIN_REASON && canConfirm

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      onClose()
    } catch (err) {
      const parsed = parseApiError(err, 'Não foi possível concluir. Tente novamente.')
      setError({ message: parsed.message, blockers: blockerLines(parsed.blockers) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {children}
          <div>
            <Label htmlFor="reason">Motivo</Label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" rows={3} placeholder="Fica registado no histórico." />
            <p className="text-xs text-muted-foreground mt-1">Pelo menos {MIN_REASON} caracteres.</p>
          </div>
          {error && (
            <div role="alert" className="text-sm text-red-600">
              <p>{error.message}</p>
              {error.blockers.length > 0 && <ul className="mt-1 list-disc pl-5">{error.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={confirm} disabled={!ok || busy}>
            {busy ? 'A guardar…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
