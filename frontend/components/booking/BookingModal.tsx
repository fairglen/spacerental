'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { bookingsApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import type { Room } from '@/types'

interface BookingModalProps {
  room: Room | null
  start: Date | null
  end: Date | null
  onClose: () => void
}

export function BookingModal({ room, start, end, onClose }: BookingModalProps) {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()

  const duration = start && end ? (end.getTime() - start.getTime()) / (1000 * 60 * 60) : 0
  const total = room ? duration * room.hourly_rate : 0

  const mutation = useMutation({
    mutationFn: () => {
      if (!room || !start || !end) throw new Error('Missing data')
      const api = createAuthenticatedApi(session?.accessToken)
      return bookingsApi.create({
        room_id: room.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      }, api)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      onClose()
    },
  })

  if (!room || !start || !end) return null

  const isUnauthenticated = status === 'unauthenticated'

  return (
    <Dialog open={!!room && !!start} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar Reserva</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-accent p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sala</span>
              <span className="font-medium text-foreground">{room.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Data</span>
              <span className="font-medium text-foreground">{format(start, "d 'de' MMMM 'de' yyyy", { locale: pt })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Horário</span>
              <span className="font-medium text-foreground">{format(start, 'HH:mm')} – {format(end, 'HH:mm')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Duração</span>
              <span className="font-medium text-foreground">{duration}h</span>
            </div>
            <div className="border-t border-primary-light pt-2 flex justify-between">
              <span className="font-semibold text-foreground">Total</span>
              <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
            </div>
          </div>
          {isUnauthenticated && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Precisas de estar autenticado para reservar.{' '}
              <Link href="/sign-in" className="font-medium underline" onClick={onClose}>
                Entrar na conta
              </Link>
            </p>
          )}
          {mutation.isError && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              Erro ao criar reserva. Tenta novamente.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || isUnauthenticated}
          >
            {mutation.isPending ? 'A confirmar...' : 'Confirmar Reserva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
