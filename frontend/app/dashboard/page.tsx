'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, isPast } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Calendar, Clock, Building2, KeyRound, X } from 'lucide-react'
import { bookingsApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency, STATUS_LABELS, STATUS_COLORS, cancellationEligibility, CANCELLATION_WINDOW_HOURS } from '@/lib/utils'
import { cancellationErrorMessage } from '@/lib/httpError'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
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
  const [cancelId, setCancelId] = useState<string | null>(null)

  // Stripe/stub checkout returns to /dashboard?pagamento=sucesso|cancelado
  // (STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL). Show it once, then drop the
  // parameter so a reload does not repeat the notice (B25).
  const router = useRouter()
  const searchParams = useSearchParams()
  const [paymentNotice, setPaymentNotice] = useState<'sucesso' | 'cancelado' | null>(null)
  useEffect(() => {
    const outcome = searchParams.get('pagamento')
    if (outcome === 'sucesso' || outcome === 'cancelado') {
      setPaymentNotice(outcome)
      router.replace('/dashboard', { scroll: false })
    }
  }, [searchParams, router])

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'me'],
    queryFn: () => bookingsApi.listMine(api),
    enabled: !!session?.accessToken,
  })

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

  const upcoming = (bookings ?? []).filter((b) => !isPast(parseISO(b.end_time)) && b.status !== 'cancelled')
  const past = (bookings ?? []).filter((b) => isPast(parseISO(b.end_time)) || b.status === 'cancelled')

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-foreground">Olá, {session?.user?.name ?? 'Bem-vindo'} 👋</h1>
            <p className="text-muted-foreground mt-1">As tuas reservas e pacotes num só lugar.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
          {paymentNotice && (
            <div
              role="status"
              className={
                paymentNotice === 'sucesso'
                  ? 'mb-6 flex items-start justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900'
                  : 'mb-6 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900'
              }
            >
              <p>
                {paymentNotice === 'sucesso' ? (
                  <>
                    <span className="font-semibold">Pagamento concluído.</span> A tua reserva está confirmada.
                    Se compraste um pack, as horas já estão disponíveis em{' '}
                    <Link href="/dashboard/packages" className="font-medium underline">Os meus packs</Link>.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Pagamento não concluído.</span> Não foi cobrado nada.
                    A reserva fica a aguardar pagamento; podes pagá-la abaixo ou cancelá-la.
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setPaymentNotice(null)}
                aria-label="Fechar aviso"
                className="shrink-0 rounded p-1 hover:bg-black/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <h2 className="text-lg font-semibold text-foreground mb-4">Próximas Reservas</h2>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
            </div>
          ) : upcoming.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Calendar className="h-10 w-10 mx-auto mb-3 text-primary-light" />
                <p>Não tens reservas futuras.</p>
                <Button className="mt-4" asChild><a href="/spaces">Reservar uma sala</a></Button>
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
                        <p className="font-medium text-foreground text-sm">{b.room?.name ?? 'Sala'}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: pt })} – {format(parseISO(b.end_time), 'HH:mm')}
                        </p>
                        {b.status === 'confirmed' && (
                          b.access_code ? (
                            <p className="text-xs text-foreground flex items-center gap-1 mt-1">
                              <KeyRound className="h-3 w-3 text-primary" />
                              Código de acesso: <span className="font-mono font-semibold tracking-wider">{b.access_code}</span>
                            </p>
                          ) : (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <KeyRound className="h-3 w-3" />
                              Código de acesso ainda não disponível. Contacta o espaço se não o tiveres antes da reserva.
                            </p>
                          )
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-primary">{formatCurrency(b.total_amount)}</span>
                      <Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                      {(() => {
                        const eligibility = cancellationEligibility(b)
                        return (
                          <div className="flex flex-col items-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:text-red-700"
                              onClick={() => setCancelId(b.id)}
                              disabled={!eligibility.eligible}
                            >
                              Cancelar
                            </Button>
                            {!eligibility.eligible && eligibility.reason && (
                              <span className="text-[11px] text-muted-foreground text-right max-w-[11rem]">{eligibility.reason}</span>
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
              <h2 className="text-lg font-semibold text-foreground mt-8 mb-4">Histórico</h2>
              <div className="space-y-2">
                {past.slice(0, 5).map((b) => (
                  <Card key={b.id} className="opacity-70">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">{b.room?.name ?? 'Sala'}</p>
                        <p className="text-xs text-muted-foreground">{format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: pt })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-muted-foreground">{formatCurrency(b.total_amount)}</span>
                        <Badge className={STATUS_COLORS[b.status]} variant="secondary">{STATUS_LABELS[b.status]}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
      <Footer />

      <Dialog open={!!cancelId} onOpenChange={closeCancelDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar reserva</DialogTitle>
            <DialogDescription>
              Tens a certeza que queres cancelar esta reserva? Esta ação não pode ser desfeita.
              Os cancelamentos são aceites até {CANCELLATION_WINDOW_HOURS} horas antes do início; as horas
              pagas com um pack voltam ao teu saldo.
            </DialogDescription>
          </DialogHeader>
          {cancelMutation.isError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {cancellationErrorMessage(cancelMutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeCancelDialog} disabled={cancelMutation.isPending}>
              Manter reserva
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelId && cancelMutation.mutate(cancelId)}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? 'A cancelar...' : 'Sim, cancelar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
