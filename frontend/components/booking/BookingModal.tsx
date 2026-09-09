'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { bookingsApi, recurrencesApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { statusOf, conflictsOf } from '@/lib/httpError'
import { expandWeeklyOccurrences } from '@/lib/recurrence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

function errorMessage(error: unknown): string {
  return statusOf(error) === 409
    ? 'Este horário já está reservado. Escolhe outro intervalo no calendário.'
    : 'Erro ao criar reserva. Tenta novamente.'
}

export function BookingModal({ room, start, end, onClose }: BookingModalProps) {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()

  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [untilDate, setUntilDate] = useState('')

  const duration = start && end ? (end.getTime() - start.getTime()) / (1000 * 60 * 60) : 0
  const total = room ? duration * room.hourly_rate : 0

  const occurrences = useMemo(
    () => (repeatWeekly && start ? expandWeeklyOccurrences(start, untilDate) : []),
    [repeatWeekly, start, untilDate],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      if (!room || !start || !end) throw new Error('Missing data')
      const api = createAuthenticatedApi(session?.accessToken)

      if (repeatWeekly) {
        if (!untilDate) throw new Error('Missing until_date')
        return recurrencesApi.create({
          room_id: room.id,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          until_date: untilDate,
        }, api)
      }

      const result = await bookingsApi.create({
        room_id: room.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
      }, api)
      // Without a Checkout URL the booking is stranded at "Pendente" with no way
      // to pay for it — surface that instead of closing on a dead end.
      if (!result.checkout_url) throw new Error('Booking created without a checkout_url')
      return result
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      if ('checkout_url' in result) {
        // Payment confirms the booking (the Stripe webhook flips it to
        // `confirmed`), so the flow continues at Checkout, not back on the page.
        window.location.assign(result.checkout_url)
        return
      }
      // Series bookings aren't wired to Checkout yet (Epic 2 follow-up) — they
      // land `pending`, so there's nowhere to redirect. Just close the modal.
      onClose()
    },
  })

  // A fresh slot selection should not inherit the previous one's series
  // settings or a stale error from a dismissed attempt.
  useEffect(() => {
    setRepeatWeekly(false)
    setUntilDate('')
    mutation.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  if (!room || !start || !end) return null

  const isUnauthenticated = status === 'unauthenticated'
  const conflicts = conflictsOf(mutation.error)
  const untilBeforeStart = repeatWeekly && !!untilDate && occurrences.length === 0
  const canSubmit = !repeatWeekly || (!!untilDate && occurrences.length > 0)

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
              <span className="font-semibold text-foreground">{repeatWeekly ? 'Total por semana' : 'Total'}</span>
              <span className="font-bold text-primary text-lg">{formatCurrency(total)}</span>
            </div>
            {repeatWeekly && occurrences.length > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total da série ({occurrences.length} reservas)</span>
                <span className="font-medium text-foreground">{formatCurrency(total * occurrences.length)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="repeat-weekly"
                type="checkbox"
                className="h-4 w-4 rounded border-[#E5E7EB] text-primary focus:ring-2 focus:ring-[#3D7A5E]"
                checked={repeatWeekly}
                onChange={(e) => setRepeatWeekly(e.target.checked)}
              />
              <Label htmlFor="repeat-weekly">Repetir semanalmente</Label>
            </div>

            {repeatWeekly && (
              <div className="space-y-3 pl-6">
                <div className="space-y-1">
                  <Label htmlFor="until-date">Repetir até</Label>
                  <Input
                    id="until-date"
                    type="date"
                    min={format(start, 'yyyy-MM-dd')}
                    value={untilDate}
                    onChange={(e) => setUntilDate(e.target.value)}
                  />
                </div>

                {untilBeforeStart && (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    Escolhe uma data final igual ou posterior à data de início.
                  </p>
                )}

                {occurrences.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Datas a criar ({occurrences.length})
                    </p>
                    <ul className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border text-sm">
                      {occurrences.map((occ) => (
                        <li key={occ.toISOString()} className="px-3 py-1.5 text-foreground">
                          {format(occ, "EEEE, d 'de' MMMM 'de' yyyy", { locale: pt })}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
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
            conflicts ? (
              <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 space-y-1">
                <p>Estas datas da série já estão reservadas:</p>
                <ul className="list-disc list-inside">
                  {conflicts.map((c) => (
                    <li key={c}>{format(new Date(c), "d 'de' MMMM 'de' yyyy, HH:mm", { locale: pt })}</li>
                  ))}
                </ul>
                <p>Escolhe outras datas ou horário para a série.</p>
              </div>
            ) : (
              <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {errorMessage(mutation.error)}
              </p>
            )
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancelar</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || isUnauthenticated || !canSubmit}
          >
            {mutation.isPending ? 'A confirmar...' : repeatWeekly ? 'Confirmar Série' : 'Confirmar Reserva'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
