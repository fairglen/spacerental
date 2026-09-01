'use client'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { PackageBuyButton } from '@/components/packages/PackageBuyButton'
import { spacesApi, packagesApi } from '@/lib/api'

type PlanCopy = {
  name: string
  price: string
  unit: string
  desc: string
  features: string[]
  highlighted: boolean
  badge?: string
}

const hourlyPlan: PlanCopy = {
  name: 'Hora a Hora',
  price: '€11',
  unit: '/ hora',
  desc: 'Sem compromisso. Paga apenas o que usas.',
  features: ['Reserva instantânea', 'Cancelamento gratuito 24h', 'Sem mensalidade'],
  highlighted: false,
}

// Marketing copy per seeded package (backend/app/seed.py), keyed by `hours` so
// it can be paired with the real Package the CTA needs to purchase.
const packageCopyByHours: Record<number, PlanCopy> = {
  10: {
    name: 'Pack 10 Horas',
    price: '€100',
    unit: '10 horas',
    desc: 'Poupa €10. Usa quando quiseres durante 1 ano.',
    features: ['10h pré-pagas', 'Válido 12 meses', 'Poupança de €10', 'Reserva prioritária'],
    highlighted: true,
    badge: 'Mais Popular',
  },
  20: {
    name: 'Pack 20 Horas',
    price: '€190',
    unit: '20 horas',
    desc: 'Poupa €30. Para quem usa regularmente.',
    features: ['20h pré-pagas', 'Válido 12 meses', 'Poupança de €30', 'Reserva prioritária'],
    highlighted: false,
  },
}

function PlanCard({ plan, children }: { plan: PlanCopy; children: React.ReactNode }) {
  return (
    <Card className={plan.highlighted ? 'border-primary border-2 shadow-lg relative' : 'relative'}>
      {plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground px-3 py-1">{plan.badge}</Badge>
        </div>
      )}
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-lg">{plan.name}</CardTitle>
        <div className="mt-2">
          <span className="text-4xl font-bold text-foreground">{plan.price}</span>
          <span className="text-sm text-muted-foreground ml-1">{plan.unit}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{plan.desc}</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 mb-6">
          {plan.features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Check className="h-4 w-4 text-primary flex-shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        {children}
      </CardContent>
    </Card>
  )
}

export function Pricing() {
  // Packages are org-scoped (§4) and this is a public landing page with no
  // org context of its own, so resolve the one seeded org through the public
  // spaces list — consistent with the single-main-space scoping decision.
  const { data: orgId } = useQuery({
    queryKey: ['pricing', 'org'],
    queryFn: async () => (await spacesApi.list())[0]?.org_id ?? null,
    staleTime: 5 * 60 * 1000,
  })

  const { data: packages, isLoading: loadingPackages } = useQuery({
    queryKey: ['pricing', 'packages', orgId],
    queryFn: () => packagesApi.list(orgId as string),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })

  const packageByHours = new Map((packages ?? []).map((p) => [p.hours, p]))

  return (
    <section id="precos" className="py-20 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">Preços Transparentes</h2>
          <p className="text-muted-foreground">Sem surpresas. Sem contratos. Sem taxas escondidas.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <PlanCard plan={hourlyPlan}>
            <Button asChild variant="outline" className="w-full">
              <Link href="/spaces">Reservar Agora</Link>
            </Button>
          </PlanCard>

          {Object.entries(packageCopyByHours).map(([hoursKey, copy]) => {
            const pkg = packageByHours.get(Number(hoursKey))
            return (
              <PlanCard key={hoursKey} plan={copy}>
                {(loadingPackages || orgId === undefined) ? (
                  <Skeleton className="h-10 w-full rounded-md" />
                ) : pkg ? (
                  <PackageBuyButton pkg={pkg} variant={copy.highlighted ? 'default' : 'outline'} />
                ) : (
                  <Button variant="outline" className="w-full" disabled>Indisponível</Button>
                )}
              </PlanCard>
            )
          })}
        </div>
      </div>
    </section>
  )
}
