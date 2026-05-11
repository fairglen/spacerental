'use client'
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
  const { data: session } = useSession()
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

  return (
    <Dialog open={!!room && !!start} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar Reserva</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-[#E8F4F0] p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[#6B7280]">Sala</span>
              <span className="font-medium text-[#1A1A2E]">{room.name}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6B7280]">Data</span>
              <span className="font-medium text-[#1A1A2E]">{format(start, "d 'de' MMMM 'de' yyyy", { locale: pt })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6B7280]">Horário</span>
              <span className="font-medium text-[#1A1A2E]">{format(start, 'HH:mm')} – {format(end, 'HH:mm')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#6B7280]">Duração</span>
              <span className="font-medium text-[#1A1A2E]">{duration}h</span>
            </div>
            <div className="border-t border-[#A8D5BA] pt-2 flex justify-between">
              <span className="font-semibold text-[#1A1A2E]">Total</span>
              <span className="font-bold text-[#3D7A5E] text-lg">{formatCurrency(total)}</span>
            </div>
          </div>
          {mutation.isError && (
            <p className="text-sm text-red-600">Erro ao criar reserva. Tenta novamente.</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'A confirmar...' : 'Confirmar Reserva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
