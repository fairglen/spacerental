'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { pt } from 'date-fns/locale'
import { bookingsApi, packagesApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { statusOf } from '@/lib/httpError'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import type { Room, UserPackagePurchase } from '@/types'

interface BookingModalProps {
  room: Room | null
  start: Date | null
  end: Date | null
  onClose: () => void
}

type PaymentMethod = 'hourly' | 'package'

/** Hours the backend would actually accept for a booking of `duration` hours.
 *
 * Mirrors `package_hours.redeem_hours`: same org, active, unexpired, and enough
 * left to cover the whole block. Showing the option when the backend would
 * reject it just moves the failure to after the click. */
function spendablePurchases(
  purchases: UserPackagePurchase[],
  orgId: string,
  duration: number,
): UserPackagePurchase[] {
  const now = Date.now()
  return purchases.filter(
    p =>
      p.org_id === orgId &&
      p.status === 'active' &&
      new Date(p.expires_at).getTime() > now &&
      p.hours_remaining >= duration,
  )
}

function errorMessage(error: unknown, method: PaymentMethod): string {
  const status = statusOf(error)
  if (status === 409) {
    // The package path also answers 409 — for hours, not for the slot.
    return method === 'package'
      ? 'O teu pack já não tem horas suficientes para esta reserva.'
      : 'Este horário já está reservado. Escolhe outro intervalo no calendário.'
  }
  return 'Erro ao criar reserva. Tenta novamente.'
}

export function BookingModal({ room, start, end, onClose }: BookingModalProps) {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()
  // null until the user picks — the default depends on data that arrives later.
  const [method, setMethod] = useState<PaymentMethod | null>(null)

  const duration = start && end ? (end.getTime() - start.getTime()) / (1000 * 60 * 60) : 0
  const total = room ? duration * room.hourly_rate : 0

  const { data: purchases = [] } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(createAuthenticatedApi(session?.accessToken)),
    enabled: status === 'authenticated',
  })

  const usable = room ? spendablePurchases(purchases, room.org_id, duration) : []
  const canPayWithPackage = usable.length > 0
  // Default to spending hours the customer has already paid for — charging them
  // again while a valid pack sits unused is the wrong way round. Falls back to
  // hourly when there is no usable pack, which also covers the case where the
  // user picks "package" and then drags out a longer block their hours no
  // longer cover.
  const effectiveMethod: PaymentMethod = canPayWithPackage ? (method ?? 'package') : 'hourly'
  const hoursLeft = usable.reduce((max, p) => Math.max(max, p.hours_remaining), 0)

  const mutation = useMutation({
    mutationFn: async () => {
      if (!room || !start || !end) throw new Error('Missing data')
      const api = createAuthenticatedApi(session?.accessToken)
      const { booking, checkout_url } = await bookingsApi.create({
        room_id: room.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        payment_method: effectiveMethod,
      }, api)
      // Prepaid hours settle the booking outright, so `package` is the one path
      // that legitimately has no URL. On the hourly path a missing URL means the
      // booking is stranded at "Pendente" with no way to pay for it — surface
      // that instead of closing on a dead end.
      if (effectiveMethod === 'hourly' && !checkout_url) {
        throw new Error('Booking created without a checkout_url')
      }
      return { booking, checkout_url }
    },
    onSuccess: ({ checkout_url }) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
      if (!checkout_url) {
        // Already confirmed and paid from the pack — there is nothing to send
        // the user to, so the flow ends here.
        onClose()
        return
      }
      // Payment confirms the booking (the Stripe webhook flips it to
      // `confirmed`), so the flow continues at Checkout, not back on the page.
      window.location.assign(checkout_url)
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
              <span className="font-bold text-primary text-lg">
                {effectiveMethod === 'package' ? `${duration}h do teu pack` : formatCurrency(total)}
              </span>
            </div>
          </div>
          {canPayWithPackage && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground mb-1">Pagamento</legend>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="payment_method"
                  value="package"
                  checked={effectiveMethod === 'package'}
                  onChange={() => setMethod('package')}
                  disabled={mutation.isPending}
                />
                <span>Usar horas do pack ({hoursLeft}h disponíveis)</span>
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="payment_method"
                  value="hourly"
                  checked={effectiveMethod === 'hourly'}
                  onChange={() => setMethod('hourly')}
                  disabled={mutation.isPending}
                />
                <span>Pagar {formatCurrency(total)} agora</span>
              </label>
            </fieldset>
          )}
          {isUnauthenticated && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Precisas de estar autenticado para reservar.{' '}
              <Link href="/sign-in" className="font-medium underline" onClick={onClose}>
                Entrar na conta
              </Link>
            </p>
          )}
          {mutation.isError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {errorMessage(mutation.error, effectiveMethod)}
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
