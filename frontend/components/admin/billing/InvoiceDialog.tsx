'use client'
import { useState, type FormEvent } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatHours } from '@/lib/utils'
import type { Invoice, InvoiceUpdateBody } from '@/types'

// Editing a registered invoice (I06): number, date, note and the PDF. The
// amount, hours and transactions are the statement's — to change what it
// covers, delete and register again.

export type InvoiceDialogProps = {
  invoice: Invoice
  busy: boolean
  error: string | null
  onSubmit: (body: InvoiceUpdateBody) => void
  onClose: () => void
}

export function InvoiceDialog({ invoice, busy, error, onSubmit, onClose }: InvoiceDialogProps) {
  const [number, setNumber] = useState(invoice.number)
  const [issuedAt, setIssuedAt] = useState(invoice.issued_at)
  const [note, setNote] = useState(invoice.note ?? '')
  const [pdf, setPdf] = useState<File | null>(null)
  const [removePdf, setRemovePdf] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!number.trim()) { setLocalError('Indique o número da fatura.'); return }
    setLocalError(null)
    onSubmit({ number: number.trim(), issued_at: issuedAt, note, pdf: pdf ?? undefined, remove_pdf: removePdf && !pdf })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar fatura {invoice.number}</DialogTitle>
            <DialogDescription>
              {invoice.user.billing_name || invoice.user.name || invoice.user.email} · {formatCurrency(Number(invoice.amount))} · {formatHours(Number(invoice.hours))}.
              {' '}O valor e as transações não se alteram aqui: para mudar o que a fatura cobre, elimine o registo e registe de novo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="edit-invoice-number">Nº da fatura</Label>
              <Input id="edit-invoice-number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-invoice-issued-at">Data de emissão</Label>
              <Input id="edit-invoice-issued-at" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-invoice-pdf">{invoice.has_pdf ? 'Substituir o PDF' : 'PDF da fatura'}</Label>
            <Input id="edit-invoice-pdf" type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          </div>
          {invoice.has_pdf && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={removePdf} onChange={(e) => setRemovePdf(e.target.checked)} disabled={!!pdf} />
              Remover o PDF atual
            </label>
          )}
          <div className="space-y-1">
            <Label htmlFor="edit-invoice-note">Nota</Label>
            <Textarea id="edit-invoice-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {(localError || error) && <p role="alert" className="text-sm text-destructive">{localError ?? error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy ? 'A guardar…' : 'Guardar'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
