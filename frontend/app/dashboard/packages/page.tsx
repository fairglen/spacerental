'use client'
import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { packagesApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { formatCurrency } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PackageBuyButton } from '@/components/packages/PackageBuyButton'

export default function MyPackagesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const { currentOrgId } = useOrg()
  const searchParams = useSearchParams()
  // Set when arriving from Pricing/sign-up with a package pre-selected (B12)
  // — highlights that card instead of leaving the visitor to hunt for it.
  const highlightId = searchParams.get('packageId')
  const highlightRef = useRef<HTMLDivElement | null>(null)

  const { data: purchases, isLoading } = useQuery({
    queryKey: ['packages', 'me'],
    queryFn: () => packagesApi.listMine(api),
    enabled: !!session?.accessToken,
  })

  const { data: availablePackages, isLoading: isLoadingAvailable } = useQuery({
    queryKey: ['packages', 'available', currentOrgId],
    queryFn: () => packagesApi.list(currentOrgId as string, api),
    enabled: !!currentOrgId,
  })

  useEffect(() => {
    if (highlightId && availablePackages?.some((p) => p.id === highlightId)) {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, availablePackages])

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
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 space-y-10">
          <section>
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
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">Comprar mais horas</h2>
            {!currentOrgId ? (
              <p className="text-sm text-muted-foreground">
                Ainda não pertences a nenhuma organização com pacotes disponíveis.
              </p>
            ) : isLoadingAvailable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
              </div>
            ) : (availablePackages ?? []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p>Não há pacotes disponíveis de momento.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {(availablePackages ?? []).map((pkg) => (
                  <Card
                    key={pkg.id}
                    ref={pkg.id === highlightId ? highlightRef : undefined}
                    className={pkg.id === highlightId ? 'border-primary border-2 ring-2 ring-primary/30' : undefined}
                  >
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-foreground">{pkg.name}</p>
                        <span className="text-lg font-bold text-primary">{formatCurrency(pkg.price)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{pkg.hours}h · válido {pkg.validity_days} dias</p>
                      <PackageBuyButton pkg={pkg} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
