'use client'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { BarChart3, Euro, Building2, Users, Plus } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency, STATUS_COLORS, STATUS_LABELS } from '@/lib/utils'
import { StatsCard } from '@/components/admin/StatsCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export default function AdminDashboard() {
  const { data: session } = useSession()
  const api = useApi()

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => adminApi.getDashboard(api),
    enabled: !!session?.accessToken,
  })
  const { data: bookings, isLoading: bookingsLoading } = useQuery({
    queryKey: ['admin', 'bookings'],
    queryFn: () => adminApi.getBookings({}, api),
    enabled: !!session?.accessToken,
  })

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Visão geral do espaço</p>
        </div>
        <Link href="/admin/spaces/new">
          <Button className="gap-2"><Plus className="h-4 w-4" /> Novo Espaço</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statsLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : <>
              <StatsCard title="Total de Reservas" value={stats?.total_bookings ?? 0} icon={BarChart3} />
              <StatsCard title="Receita Este Mês" value={formatCurrency(stats?.revenue_this_month ?? 0)} icon={Euro} />
              <StatsCard title="Espaços Ativos" value={stats?.active_spaces ?? 0} icon={Building2} />
              <StatsCard title="Utilizadores" value={stats?.registered_users ?? 0} icon={Users} />
            </>
        }
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Reservas Recentes</CardTitle>
          <Link href="/admin/bookings"><Button variant="ghost" size="sm">Ver Todas</Button></Link>
        </CardHeader>
        <CardContent>
          {bookingsLoading ? <Skeleton className="h-48 w-full" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left pb-3 font-medium">Data</th>
                    <th className="text-left pb-3 font-medium">Sala</th>
                    <th className="text-left pb-3 font-medium">Utilizador</th>
                    <th className="text-right pb-3 font-medium">Valor</th>
                    <th className="text-right pb-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(bookings ?? []).slice(0, 10).map((b) => (
                    <tr key={b.id}>
                      <td className="py-3 text-foreground">{format(parseISO(b.start_time), "d MMM, HH:mm", { locale: pt })}</td>
                      <td className="py-3 text-muted-foreground">{b.room?.name ?? '—'}</td>
                      <td className="py-3 text-muted-foreground">{b.user?.email ?? '—'}</td>
                      <td className="py-3 text-right font-medium text-foreground">{formatCurrency(b.total_amount)}</td>
                      <td className="py-3 text-right"><Badge className={STATUS_COLORS[b.status]}>{STATUS_LABELS[b.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
