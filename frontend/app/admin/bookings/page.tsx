'use client'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Check, X } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency, STATUS_COLORS, STATUS_LABELS } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function AdminBookingsPage() {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['admin', 'bookings', 'all'],
    queryFn: () => adminApi.getBookings({}, api),
    enabled: !!session?.accessToken,
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminApi.updateBooking(id, status, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'bookings'] }),
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-2">Todas as Reservas</h1>
      <p className="text-muted-foreground text-sm mb-8">Gere e acompanha todas as reservas.</p>
      {isLoading ? <Skeleton className="h-96 rounded-xl" /> : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background border-b border-border">
                  <tr>
                    {['Data/Hora', 'Sala', 'Utilizador', 'Duração', 'Valor', 'Estado', 'Ações'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(bookings ?? []).map((b) => (
                    <tr key={b.id} className="hover:bg-background">
                      <td className="px-4 py-3 text-foreground">{format(parseISO(b.start_time), "d MMM, HH:mm", { locale: pt })}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.room?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.user?.email ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.duration_hours}h</td>
                      <td className="px-4 py-3 font-medium text-foreground">{formatCurrency(b.total_amount)}</td>
                      <td className="px-4 py-3"><Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge></td>
                      <td className="px-4 py-3">
                        {b.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-600"
                              onClick={() => updateMutation.mutate({ id: b.id, status: 'confirmed' })}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500"
                              onClick={() => updateMutation.mutate({ id: b.id, status: 'cancelled' })}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
