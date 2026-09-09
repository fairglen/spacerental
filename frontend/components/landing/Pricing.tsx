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
import { t } from '@/lib/i18n'

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
  name: t('pricing.hourly_plan_name'),
  price: t('pricing.hourly_plan_price'),
  unit: t('pricing.hourly_plan_unit'),
  desc: t('pricing.hourly_plan_desc'),
  features: [
    t('pricing.hourly_plan_feature_1'),
    t('pricing.hourly_plan_feature_2'),
    t('pricing.hourly_plan_feature_3'),
  ],
  highlighted: false,
}

// Marketing copy per seeded package (backend/app/seed.py), keyed by `hours` so
// it can be paired with the real Package the CTA needs to purchase.
const packageCopyByHours: Record<number, PlanCopy> = {
  10: {
    name: t('pricing.pack_10_name'),
    price: t('pricing.pack_10_price'),
    unit: t('pricing.pack_10_unit'),
    desc: t('pricing.pack_10_desc'),
    features: [
      t('pricing.pack_10_feature_1'),
      t('pricing.pack_10_feature_2'),
      t('pricing.pack_10_feature_3'),
      t('pricing.pack_10_feature_4'),
    ],
    highlighted: true,
    badge: t('pricing.pack_10_badge'),
  },
  20: {
    name: t('pricing.pack_20_name'),
    price: t('pricing.pack_20_price'),
    unit: t('pricing.pack_20_unit'),
    desc: t('pricing.pack_20_desc'),
    features: [
      t('pricing.pack_20_feature_1'),
      t('pricing.pack_20_feature_2'),
      t('pricing.pack_20_feature_3'),
      t('pricing.pack_20_feature_4'),
    ],
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
          <h2 className="text-3xl font-bold text-foreground mb-4">{t('pricing.section_title')}</h2>
          <p className="text-muted-foreground">{t('pricing.section_description')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <PlanCard plan={hourlyPlan}>
            <Button asChild variant="outline" className="w-full">
              <Link href="/spaces">{t('pricing.hourly_plan_cta')}</Link>
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
                  <Button variant="outline" className="w-full" disabled>{t('pricing.unavailable_cta')}</Button>
                )}
              </PlanCard>
            )
          })}
        </div>
      </div>
    </section>
  )
}
