'use client'
import { useMemo, useState, type FormEvent } from 'react'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { formatCurrency, formatHours } from '@/lib/utils'
import { isoLocalDate } from '@/lib/billingPeriods'
import type { BillingPeriod, BillingTransaction, InvoiceCreateBody, StatementLine } from '@/types'

// "Registar fatura emitida" (I06): the fatura comes out of the operator's
// certified software; this records it against the customer's pending
// transactions. The amount and hours are the statement's sums for what is
// ticked — read-only here, checked again by the API.

export const KIND_LABELS: Record<BillingTransaction['kind'], string> = {
  pack: 'Pack',
  hourly: 'Reserva à hora',
  mixed: 'Reserva mista',
  manual: 'Pagamento manual',
}

const cents = (value: string) => Math.round(Number(value) * 100)
const fromCents = (value: number) => (value / 100).toFixed(2)

export const transactionKey = (t: BillingTransaction) => `${t.kind}:${t.id}`

/** The statement's own arithmetic, in cents: Decimal strings in, Decimal strings out. */
export function sums(transactions: BillingTransaction[]): { amount: string; hours: string } {
  return {
    amount: fromCents(transactions.reduce((n, t) => n + cents(t.amount), 0)),
    hours: fromCents(transactions.reduce((n, t) => n + cents(t.hours), 0)),
  }
}

export type RegisterInvoiceDialogProps = {
  line: StatementLine
  period: BillingPeriod
  busy: boolean
  error: string | null
  onSubmit: (body: InvoiceCreateBody) => void
  onClose: () => void
}

export function RegisterInvoiceDialog({ line, period, busy, error, onSubmit, onClose }: RegisterInvoiceDialogProps) {
  const pending = useMemo(() => line.transactions.filter((t) => t.invoice_id === null), [line])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(pending.map(transactionKey)))
  const [number, setNumber] = useState('')
  const [issuedAt, setIssuedAt] = useState(() => isoLocalDate(new Date()))
  const [note, setNote] = useState('')
  const [notify, setNotify] = useState(true)
  const [pdf, setPdf] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const chosen = pending.filter((t) => selected.has(transactionKey(t)))
  const totals = sums(chosen)
  const who = line.user.billing_name || line.user.name || line.user.email

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!number.trim()) { setLocalError('Indique o número da fatura.'); return }
    if (chosen.length === 0) { setLocalError('Selecione pelo menos uma transação.'); return }
    setLocalError(null)
    onSubmit({
      user_id: line.user.id,
      number: number.trim(),
      issued_at: issuedAt,
      period_from: period.from,
      period_to: period.to,
      amount: totals.amount,
      hours: totals.hours,
      transaction_ids: chosen.map(transactionKey),
      note: note.trim() || undefined,
      notify,
      pdf,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Registar fatura emitida</DialogTitle>
            <DialogDescription>
              Emita a fatura no seu software de faturação e registe-a aqui com as transações que cobre.
              {' '}Cliente: {who}{line.user.tax_id ? ` · NIF ${line.user.tax_id}` : ' · sem NIF'}.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">Transações por faturar</legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {pending.map((t) => {
                const key = transactionKey(t)
                return (
                  <li key={key}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm">
                      <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} aria-label={`${KIND_LABELS[t.kind]} · ${t.label}`} />
                      <span className="flex-1 text-foreground">{KIND_LABELS[t.kind]} · {t.label}</span>
                      <span className="text-muted-foreground whitespace-nowrap">{format(parseISO(t.paid_at), 'd MMM', { locale: pt })}</span>
                      <span className="w-20 text-right font-medium text-foreground">{formatCurrency(Number(t.amount))}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Valor</p>
              <p className="text-lg font-semibold text-foreground" data-testid="invoice-amount">{formatCurrency(Number(totals.amount))}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Horas</p>
              <p className="text-lg font-semibold text-foreground" data-testid="invoice-hours">{formatHours(Number(totals.hours))}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="invoice-number">Nº da fatura</Label>
              <Input id="invoice-number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="FT 2026/12" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="invoice-issued-at">Data de emissão</Label>
              <Input id="invoice-issued-at" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-pdf">PDF da fatura</Label>
            <Input id="invoice-pdf" type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invoice-note">Nota</Label>
            <Textarea id="invoice-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Avisar o cliente por email
          </label>

          {(localError || error) && <p role="alert" className="text-sm text-destructive">{localError ?? error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy || chosen.length === 0}>{busy ? 'A registar…' : 'Registar fatura'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
