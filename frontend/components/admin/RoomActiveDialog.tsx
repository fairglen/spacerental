'use client'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Room } from '@/types'

// What `PUT /admin/rooms/{id}` answers with 409 when bookings still hold
// future slots (A07): soonest first, capped, with the true total.
export type RoomInUse = {
  total: number
  bookings: Array<{ id: string; start_time: string; end_time: string; status: string; customer_email: string | null; customer_name: string | null }>
}

export function roomInUseOf(error: unknown): RoomInUse | null {
  const e = error as { response?: { status?: number; data?: { detail?: unknown } } }
  const detail = e?.response?.data?.detail as Partial<RoomInUse> | undefined
  if (e?.response?.status === 409 && detail && Array.isArray(detail.bookings)) return { total: detail.total ?? detail.bookings.length, bookings: detail.bookings }
  return null
}

interface RoomActiveDialogProps {
  room: Room | null
  busy: boolean
  inUse: RoomInUse | null
  error: string | null
  onConfirm: (isActive: boolean) => void
  onClose: () => void
}

/**
 * "Desativar sala" / "Ativar sala" with a confirm step (A07). When the
 * backend refuses because bookings still hold future slots, the same dialog
 * lists them so the operator knows what to move or cancel first.
 */
export function RoomActiveDialog({ room, busy, inUse, error, onConfirm, onClose }: RoomActiveDialogProps) {
  const deactivating = room?.is_active === true
  return (
    <Dialog open={!!room} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {room && (
          <>
            <DialogHeader>
              <DialogTitle>{deactivating ? 'Desativar sala' : 'Ativar sala'}</DialogTitle>
              <DialogDescription>
                {deactivating
                  ? `${room.name} deixa de aparecer aos clientes e não aceita novas reservas. As reservas já feitas mantêm-se — por isso só é possível se não houver nenhuma marcada para o futuro.`
                  : `${room.name} volta a aparecer aos clientes e a aceitar reservas.`}
              </DialogDescription>
            </DialogHeader>
            {inUse && (
              <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-medium text-foreground">
                  Ainda há {inUse.total} {inUse.total === 1 ? 'reserva marcada' : 'reservas marcadas'} nesta sala. Mova-as ou cancele-as no calendário primeiro.
                </p>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {inUse.bookings.map((b) => (
                    <li key={b.id}>
                      {format(parseISO(b.start_time), "EEE d MMM, HH:mm", { locale: pt })}–{format(parseISO(b.end_time), 'HH:mm')}
                      {' · '}{b.customer_name || b.customer_email || 'cliente'}
                      {b.status === 'pending' ? ' · por pagar' : ''}
                    </li>
                  ))}
                  {inUse.total > inUse.bookings.length && <li>… e mais {inUse.total - inUse.bookings.length}.</li>}
                </ul>
              </div>
            )}
            {error && !inUse && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={busy}>{inUse ? 'Fechar' : 'Cancelar'}</Button>
              {!inUse && (
                <Button variant={deactivating ? 'destructive' : 'default'} onClick={() => onConfirm(!deactivating)} disabled={busy}>
                  {busy ? 'A guardar…' : deactivating ? 'Confirmar: desativar' : 'Confirmar: ativar'}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
