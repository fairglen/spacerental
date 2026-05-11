'use client'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { packagesApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export default function MyPackagesPage() {
  const { data: session } = useSession()
  const api = createAuthenticatedApi(session?.accessToken)
  const { data: purchases, isLoading } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-[#F9FAFB]">
        <div className="bg-white border-b border-[#E5E7EB] py-8">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-2xl font-bold text-[#1A1A2E]">Os meus Pacotes</h1>
            <p className="text-[#6B7280] mt-1 text-sm">Horas pré-pagas disponíveis.</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
          {isLoading ? (
            <div className="space-y-3">{Array.from({length:2}).map((_,i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
          ) : (purchases ?? []).length === 0 ? (
            <Card><CardContent className="p-8 text-center text-[#6B7280]">
              <p>Não tens pacotes de horas.</p>
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {(purchases ?? []).map((p) => (
                <Card key={p.id}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-semibold text-[#1A1A2E]">{p.package?.name ?? 'Pacote'}</p>
                      <span className="text-sm text-[#6B7280]">Expira: {format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}</span>
                    </div>
                    <div className="w-full bg-[#E5E7EB] rounded-full h-2 mb-2">
                      <div
                        className="bg-[#3D7A5E] h-2 rounded-full transition-all"
                        style={{ width: `${(p.hours_remaining / p.hours_total) * 100}%` }}
                      />
                    </div>
                    <p className="text-xs text-[#6B7280]">
                      {Number(p.hours_remaining).toFixed(1)}h restantes de {p.hours_total}h
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
