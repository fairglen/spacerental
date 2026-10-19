'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useHelp } from '@/components/help/HelpProvider'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, isPast } from 'date-fns'
import { Calendar, Clock, Building2, KeyRound, Package } from 'lucide-react'
import type { Booking } from '@/types'
import { bookingsApi, packagesApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useLocale, useT } from '@/lib/i18n'
import { formatBookingCost, formatHours, statusLabels, STATUS_COLORS, cancellationEligibility, CANCELLATION_WINDOW_HOURS, isUnpaidHold, dateFnsLocale } from '@/lib/utils'
import { cancellationErrorMessage, bookingErrorMessage } from '@/lib/httpError'
import { creditExpiry, creditHoursFor, purchaseLabel } from '@/lib/cancellationCredit'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { PaymentNotice, paymentOutcomeOf, type PaymentOutcome } from '@/components/booking/PaymentNotice'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'

export default function DashboardPage() {
  const { data: session } = useSession()
  const api = useApi()
  const queryClient = useQueryClient()
  const t = useT()
  const [locale] = useLocale()
  const dateLocale = dateFnsLocale(locale)
  const labels = statusLabels(locale)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const HISTORY_PREVIEW = 5
  const [showAllHistory, setShowAllHistory] = useState(false)

  // Stripe/stub checkout returns to /dashboard?pagamento=sucesso|cancelado
  // (STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL). Show it once, then drop the
  // parameter so a reload does not repeat the notice (B25).
  const router = useRouter()
  const searchParams = useSearchParams()
  const [paymentNotice, setPaymentNotice] = useState<PaymentOutcome | null>(null)
  useEffect(() => {
    const outcome = paymentOutcomeOf(searchParams.get('pagamento'))
    if (outcome) {
      setPaymentNotice(outcome)
      router.replace('/dashboard', { scroll: false })
    }
  }, [searchParams, router])

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'me'],
    queryFn: () => bookingsApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  // Compact balance so packs are reachable from the page that promises
  // "reservas e pacotes" (B30). Only spendable (active) purchases count.
  const { data: purchases, isError: purchasesFailed } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(api),
    enabled: !!session?.accessToken,
  })
  // Spendable means what the backend's redemption rule means: active,
  // unexpired and with hours left — `/packages/me` still lists the others.
  const activePacks = (purchases ?? []).filter(
    (p) => p.status === 'active' && new Date(p.expires_at).getTime() > Date.now() && p.hours_remaining > 0,
  )

  const cancelMutation = useMutation({
    mutationFn: (id: string) => bookingsApi.cancel(id, api),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
      setCancelId(null)
    },
    // The dialog stays open with the reason; the list is refreshed because
    // the rejection usually means the booking's state moved on (C07).
    onError: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  })
  const closeCancelDialog = () => {
    setCancelId(null)
    cancelMutation.reset()
  }

  const { openHelp } = useHelp()
  const cancelling = (bookings ?? []).find((b) => b.id === cancelId) ?? null
  // Money went out for it (hourly/mixed, past the unpaid hold): the one case
  // where "what about what I paid?" is a real question — for a person (C18).
  const paidMoney = !!cancelling && cancelling.payment_method !== 'package' && !isUnpaidHold(cancelling)
  // K01: what those euros become — hours in the bank, computed the backend's way.
  const creditHours = cancelling ? creditHoursFor(cancelling) : null

  // "Pagar agora" / "Tentar pagar de novo" (C03): resume or retry the hold's
  // Checkout on the same booking row, then leave for the payment page.
  const payMutation = useMutation({
    mutationFn: (id: string) => bookingsApi.checkout(id, api),
    onSuccess: ({ checkout_url }) => {
      if (checkout_url) window.location.assign(checkout_url)
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  })

  const upcoming = (bookings ?? []).filter((b) => !isPast(parseISO(b.end_time)) && b.status !== 'cancelled')
  const past = (bookings ?? []).filter((b) => isPast(parseISO(b.end_time)) || b.status === 'cancelled')

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-foreground">{t('dashboard.greeting', { name: session?.user?.name ?? t('dashboard.greeting_fallback_name') })}</h1>
            <p className="text-muted-foreground mt-1">{t('dashboard.subtitle')}</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
          {paymentNotice && <PaymentNotice outcome={paymentNotice} onClose={() => setPaymentNotice(null)} />}
          <section aria-label={t('dashboard.packs_title')} className="mb-8 rounded-xl border border-border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" /> {t('dashboard.packs_title')}
              </h2>
              <Link href="/dashboard/packages" className="text-sm font-medium text-primary hover:underline">
                {activePacks.length > 0 ? t('dashboard.packs_link_buy') : t('dashboard.packs_link_view')}
              </Link>
            </div>
            {purchasesFailed ? (
              <p className="mt-2 text-sm text-red-700">{t('dashboard.packs_error')}</p>
            ) : purchases === undefined ? (
              <Skeleton className="mt-3 h-5 w-48" />
            ) : activePacks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{t('dashboard.packs_empty')}</p>
            ) : (
              <ul className="mt-2 divide-y divide-border text-sm">
                {activePacks.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="font-medium text-foreground">{purchaseLabel(p, locale)}</span>
                    <span className="text-muted-foreground">
                      <span className="font-semibold text-primary">{formatHours(p.hours_remaining)}</span> {t('dashboard.pack_remaining')} ·{' '}
                      {t('dashboard.pack_expires', { date: format(parseISO(p.expires_at), 'd MMM yyyy', { locale: dateLocale }) })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <h2 className="text-lg font-semibold text-foreground mb-4">{t('dashboard.upcoming_title')}</h2>
          {payMutation.isError && (
            <p role="alert" className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {bookingErrorMessage(payMutation.error, 'hourly')}
            </p>
          )}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : upcoming.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Calendar className="h-10 w-10 mx-auto mb-3 text-primary-light" />
                <p>{t('dashboard.upcoming_empty')}</p>
                <Button className="mt-4" asChild><a href="/spaces">{t('packs.use_hours_cta')}</a></Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {upcoming.map((b) => (
                <Card key={b.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">{b.room?.name ?? t('dashboard.room_fallback')}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: dateLocale })} – {format(parseISO(b.end_time), 'HH:mm')}
                        </p>
                        {isUnpaidHold(b) && b.hold_expires_at && (
                          <p className="text-xs text-amber-800 mt-1">
                            {t('dashboard.hold_until', { time: format(parseISO(b.hold_expires_at), 'HH:mm', { locale: dateLocale }) })}
                          </p>
                        )}
                        {b.status === 'expired' && (
                          <p className="text-xs text-muted-foreground mt-1">{t('dashboard.expired_note')}</p>
                        )}
                        {b.status === 'paid_unfulfilled' && (
                          <p className="text-xs text-orange-800 mt-1">{t('dashboard.paid_unfulfilled_note')}</p>
                        )}
                        {b.status === 'confirmed' && (
                          b.access_code ? (
                            <p className="text-xs text-foreground flex items-center gap-1 mt-1">
                              <KeyRound className="h-3 w-3 text-primary" />
                              {t('dashboard.access_code')} <span className="font-mono font-semibold tracking-wider">{b.access_code}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <KeyRound className="h-3 w-3" />
                              {t('dashboard.access_code_pending')}
                            </p>
                          )
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-primary">{formatBookingCost(b, locale)}</span>
                      <Badge className={STATUS_COLORS[b.status]}>
                        {isUnpaidHold(b) ? t('status.awaiting_payment') : labels[b.status]}
                      </Badge>
                      {(isUnpaidHold(b) || b.status === 'expired') && (
                        <Button
                          size="sm"
                          onClick={() => payMutation.mutate(b.id)}
                          disabled={payMutation.isPending}
                        >
                          {b.status === 'expired' ? t('dashboard.pay_retry') : t('dashboard.pay_now')}
                        </Button>
                      )}
                      {(() => {
                        const eligibility = cancellationEligibility(b, new Date(), locale)
                        return (
                          <div className="flex flex-col items-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setCancelId(b.id)}
                              disabled={!eligibility.eligible}
                            >
                              {t('dashboard.cancel')}
                            </Button>
                            {!eligibility.eligible && eligibility.reason && (
                              <span className="text-[11px] text-muted-foreground text-right max-w-44">{eligibility.reason}</span>
                            )}
                            {/* Inside the 24h window the rule still holds; a person can make an exception (C18). */}
                            {!eligibility.eligible && b.status === 'confirmed' && !isPast(parseISO(b.start_time)) && (
                              <button
                                type="button"
                                onClick={() => openHelp({ category: 'booking', bookingId: b.id })}
                                className="text-[11px] font-medium text-primary underline underline-offset-2 text-right"
                              >
                                {t('dashboard.cancel_help_link')}
                              </button>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-foreground mt-8 mb-4">{t('dashboard.history_title')}</h2>
              <div className="space-y-2">
                {(showAllHistory ? past : past.slice(0, HISTORY_PREVIEW)).map((b) => (
                  <Card key={b.id} className="opacity-70">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">{b.room?.name ?? t('dashboard.room_fallback')}</p>
                        <p className="text-xs text-muted-foreground">{format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: dateLocale })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">{formatBookingCost(b, locale)}</span>
                        <Badge className={STATUS_COLORS[b.status]} variant="secondary">{labels[b.status]}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              {!showAllHistory && past.length > HISTORY_PREVIEW && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowAllHistory(true)}>
                  {t('dashboard.show_more', { count: past.length - HISTORY_PREVIEW })}
                </Button>
              )}
            </>
          )}
        </div>
      </main>
      <Footer />

      <Dialog open={!!cancelId} onOpenChange={closeCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.cancel_dialog_title')}</DialogTitle>
            <DialogDescription>
              {t('dashboard.cancel_dialog_description', { hours: CANCELLATION_WINDOW_HOURS })}
            </DialogDescription>
          </DialogHeader>
          {creditHours !== null && (
            // The paid hours are not refunded: they stay spendable in the bank (K01).
            <p className="text-sm text-foreground rounded-lg bg-accent px-3 py-2">
              {t('dashboard.cancel_credit_line', {
                hours: formatHours(creditHours),
                date: format(creditExpiry(), 'd MMM yyyy', { locale: dateLocale }),
              })}
            </p>
          )}
          {cancelMutation.isError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {cancellationErrorMessage(cancelMutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeCancelDialog} disabled={cancelMutation.isPending}>
              {t('dashboard.cancel_keep')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelId && cancelMutation.mutate(cancelId)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? t('dashboard.cancelling') : t('dashboard.cancel_confirm')}
            </Button>
          </DialogFooter>
          {paidMoney && (
            // Money never comes back by itself; a person can find another way.
            <p className="text-xs text-muted-foreground">
              {t('dashboard.other_solution')}{' '}
              <button
                type="button"
                onClick={() => { closeCancelDialog(); openHelp({ category: 'payment', bookingId: cancelling.id }) }}
                className="font-medium text-primary underline underline-offset-2"
              >
                {t('contactNote.cta')}
              </button>
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
