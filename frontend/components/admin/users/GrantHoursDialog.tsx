'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ComplimentaryHoursBody, Package } from '@/types'

interface GrantHoursDialogProps {
  open: boolean
  userLabel: string
  packages: Package[]
  busy: boolean
  error: string | null
  onSubmit: (body: ComplimentaryHoursBody) => void
  onClose: () => void
}

/**
 * "Atribuir horas" (A05): N hours at 0,00 € with a reason. The hours land as
 * a purchase of the chosen pack, so they expire with that pack's validity
 * unless a date is given, and show up in the reports at zero.
 */
export function GrantHoursDialog({ open, userLabel, packages, busy, error, onSubmit, onClose }: GrantHoursDialogProps) {
  const [hours, setHours] = useState('1')
  const [packageId, setPackageId] = useState(packages[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const chosen = packages.find((p) => p.id === (packageId || packages[0]?.id))

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(hours)
    if (!Number.isFinite(n) || n <= 0 || n > 999) return setProblem('Indica um número de horas entre 0,5 e 999.')
    if (!chosen) return setProblem('Escolhe o pack que serve de base.')
    if (reason.trim().length < 3) return setProblem('Escreve o motivo — fica registado na compra.')
    setProblem(null)
    onSubmit({
      hours: n,
      package_id: chosen.id,
      reason: reason.trim(),
      ...(expiresAt ? { expires_at: new Date(`${expiresAt}T23:59:59`).toISOString() } : {}),
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Atribuir horas</DialogTitle>
          <DialogDescription>
            Horas oferecidas a {userLabel}, a 0,00 €. Ficam como uma compra de pack com o motivo anotado, para as contas continuarem a bater certo.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit} noValidate>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="grant-hours">Horas</Label>
              <Input id="grant-hours" type="number" min={0.5} max={999} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="grant-package">Pack de base</Label>
              <select id="grant-package" value={chosen?.id ?? ''} onChange={(e) => setPackageId(e.target.value)} className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.validity_days} dias</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="grant-reason">Motivo</Label>
            <Textarea id="grant-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1" placeholder="ex: compensação pela avaria do ar condicionado" />
          </div>
          <div>
            <Label htmlFor="grant-expires">Válidas até (opcional)</Label>
            <Input id="grant-expires" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1" />
            {chosen && !expiresAt && <p className="mt-1 text-xs text-muted-foreground">Sem data, valem {chosen.validity_days} dias a partir de hoje, como o pack.</p>}
          </div>
          {(problem || error) && <p role="alert" className="text-sm text-red-600">{problem ?? error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy || packages.length === 0}>{busy ? 'A atribuir…' : 'Atribuir horas'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
