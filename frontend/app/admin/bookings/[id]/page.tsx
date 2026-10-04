'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Copy } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'
import { useCrud } from '@/components/admin/crud/useCrud'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryRow } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { ReasonDialog } from '@/components/admin/crud/ReasonDialog'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { moveOutcome } from '@/components/admin/calendar/BookingSheet'
import { formatBookingCost, formatCurrency, formatHours, isUnpaidHold, packSplitLine, STATUS_LABELS } from '@/lib/utils'
import { PAYMENT_LABELS, hardDeleteAllowed } from '@/lib/admin/bookingLabels'
import { utcToWall, wallToUtc } from '@/lib/spaceClock'
import type { AdminBookingPatch, Booking } from '@/types'

// The form speaks the room's space clock (R01), not the operator's browser
// zone: an operator abroad would otherwise move a booking to the wrong
// instant (review on #65). `DEFAULT_TZ` only until the spaces have loaded.
const DEFAULT_TZ = 'Europe/Lisbon'

/** One booking (G06): Cliente, Quando/Onde, Pagamento, Acesso, Notas, DangerZone, Histórico. */
export default function AdminBookingPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('bookings')
  return <BookingDetail key={`${currentOrgId}-${id}`} bookingId={id} />
}

function Section({ id, title, children, action }: { id: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 id={id} className="text-base font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function BookingDetail({ bookingId }: { bookingId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('bookings')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'bookings', currentOrgId, bookingId],
    queryFn: () => adminApi.getBooking(bookingId, api),
    enabled,
  })
  const { data: spaces } = useQuery({ queryKey: ['admin', 'spaces', currentOrgId], queryFn: () => adminApi.getSpaces(api), enabled })
  const rooms = (spaces ?? []).flatMap((s) => (s.rooms ?? []).filter((r) => r.is_active))
  const zoneOfRoom = (roomId: string | undefined) =>
    (spaces ?? []).find((s) => (s.rooms ?? []).some((r) => r.id === roomId))?.timezone ?? DEFAULT_TZ

  const [moving, setMoving] = useState(false)
  const [move, setMove] = useState({ room_id: '', date: '', start: '', end: '' })
  const [priceOpen, setPriceOpen] = useState(false)
  const [price, setPrice] = useState('')
  const [cancelOpen, setCancelOpen] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [notes, setNotes] = useState({ notes: '', admin_note: '' })
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!data) return
    const b = data.booking
    const zone = zoneOfRoom(b.room_id)
    const start = utcToWall(b.start_time, zone)
    setMove({ room_id: b.room_id, date: start.date, start: start.time, end: utcToWall(b.end_time, zone).time })
    setNotes({ notes: b.notes ?? '', admin_note: b.admin_note ?? '' })
    setPrice(b.total_amount.toFixed(2))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, spaces])

  const done = async (message: string) => { toast({ title: message, variant: 'success' }); await invalidate(bookingId) }
  const fail = (err: unknown) => toast({ title: adminBookingErrorMessage(err), variant: 'error' })
  const patch = useMutation({
    mutationFn: (body: AdminBookingPatch) => adminApi.updateBookingDetails(bookingId, body, api),
  })
  const reschedule = useMutation({
    mutationFn: () => {
      const zone = zoneOfRoom(move.room_id)
      const body: AdminBookingPatch = { start_time: wallToUtc(move.date, move.start, zone), end_time: wallToUtc(move.date, move.end, zone) }
      if (data && move.room_id !== data.booking.room_id) body.room_id = move.room_id
      return adminApi.updateBookingDetails(bookingId, body, api)
    },
    onSuccess: async ({ booking, hours }) => { setMoving(false); await done(data ? moveOutcome(data.booking, booking, hours) : 'Horário alterado.') },
    onError: fail,
  })
  const saveNotes = useMutation({
    mutationFn: () => adminApi.updateBookingDetails(bookingId, { notes: notes.notes.trim() || null, admin_note: notes.admin_note.trim() || null }, api),
    onSuccess: () => done('Notas guardadas.'),
    onError: fail,
  })
  const setStatus = useMutation({
    mutationFn: (status: Booking['status']) => adminApi.updateBookingDetails(bookingId, { status }, api),
    onSuccess: () => done('Estado alterado.'),
    onError: fail,
  })

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar esta reserva. <Link href="/admin/bookings" className="underline">Voltar à lista</Link>.</p></div>
  const b = data.booking
  const short = b.id.replace(/-/g, '').slice(0, 8)
  const canMove = ['pending', 'confirmed'].includes(b.status)
  const canCancel = ['pending', 'confirmed'].includes(b.status)
  const canMarkPaid = isUnpaidHold(b) || b.status === 'expired'
  const deletable = hardDeleteAllowed(b)
  // Read-only times on the same clock the form uses (review on #65).
  const wall = utcToWall(b.start_time, zoneOfRoom(b.room_id))
  const wallEnd = utcToWall(b.end_time, zoneOfRoom(b.room_id))

  async function copyStripeId() {
    if (!b.stripe_checkout_session_id) return
    try { await navigator.clipboard.writeText(b.stripe_checkout_session_id); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* the id is on screen anyway */ }
  }

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <PageHeader
        title={`Reserva #${short.toUpperCase()}`}
        crumbs={[{ label: 'Reservas', href: '/admin/bookings' }, { label: `#${short.toUpperCase()}` }]}
        badge={<Badge variant={b.status === 'confirmed' ? 'success' : b.status === 'pending' ? 'warning' : 'secondary'}>{STATUS_LABELS[b.status]}</Badge>}
        description={`${format(parseISO(`${wall.date}T00:00:00`), "EEEE d 'de' MMMM", { locale: pt })}, ${wall.time}–${wallEnd.time} · ${b.room?.name ?? ''}`}
        actions={
          <>
            {b.status === 'pending' && <Button type="button" size="sm" onClick={() => setStatus.mutate('confirmed')} disabled={setStatus.isPending}>Confirmar</Button>}
            {b.status === 'confirmed' && <Button type="button" size="sm" variant="outline" onClick={() => setStatus.mutate('completed')} disabled={setStatus.isPending}>Marcar como concluída</Button>}
            {b.status === 'completed' && <Button type="button" size="sm" variant="outline" onClick={() => setStatus.mutate('confirmed')} disabled={setStatus.isPending}>Voltar a confirmada</Button>}
            {canMarkPaid && <Button type="button" size="sm" variant="outline" onClick={() => setPayOpen(true)}>Marcar como paga</Button>}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section id="cliente" title="Cliente">
          {b.user ? (
            <dl className="text-sm space-y-1">
              <div><dt className="sr-only">Nome</dt><dd className="font-medium text-foreground">{b.user.name || '—'}</dd></div>
              <div><dt className="sr-only">Email</dt><dd><Link href={`/admin/users/${b.user.id}`} className="text-primary underline underline-offset-2">{b.user.email}</Link></dd></div>
            </dl>
          ) : <p className="text-sm text-muted-foreground">—</p>}
        </Section>

        <Section id="quando" title="Quando / Onde" action={canMove && !moving && <Button type="button" size="sm" variant="outline" onClick={() => setMoving(true)}>Alterar horário</Button>}>
          {!moving ? (
            <dl className="text-sm space-y-1">
              <div><dt className="inline text-muted-foreground">Sala: </dt><dd className="inline">{b.room ? <Link href={`/admin/rooms/${b.room.id}`} className="underline underline-offset-2">{b.room.name}</Link> : '—'}</dd></div>
              <div><dt className="inline text-muted-foreground">Data: </dt><dd className="inline">{format(parseISO(`${wall.date}T00:00:00`), "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt })}</dd></div>
              <div><dt className="inline text-muted-foreground">Horas: </dt><dd className="inline">{wall.time}–{wallEnd.time} ({formatHours(b.duration_hours)})</dd></div>
              {b.hold_expires_at && b.status === 'pending' && <div><dt className="inline text-muted-foreground">Reserva de lugar até: </dt><dd className="inline">{format(parseISO(b.hold_expires_at), 'HH:mm', { locale: pt })}</dd></div>}
            </dl>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); reschedule.mutate() }} aria-label="Alterar horário">
              <div>
                <Label htmlFor="move-room">Sala</Label>
                <select id="move-room" value={move.room_id} onChange={(e) => setMove({ ...move, room_id: e.target.value })} className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div><Label htmlFor="move-date">Data</Label><Input id="move-date" type="date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} className="mt-1" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label htmlFor="move-start">Início</Label><Input id="move-start" type="time" step={3600} value={move.start} onChange={(e) => setMove({ ...move, start: e.target.value })} className="mt-1" /></div>
                <div><Label htmlFor="move-end">Fim</Label><Input id="move-end" type="time" step={3600} value={move.end} onChange={(e) => setMove({ ...move, end: e.target.value })} className="mt-1" /></div>
              </div>
              <p className="text-xs text-muted-foreground">O cliente recebe um email com o novo horário. Uma duração diferente não cobra nem devolve dinheiro aqui; as horas de pack acertam-se pelo banco de horas.</p>
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={reschedule.isPending}>Guardar horário</Button>
                <Button size="sm" type="button" variant="outline" onClick={() => setMoving(false)}>Voltar</Button>
              </div>
            </form>
          )}
        </Section>

        <Section id="pagamento" title="Pagamento" action={<Button type="button" size="sm" variant="outline" onClick={() => setPriceOpen(true)}>Corrigir valor</Button>}>
          <dl className="text-sm space-y-1">
            <div><dt className="inline text-muted-foreground">Método: </dt><dd className="inline">{PAYMENT_LABELS[b.payment_method]}</dd></div>
            <div><dt className="inline text-muted-foreground">Valor registado: </dt><dd className="inline font-medium" data-testid="booking-amount">{formatCurrency(b.total_amount)}</dd></div>
            <div><dt className="inline text-muted-foreground">Resumo: </dt><dd className="inline">{formatBookingCost(b)}</dd></div>
            {(b.package_debits ?? []).length > 0 && (
              <div>
                <dt className="text-muted-foreground">Horas de pack, por compra:</dt>
                <dd><ul className="list-disc pl-5">{b.package_debits!.map((d) => <li key={d.purchase_id}><Link href={`/admin/purchases/${d.purchase_id}`} className="underline underline-offset-2">{packSplitLine(d)}</Link></li>)}</ul></dd>
              </div>
            )}
            <div>
              <dt className="inline text-muted-foreground">Stripe: </dt>
              <dd className="inline">
                {b.stripe_checkout_session_id ? (
                  <>
                    <code className="text-xs">{b.stripe_checkout_session_id}</code>
                    <button type="button" className="ml-2 inline-flex items-center text-xs text-primary underline" onClick={copyStripeId} aria-label="Copiar identificador Stripe"><Copy className="h-3 w-3 mr-1" />{copied ? 'Copiado' : 'Copiar'}</button>
                  </>
                ) : '—'}
              </dd>
            </div>
          </dl>
        </Section>

        <Section id="acesso" title="Acesso">
          <p className="text-sm">
            {b.access_code ? <>Código da porta: <code className="font-mono text-base">{b.access_code}</code></> : <span className="text-muted-foreground">Sem código emitido{b.status === 'confirmed' ? ' (ainda)' : ''}.</span>}
          </p>
        </Section>
      </div>

      <Section id="notas" title="Notas">
        <form className="grid grid-cols-1 gap-4 lg:grid-cols-2" onSubmit={(e) => { e.preventDefault(); saveNotes.mutate() }} aria-label="Notas">
          <div>
            <Label htmlFor="notes">Nota do cliente</Label>
            <Textarea id="notes" rows={3} value={notes.notes} onChange={(e) => setNotes({ ...notes, notes: e.target.value })} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">O cliente vê esta nota.</p>
          </div>
          <div>
            <Label htmlFor="admin_note">Nota interna</Label>
            <Textarea id="admin_note" rows={3} value={notes.admin_note} onChange={(e) => setNotes({ ...notes, admin_note: e.target.value })} className="mt-1" />
            <p className="text-xs text-muted-foreground mt-1">Só a equipa vê.</p>
          </div>
          <div className="lg:col-span-2 flex justify-end"><Button type="submit" size="sm" disabled={saveNotes.isPending}>Guardar notas</Button></div>
        </form>
      </Section>

      <DangerZone
        entityLabel="reserva"
        name={short}
        shortId={short}
        keeps="Cancelar devolve as horas de pack ao cliente e avisa-o por email; nada é devolvido em dinheiro aqui. Eliminar só é possível para uma reserva que nunca movimentou dinheiro nem horas."
        soft={canCancel ? { active: true, onToggle: async () => { setCancelOpen(true) }, activeLabel: 'Cancelar reserva', buttonLabel: 'Cancelar reserva', hint: 'Pede um motivo; o cliente recebe um email.' } : undefined}
        hard={{
          onDelete: async (confirm) => {
            await adminApi.deleteBooking(bookingId, confirm, b.payment_method === 'manual' ? 'Eliminada pelo espaço' : undefined, api)
            toast({ title: 'Reserva eliminada.', variant: 'success' })
            await invalidate()
            router.push('/admin/bookings')
          },
          disabledReason: deletable ? undefined : 'Esta reserva movimentou dinheiro ou horas de pack: cancele-a em vez de a eliminar.',
        }}
        onDone={() => invalidate(bookingId)}
      />

      <section aria-labelledby="historico" className="rounded-xl border border-border bg-white p-5">
        <h2 id="historico" className="text-base font-semibold text-foreground">Histórico</h2>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground mt-2">Ainda sem alterações registadas.</p> : (
          <ul className="mt-2 divide-y divide-border">{data.history.map((a) => <HistoryRow key={a.id} action={a} />)}</ul>
        )}
        <p className="mt-3 text-xs"><Link href={`/admin/audit?entity_type=booking&entity_id=${bookingId}`} className="text-primary underline">Ver no histórico completo</Link></p>
      </section>

      <ReasonDialog
        open={priceOpen}
        title="Corrigir o valor da reserva"
        description="Muda o valor registado; nada é cobrado nem devolvido. O cliente passa a ver o novo valor."
        confirmLabel="Corrigir valor"
        canConfirm={price.trim() !== '' && Number(price) >= 0}
        onConfirm={async (reason) => { await patch.mutateAsync({ total_amount: Number(price), reason }); await done('Valor corrigido.') }}
        onClose={() => setPriceOpen(false)}
      >
        <div>
          <Label htmlFor="price">Novo valor (€)</Label>
          <Input id="price" type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
        </div>
      </ReasonDialog>
      <ReasonDialog
        open={cancelOpen}
        title="Cancelar esta reserva"
        description="O cliente recebe um email. As horas de pack voltam ao saldo dele; nada é devolvido em dinheiro aqui."
        confirmLabel="Sim, cancelar"
        destructive
        onConfirm={async (reason) => {
          // `reason` goes to the trail's own field as well as the note.
          await patch.mutateAsync({ status: 'cancelled', reason, admin_note: [b.admin_note, `Cancelada pelo espaço: ${reason}`].filter(Boolean).join('\n') })
          await done('Reserva cancelada.')
        }}
        onClose={() => setCancelOpen(false)}
      />
      <ReasonDialog
        open={payOpen}
        title="Marcar como paga"
        description="Para um pagamento recebido fora da plataforma (dinheiro, MB WAY). A reserva fica confirmada com código e email."
        confirmLabel="Confirmar pagamento"
        onConfirm={async (reason) => { await adminApi.markBookingPaid(bookingId, reason, api); await done('Marcada como paga.') }}
        onClose={() => setPayOpen(false)}
      />
    </div>
  )
}
