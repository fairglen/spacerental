'use client'
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { adminBookingErrorMessage } from '@/lib/adminBookingErrors'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Room } from '@/types'

interface NewEntryDialogProps {
  slot: { room: Room; start: Date; end: Date } | null
  rooms: Room[]
  onClose: () => void
  onCreated: () => void
}

const toTime = (d: Date) => format(d, 'HH:mm')
const fromLocal = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString()

/**
 * What a click or drag on empty calendar space opens (A03): a manual booking
 * for a customer ("Nova reserva") or a block ("Bloquear horário"), both from
 * the A01/A02 endpoints. Pre-filled with the room and time that was picked.
 */
export function NewEntryDialog({ slot, rooms, onClose, onCreated }: NewEntryDialogProps) {
  const api = useApi()
  const [tab, setTab] = useState<'booking' | 'block'>('booking')
  const [roomId, setRoomId] = useState(slot?.room.id ?? '')
  const [date, setDate] = useState(slot ? format(slot.start, 'yyyy-MM-dd') : '')
  const [start, setStart] = useState(slot ? toTime(slot.start) : '09:00')
  const [end, setEnd] = useState(slot ? toTime(slot.end) : '10:00')
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  // The org's members, searched server-side by name or email (A05).
  const needle = search.trim().toLowerCase()
  const { data: found } = useQuery({
    queryKey: ['admin', 'users', 'picker', needle],
    queryFn: () => adminApi.getUsers({ q: needle, page_size: 8 }, api),
    enabled: !!slot && needle.length > 0 && !userId,
  })
  const matches = needle && !userId ? found?.users ?? [] : []

  const createBooking = useMutation({
    mutationFn: () => adminApi.createManualBooking({ user_id: userId, room_id: roomId, start_time: fromLocal(date, start), end_time: fromLocal(date, end), admin_note: note.trim() || undefined }, api),
    onSuccess: () => { onCreated(); onClose() },
    onError: (e) => setError(adminBookingErrorMessage(e)),
  })
  const createBlock = useMutation({
    mutationFn: () => adminApi.createBlock(roomId, { start_time: fromLocal(date, start), end_time: fromLocal(date, end), reason: reason.trim() }, api),
    onSuccess: () => { onCreated(); onClose() },
    onError: (e) => setError(adminBookingErrorMessage(e)),
  })
  const busy = createBooking.isPending || createBlock.isPending

  return (
    <Dialog open={!!slot} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tab === 'booking' ? 'Nova reserva' : 'Bloquear horário'}</DialogTitle>
          <DialogDescription>
            {slot && `${format(slot.start, "EEEE, d 'de' MMMM", { locale: pt })}`}
          </DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Tipo" className="flex gap-1 rounded-lg bg-accent p-1">
          {(['booking', 'block'] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => { setTab(t); setError(null) }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-white text-foreground shadow' : 'text-muted-foreground'}`}>
              {t === 'booking' ? 'Nova reserva' : 'Bloquear horário'}
            </button>
          ))}
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); tab === 'booking' ? createBooking.mutate() : createBlock.mutate() }}>
          <div>
            <Label htmlFor="new-room">Sala</Label>
            <select id="new-room" value={roomId} onChange={(e) => setRoomId(e.target.value)} className="mt-1 flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="new-date">Data</Label><Input id="new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></div>
            <div><Label htmlFor="new-start">Início</Label><Input id="new-start" type="time" step={3600} value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" /></div>
            <div><Label htmlFor="new-end">Fim</Label><Input id="new-end" type="time" step={3600} value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1" /></div>
          </div>
          {tab === 'booking' ? (
            <>
              <div>
                <Label htmlFor="new-customer">Cliente</Label>
                <Input id="new-customer" value={search} onChange={(e) => { setSearch(e.target.value); setUserId('') }} className="mt-1" placeholder="Nome ou email" autoComplete="off" />
                {matches.length > 0 && !userId && (
                  <ul role="listbox" className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-white text-sm">
                    {matches.map((u) => (
                      <li key={u.id}>
                        <button type="button" role="option" aria-selected={false} onClick={() => { setUserId(u.id); setSearch(`${u.name} · ${u.email}`) }} className="w-full px-3 py-1.5 text-left hover:bg-accent">
                          {u.name} <span className="text-muted-foreground">· {u.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {needle && found && matches.length === 0 && !userId && <p className="mt-1 text-xs text-muted-foreground">Nenhum cliente com esse nome ou email.</p>}
              </div>
              <div>
                <Label htmlFor="new-note">Nota interna (opcional)</Label>
                <Textarea id="new-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1" placeholder="ex: pagou em dinheiro" />
              </div>
              <p className="text-xs text-muted-foreground">Fica confirmada de imediato como paga no local. O cliente recebe o email de confirmação e o código de acesso.</p>
            </>
          ) : (
            <div>
              <Label htmlFor="new-reason">Motivo</Label>
              <Input id="new-reason" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1" placeholder="ex: obras, limpeza, uso interno" />
            </div>
          )}
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button type="submit" disabled={busy || (tab === 'booking' ? !userId : !reason.trim())}>
              {tab === 'booking' ? 'Criar reserva' : 'Bloquear'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
