'use client'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { packagesApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MyPackagesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const { data: purchases, isLoading } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-foreground">Os meus Pacotes</h1>
            <p className="text-muted-foreground mt-1 text-sm">Horas pré-pagas disponíveis.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : (purchases ?? []).length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <p>Não tens pacotes de horas.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {(purchases ?? []).map((p) => (
                <Card key={p.id}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold text-foreground">{p.package?.name ?? 'Pacote'}</p>
                      <span className="text-sm text-muted-foreground">Expira: {format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}</span>
                    </div>
                    <div className="w-full bg-border rounded-full h-2 mb-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${(p.hours_remaining / p.hours_total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {Number(p.hours_remaining).toFixed(1)}h restantes de {p.hours_total}h
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
