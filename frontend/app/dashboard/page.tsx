'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, isPast } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Calendar, Clock, Building2 } from 'lucide-react'
import { bookingsApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency, STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

export default function DashboardPage() {
  const { data: session } = useSession()
  const api = useApi()
  const queryClient = useQueryClient()
  const [cancelId, setCancelId] = useState<string | null>(null)

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'me'],
    queryFn: () => bookingsApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => bookingsApi.cancel(id, api),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      setCancelId(null)
    },
  })

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
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-primary">{formatCurrency(b.total_amount)}</span>
                      <Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => setCancelId(b.id)}
                      >
                        Cancelar
                      </Button>
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

      <Dialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar reserva</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Tens a certeza que queres cancelar esta reserva? Esta ação não pode ser desfeita.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelId(null)} disabled={cancelMutation.isPending}>
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
