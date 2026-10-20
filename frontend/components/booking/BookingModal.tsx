'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { bookingsApi, recurrencesApi, createAuthenticatedApi } from '@/lib/api'
import { useLocale, useT } from '@/lib/i18n'
// `pt` alone: the parked series copy below is Portuguese-only (R02/R03/R99).
import { pt } from 'date-fns/locale'
import { formatCurrency, formatHours } from '@/lib/utils'
import { dateFnsLocale } from '@/lib/dates'
import { statusOf, conflictsOf } from '@/lib/httpError'
import { bookingErrorMessage } from '@/lib/bookingErrors'
import { signInHref } from '@/lib/navigation'
import { expandWeeklyOccurrences } from '@/lib/recurrence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { ContactNote } from '@/components/booking/ContactNote'
import { PackUpsell } from '@/components/booking/PackUpsell'
import { PaymentPlan } from '@/components/booking/PaymentPlan'
import { useBookingPlan } from '@/components/booking/useBookingPlan'
import type { Room } from '@/types'

interface BookingModalProps {
  room: Room | null
  start: Date | null
  end: Date | null
  onClose: () => void
  /**
   * K02: the customer is back from buying a pack for this slot (`pagamento=
   * sucesso`). The purchase may still be `pending` — Stripe activates it from
   * its webhook, which can land after the customer does — so the modal waits
   * for the bank to show it before the booking can be confirmed.
   */
  awaitingPurchase?: boolean
}

export function BookingModal({ room, start, end, onClose, awaitingPurchase = false }: BookingModalProps) {
  const recurrenceEnabled = process.env.NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED === 'true'
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const [untilDate, setUntilDate] = useState('')
  const t = useT()
  const [locale] = useLocale()
  const dateLocale = dateFnsLocale(locale)
  const {
    session, status, pathname, queryClient,
    duration, total, purchases,
    plan, canPayWithPackage, options, buying, usesPack, effectiveMethod,
    packages, purchase, hoursLeft, paidHours, amountDue, setChoice,
    waitingForPack, packUnconfirmed, checkBankAgain,
  } = useBookingPlan({ room, start, end, repeatWeekly, awaitingPurchase })


  const occurrences = useMemo(
    () => (repeatWeekly && start ? expandWeeklyOccurrences(start, untilDate) : []),
    [repeatWeekly, start, untilDate],
  )

  const mutation = useMutation({
    mutationFn: async () => {
      if (!room || !start || !end) throw new Error('Missing data')
      const api = createAuthenticatedApi(session?.accessToken)

      if (recurrenceEnabled && repeatWeekly) {
        if (!untilDate) throw new Error('Missing until_date')
        return recurrencesApi.create({
          room_id: room.id,
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          until_date: untilDate,
        }, api)
      }

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
      // Judged by what the server made of it, not by what was asked: a
      // `mixed` request may legitimately come back `package` (C13).
      if (booking.payment_method !== 'package' && !checkout_url) {
        throw new Error('Booking created without a checkout_url')
      }
      return { booking, checkout_url }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['availability'] })
      queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
      // A package booking has nothing left to pay and stays open on a success
      // state (B29); an hourly one continues to Checkout.
      if ('checkout_url' in result && result.checkout_url) {
        window.location.assign(result.checkout_url)
      }
    },
  })

  // A fresh slot selection should not inherit the previous one's series
  // settings or a stale error from a dismissed attempt (the payment choice
  // is useBookingPlan's to forget).
  useEffect(() => {
    setRepeatWeekly(false)
    setUntilDate('')
    mutation.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end])

  if (!room || !start || !end) return null

  const isUnauthenticated = status === 'unauthenticated'
  const conflicts = conflictsOf(mutation.error)
  const untilBeforeStart = repeatWeekly && !!untilDate && occurrences.length === 0
  const canSubmit = !repeatWeekly || (!!untilDate && occurrences.length > 0)

  // The weekly series is parked behind its flag (R02): its words stay inline,
  // Portuguese, and out of the catalogs (B65).
  if (mutation.isSuccess && 'recurrence' in mutation.data) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Série criada — aguarda confirmação</DialogTitle>
            <DialogDescription>
              Resumo do pedido de reserva semanal recorrente e do que falta para ficar confirmada.
            </DialogDescription>
          </DialogHeader>
          <p role="status">{mutation.data.bookings.length} reservas pendentes. O espaço precisa de confirmar a série e combinar o pagamento consigo. Ainda não tem acesso confirmado.</p>
          <DialogFooter><Button onClick={onClose}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  if (mutation.isSuccess && 'checkout_url' in mutation.data && !mutation.data.checkout_url) {
    const booked = mutation.data.booking
    // `purchases` is refetched after success, so this is the balance after
    // the debit once the refetch lands (spendablePurchases would hide packs
    // that can no longer cover another block of the same length).
    const remaining = purchases
      .filter((p) => p.org_id === room.org_id && p.status === 'active' && new Date(p.expires_at).getTime() > Date.now())
      .reduce((sum, p) => sum + p.hours_remaining, 0)
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('booking.confirmed_title')}</DialogTitle>
            <DialogDescription>
              {t('booking.confirmed_description')}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-accent p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('booking.room')}</span>
              <span className="font-medium text-foreground">{room.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('booking.date')}</span>
              <span className="font-medium text-foreground">{format(new Date(booked.start_time), t('booking.long_date_format'), { locale: dateLocale })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('booking.time')}</span>
              <span className="font-medium text-foreground">{format(new Date(booked.start_time), 'HH:mm')} – {format(new Date(booked.end_time), 'HH:mm')}</span>
            </div>
            <div className="flex justify-between border-t border-primary-light pt-2">
              <span className="text-muted-foreground">{t('booking.hours_used')}</span>
              <span className="font-semibold text-foreground">{t('booking.hours_used_value', { hours: formatHours(booked.duration_hours) })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('booking.hours_remaining')}</span>
              <span className="font-semibold text-primary">{formatHours(remaining)}</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" asChild>
              <Link href="/dashboard">{t('booking.view_my_bookings')}</Link>
            </Button>
            <Button onClick={onClose}>{t('booking.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={!!room && !!start} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('booking.confirm_booking')}</DialogTitle>
          <DialogDescription>
            {t('booking.confirm_description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <PaymentPlan room={room} start={start} end={end} duration={duration} total={total} plan={plan} usesPack={usesPack} paidHours={paidHours} amountDue={amountDue} repeatWeekly={repeatWeekly} occurrences={occurrences} />
          {recurrenceEnabled && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="repeat-weekly"
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-[#3D7A5E]"
                disabled={mutation.isPending}
                checked={repeatWeekly}
                onChange={(e) => setRepeatWeekly(e.target.checked)}
              />
              <Label htmlFor="repeat-weekly">Repetir semanalmente</Label>
            </div>

            {repeatWeekly && (
              <div className="space-y-3 pl-6">
                <p className="text-sm text-amber-700">Funcionalidade experimental: a série fica pendente para confirmação e pagamento combinados com o espaço. Os packs não são usados. A hora local pode mudar com o horário de verão.</p>
                <div className="space-y-1">
                  <Label htmlFor="until-date">Repetir até</Label>
                  <Input
                    id="until-date"
                    type="date"
                    disabled={mutation.isPending}
                    min={start.toISOString().slice(0, 10)}
                    max={new Date(start.getTime() + 103 * 7 * 86400000).toISOString().slice(0, 10)}
                    value={untilDate}
                    onChange={(e) => setUntilDate(e.target.value)}
                  />
                </div>

                {untilBeforeStart && (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    Escolha uma data final entre a primeira reserva e o limite de 104 semanas.
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
          )}
          {waitingForPack && (
            <p role="status" data-testid="pack-settling" className="text-sm text-muted-foreground">
              {t('booking.pack_settling')}
            </p>
          )}
          {packUnconfirmed && (
            <div role="alert" data-testid="pack-unconfirmed" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
              <p>{t('booking.pack_unconfirmed')}</p>
              <Button type="button" variant="outline" size="sm" onClick={checkBankAgain}>{t('booking.check_again')}</Button>
            </div>
          )}
          {!waitingForPack && options.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-foreground mb-1">{t('booking.payment_legend')}</legend>
              {options.map((option) => option === 'pack' ? (
                <label key={option} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="payment_method"
                    value="pack"
                    checked={usesPack}
                    onChange={() => setChoice('pack')}
                    disabled={mutation.isPending || purchase.isPending}
                  />
                  <span>
                    {canPayWithPackage
                      ? t('booking.use_pack_full', { hours: formatHours(hoursLeft) })
                      : t('booking.use_pack_partial')}
                  </span>
                </label>
              ) : option === 'hourly' ? (
                <label key={option} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="payment_method"
                    value="hourly"
                    checked={!usesPack && !buying}
                    onChange={() => setChoice('hourly')}
                    disabled={mutation.isPending || purchase.isPending}
                  />
                  <span>{plan.kind === 'none' || canPayWithPackage ? t('booking.pay_amount_now', { amount: formatCurrency(total) }) : t('booking.pay_all_now')}</span>
                </label>
              ) : (
                <PackUpsell key={option} packages={packages} buying={buying} onChoose={() => setChoice('buy')} purchase={purchase} disabled={mutation.isPending || purchase.isPending} isUnauthenticated={isUnauthenticated} />
              ))}
            </fieldset>
          )}
          {isUnauthenticated && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              {t('booking.sign_in_required')}{' '}
              <Link href={signInHref(pathname)} className="font-medium underline" onClick={onClose}>
                {t('booking.sign_in_link')}
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
                <p>Escolha outras datas ou horário para a série.</p>
              </div>
            ) : (
              <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                {bookingErrorMessage(mutation.error, effectiveMethod)}
                {statusOf(mutation.error) === 401 && (
                  <>
                    {' '}
                    <Link href={signInHref(pathname)} className="font-medium underline" onClick={onClose}>
                      {t('booking.sign_in_link')}
                    </Link>
                  </>
                )}
              </p>
            )
          )}
          <ContactNote roomName={room.name} variant="inline" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>{t('booking.cancel')}</Button>
          <Button
            onClick={() => mutation.mutate()}
            // While a pack purchase is in flight the booking must not be confirmed
            // too: the customer would leave with a pending purchase AND a hold.
            // Nor while the bank is still being polled for the pack just bought.
            disabled={mutation.isPending || purchase.isPending || isUnauthenticated || !canSubmit || buying || waitingForPack}
          >
            {mutation.isPending ? t('booking.confirming') : repeatWeekly ? 'Confirmar Série' : t('booking.confirm_booking')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
