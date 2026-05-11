'use client'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO, isPast } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Calendar, Clock, Building2 } from 'lucide-react'
import { bookingsApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency, STATUS_LABELS, STATUS_COLORS } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardPage() {
  const { data: session } = useSession()
  const queryClient = useQueryClient()
  const api = createAuthenticatedApi(session?.accessToken)

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['bookings', 'me'],
    queryFn: () => bookingsApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => bookingsApi.cancel(id, api),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  })

  const upcoming = (bookings ?? []).filter((b) => !isPast(parseISO(b.end_time)) && b.status !== 'cancelled')
  const past = (bookings ?? []).filter((b) => isPast(parseISO(b.end_time)) || b.status === 'cancelled')

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F9FAFB]">
        <div className="bg-white border-b border-[#E5E7EB] py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-[#1A1A2E]">Olá, {session?.user?.name ?? 'Bem-vindo'} 👋</h1>
            <p className="text-[#6B7280] mt-1">As tuas reservas e pacotes num só lugar.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
          <h2 className="text-lg font-semibold text-[#1A1A2E] mb-4">Próximas Reservas</h2>
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>
          ) : upcoming.length === 0 ? (
            <Card><CardContent className="p-8 text-center text-[#6B7280]">
              <Calendar className="h-10 w-10 mx-auto mb-3 text-[#A8D5BA]" />
              <p>Não tens reservas futuras.</p>
              <Button className="mt-4" asChild><a href="/spaces">Reservar uma sala</a></Button>
            </CardContent></Card>
          ) : (
            <div className="space-y-3">
              {upcoming.map((b) => (
                <Card key={b.id}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-[#E8F4F0] flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-[#3D7A5E]" />
                      </div>
                      <div>
                        <p className="font-medium text-[#1A1A2E] text-sm">{b.room?.name ?? 'Sala'}</p>
                        <p className="text-xs text-[#6B7280] flex items-center gap-1 mt-0.5">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: pt })} – {format(parseISO(b.end_time), 'HH:mm')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-[#3D7A5E]">{formatCurrency(b.total_amount)}</span>
                      <Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700"
                        onClick={() => cancelMutation.mutate(b.id)}>Cancelar</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {past.length > 0 && (
            <>
              <h2 className="text-lg font-semibold text-[#1A1A2E] mt-8 mb-4">Histórico</h2>
              <div className="space-y-2">
                {past.slice(0, 5).map((b) => (
                  <Card key={b.id} className="opacity-70">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[#1A1A2E]">{b.room?.name ?? 'Sala'}</p>
                        <p className="text-xs text-[#6B7280]">{format(parseISO(b.start_time), "d MMM yyyy, HH:mm", { locale: pt })}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#6B7280]">{formatCurrency(b.total_amount)}</span>
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
    </>
  )
}
