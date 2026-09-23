'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { X } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'
import { formatBookingCost, formatHours, packSplitLine, STATUS_COLORS, STATUS_LABELS, isUnpaidHold } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AdminBookingPatch, Booking, Room } from '@/types'

interface BookingSheetProps {
  booking: Booking
  rooms: Room[]
  onClose: () => void
  /** The server's version of the booking after any change. */
  onChanged: (booking: Booking) => void
}

const PAYMENT_LABELS: Record<Booking['payment_method'], string> = {
  hourly: 'À hora', package: 'Pack', mixed: 'Pack + pagamento', manual: 'Pago no local',
}

/**
 * What a move did to the hours (A01, H03): money never moves; the pack share
 * follows the new length through the hour bank, and `uncovered` is what the
 * bank could not give for a longer booking.
 */
function moveOutcome(before: Booking, after: Booking, hours?: { before: number; after: number; uncovered?: number }): string {
  if (!hours || hours.before === hours.after) return 'Horário alterado. O cliente recebe um email.'
  const change = `Horário alterado. Duração ${formatHours(hours.before)} → ${formatHours(hours.after)}.`
  const usesPack = (before.package_hours_used ?? 0) > 0 || before.payment_method === 'package' || before.payment_method === 'mixed'
  if (!usesPack) return `${change} Nada foi cobrado nem devolvido; acerte a diferença com o cliente fora da plataforma.`
  if (hours.uncovered && hours.uncovered > 0) {
    return `${change} O banco de horas do cliente não cobre ${formatHours(hours.uncovered)}; acerte essas horas com o cliente fora da plataforma. Nenhum dinheiro foi movido.`
  }
  // What the PACK share did, not the duration: shortening a mixed booking
  // inside its money part moves no hours at all.
  const delta = (after.package_hours_used ?? 0) - (before.package_hours_used ?? 0)
  if (delta < 0) return `${change} ${formatHours(-delta)} voltaram ao banco de horas do cliente. Nenhum dinheiro foi movido.`
  if (delta > 0) return `${change} ${formatHours(delta)} saíram do banco de horas do cliente. Nenhum dinheiro foi movido.`
  return `${change} As horas de pack não mudaram; nada foi cobrado nem devolvido.`
}

const toLocalDate = (iso: string) => format(parseISO(iso), 'yyyy-MM-dd')
const toLocalTime = (iso: string) => format(parseISO(iso), 'HH:mm')
const fromLocal = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString()

/**
 * The right-side sheet for one booking (A03): everything the operator can see
 * and every A01 action. Each action calls the API and hands the server's
 * answer back up; errors stay inline. Not a route: it opens over the calendar.
 */
export function BookingSheet({ booking, rooms, onClose, onChanged }: BookingSheetProps) {
  const api = useApi()
  const [mode, setMode] = useState<'view' | 'pay' | 'cancel' | 'move'>('view')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState(booking.admin_note ?? '')
  const [move, setMove] = useState({
    room_id: booking.room_id, date: toLocalDate(booking.start_time),
    start: toLocalTime(booking.start_time), end: toLocalTime(booking.end_time),
  })
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Reset the forms when the sheet opens a DIFFERENT booking. A fresh copy
  // of the same one arrives after every action (`onChanged`), and must keep
  // the status line that action just set.
  useEffect(() => {
    setMode('view'); setReason(''); setStatus(null); setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booking.id])
  useEffect(() => {
    setNote(booking.admin_note ?? '')
    setMove({ room_id: booking.room_id, date: toLocalDate(booking.start_time), start: toLocalTime(booking.start_time), end: toLocalTime(booking.end_time) })
  }, [booking])

  const { data: linked = [] } = useQuery({
    queryKey: ['admin', 'support', 'booking', booking.id],
    queryFn: () => adminApi.getSupportRequests({ page_size: 100 }, api).then((p) => p.requests.filter((r) => r.booking_id === booking.id)),
  })

  const done = (b: Booking, message?: string) => { setError(null); setMode('view'); setReason(''); if (message) setStatus(message); onChanged(b) }
  const fail = (e: unknown) => setError(adminBookingErrorMessage(e))

  const confirm = useMutation({ mutationFn: () => adminApi.updateBooking(booking.id, 'confirmed', api), onSuccess: (b) => done(b, 'Reserva confirmada.'), onError: fail })
  const markPaid = useMutation({ mutationFn: () => adminApi.markBookingPaid(booking.id, reason.trim(), api), onSuccess: (b) => done(b, 'Marcada como paga.'), onError: fail })
  const cancel = useMutation({
    mutationFn: () => adminApi.updateBookingDetails(booking.id, {
      status: 'cancelled',
      admin_note: [booking.admin_note, `Cancelada pelo espaço: ${reason.trim()}`].filter(Boolean).join('\n'),
    }, api),
    onSuccess: ({ booking: b }) => done(b, 'Reserva cancelada.'),
    onError: fail,
  })
  const reschedule = useMutation({
    mutationFn: () => {
      const body: AdminBookingPatch = { start_time: fromLocal(move.date, move.start), end_time: fromLocal(move.date, move.end) }
      if (move.room_id !== booking.room_id) body.room_id = move.room_id
      return adminApi.updateBookingDetails(booking.id, body, api)
    },
    onSuccess: ({ booking: b, hours }) => done(b, moveOutcome(booking, b, hours)),
    onError: fail,
  })
  const saveNote = useMutation({
    mutationFn: () => adminApi.updateBookingDetails(booking.id, { admin_note: note.trim() || null }, api),
    onSuccess: ({ booking: b }) => done(b, 'Nota guardada.'),
    onError: fail,
  })
  const busy = confirm.isPending || markPaid.isPending || cancel.isPending || reschedule.isPending || saveNote.isPending

  const canConfirm = booking.status === 'pending'
  const canMarkPaid = isUnpaidHold(booking) || booking.status === 'expired'
  const canCancel = ['pending', 'confirmed'].includes(booking.status)
  const canMove = ['pending', 'confirmed'].includes(booking.status)

  return (
    <aside role="dialog" aria-modal="false" aria-labelledby="sheet-title" className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-white shadow-xl">
      <div className="flex items-start justify-between border-b border-border p-4">
        <div>
          <h2 id="sheet-title" className="text-lg font-semibold text-foreground">Reserva</h2>
          <p className="text-xs text-muted-foreground">#{booking.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Fechar"><X className="h-4 w-4" aria-hidden /></Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Cliente</dt>
          <dd className="text-foreground">
            <span className="font-medium">{booking.user?.name ?? '—'}</span>
            {booking.user && (
              <>
                {' · '}
                <Link href={`/admin/users/${booking.user.id}`} className="text-primary underline underline-offset-2">{booking.user.email}</Link>
              </>
            )}
          </dd>
          <dt className="text-muted-foreground">Quando</dt>
          <dd className="text-foreground">{format(parseISO(booking.start_time), "EEEE, d 'de' MMMM", { locale: pt })}, {toLocalTime(booking.start_time)}–{toLocalTime(booking.end_time)} ({formatHours(booking.duration_hours)})</dd>
          <dt className="text-muted-foreground">Sala</dt>
          <dd className="text-foreground">{booking.room?.name ?? rooms.find((r) => r.id === booking.room_id)?.name ?? '—'}</dd>
          <dt className="text-muted-foreground">Estado</dt>
          <dd><Badge className={STATUS_COLORS[booking.status]}>{isUnpaidHold(booking) ? 'A aguardar pagamento' : STATUS_LABELS[booking.status]}</Badge></dd>
          <dt className="text-muted-foreground">Pagamento</dt>
          <dd className="text-foreground">
            {/* "Pago no local" already says the method; do not say it twice. */}
            {booking.payment_method === 'manual' ? formatBookingCost(booking) : `${PAYMENT_LABELS[booking.payment_method]} · ${formatBookingCost(booking)}`}
            {/* H02: which packs the hours came from, on demand. */}
            {(booking.package_debits?.length ?? 0) > 0 && (
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {booking.package_debits!.length === 1 ? 'Ver o pack' : `Ver os ${booking.package_debits!.length} packs`}
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {booking.package_debits!.map((d) => <li key={d.purchase_id}>{packSplitLine(d)}</li>)}
                </ul>
              </details>
            )}
          </dd>
          <dt className="text-muted-foreground">Código</dt>
          <dd className="font-mono text-foreground">{booking.access_code ?? '—'}</dd>
          {booking.notes && (<><dt className="text-muted-foreground">Nota do cliente</dt><dd className="whitespace-pre-wrap text-foreground">{booking.notes}</dd></>)}
        </dl>

        {linked.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-foreground">Pedidos de ajuda</p>
            <ul className="space-y-1">
              {linked.map((r) => (
                <li key={r.id}><Link href="/admin/support" className="text-primary underline underline-offset-2">#{r.reference}</Link> <span className="text-muted-foreground">· {r.status === 'new' ? 'novo' : 'fechado'}</span></li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <Label htmlFor="sheet-note">Nota interna</Label>
          <Textarea id="sheet-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1" placeholder="Só o espaço vê isto." />
          <Button size="sm" variant="outline" className="mt-2" disabled={busy || note.trim() === (booking.admin_note ?? '').trim()} onClick={() => saveNote.mutate()}>Guardar nota</Button>
        </div>

        {status && <p role="status" className="rounded-lg bg-accent px-3 py-2 text-foreground">{status}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

        {mode === 'view' && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {canConfirm && <Button size="sm" disabled={busy} onClick={() => confirm.mutate()}>Confirmar</Button>}
            {canMarkPaid && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setMode('pay') }}>Marcar como pago</Button>}
            {canMove && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setError(null); setMode('move') }}>Alterar horário</Button>}
            {canCancel && <Button size="sm" variant="ghost" className="text-red-600" disabled={busy} onClick={() => { setError(null); setMode('cancel') }}>Cancelar reserva</Button>}
          </div>
        )}

        {mode === 'pay' && (
          <form className="space-y-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); markPaid.mutate() }}>
            <Label htmlFor="pay-reason">Motivo / como pagou</Label>
            <Input id="pay-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex: Pagou por MB WAY" />
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy || !reason.trim()}>Confirmar pagamento</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => setMode('view')}>Voltar</Button>
            </div>
          </form>
        )}

        {mode === 'cancel' && (
          <form className="space-y-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); cancel.mutate() }}>
            <p className="text-foreground">Cancelar esta reserva? O cliente recebe um email. As horas de pack voltam ao saldo dele; nada é devolvido aqui.</p>
            <Label htmlFor="cancel-reason">Motivo do cancelamento</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" type="submit" variant="destructive" disabled={busy || !reason.trim()}>Sim, cancelar</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => setMode('view')}>Voltar</Button>
            </div>
          </form>
        )}

        {mode === 'move' && (
          <form className="space-y-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); reschedule.mutate() }}>
            <div>
              <Label htmlFor="move-room">Sala</Label>
              <select id="move-room" value={move.room_id} onChange={(e) => setMove({ ...move, room_id: e.target.value })} className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
                {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="move-date">Data</Label>
              <Input id="move-date" type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="move-start">Início</Label><Input id="move-start" type="time" step={3600} value={move.start} onChange={(e) => setMove({ ...move, start: e.target.value })} className="mt-1" /></div>
              <div><Label htmlFor="move-end">Fim</Label><Input id="move-end" type="time" step={3600} value={move.end} onChange={(e) => setMove({ ...move, end: e.target.value })} className="mt-1" /></div>
            </div>
            <p className="text-xs text-muted-foreground">O cliente recebe um email com o novo horário. Uma duração diferente não cobra nem devolve dinheiro aqui; as horas de pack acertam-se pelo banco de horas.</p>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy}>Guardar horário</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => setMode('view')}>Voltar</Button>
            </div>
          </form>
        )}
      </div>
    </aside>
  )
}
