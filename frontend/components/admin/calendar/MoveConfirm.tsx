'use client'
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'
import { formatHours } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Booking, Room } from '@/types'

export type MoveProposal = { booking: Booking; room: Room; start: Date; end: Date }

interface MoveConfirmProps {
  proposal: MoveProposal
  onConfirm: () => Promise<void>
  onCancel: () => void
}

const hours = (b: { start_time: string; end_time: string }) =>
  (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000

/**
 * The confirm step between a drag/resize and the API (A03). A booking is a
 * money-bearing object, so the calendar never writes optimistically: the
 * event stays where it was until the operator says "Mover" and the API
 * agrees, and a refusal is shown here rather than closing.
 */
export function MoveConfirm({ proposal, onConfirm, onCancel }: MoveConfirmProps) {
  const { booking, room, start, end } = proposal
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])

  const roomChanged = room.id !== booking.room_id
  const before = hours(booking)
  const after = (end.getTime() - start.getTime()) / 3_600_000
  const when = `${format(start, "EEEE d MMM", { locale: pt })}, ${format(start, 'HH:mm')}–${format(end, 'HH:mm')}`
  const headline = roomChanged ? `Mover para ${room.name}, ${when}?` : `Alterar para ${when}?`

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (e) {
      setError(adminBookingErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="move-confirm-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 id="move-confirm-title" className="text-lg font-semibold text-foreground">{headline}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {booking.user?.name ?? booking.user?.email ?? 'O cliente'} recebe um email com o novo horário.
          {before !== after && (
            <>
              {' '}A duração passa de {formatHours(before)} para {formatHours(after)} ({formatHours(before)} → {formatHours(after)}):
              nada é cobrado nem devolvido aqui; acerta a diferença com o cliente fora da plataforma.
            </>
          )}
        </p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Não mover</Button>
          <Button ref={first} onClick={() => void confirm()} disabled={busy}>{busy ? 'A mover…' : 'Mover'}</Button>
        </div>
      </div>
    </div>
  )
}
