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
import { formatCurrency } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { Package } from '@/types'

type PlanCopy = {
  name: string
  price: string
  unit: string
  desc: string
  features: string[]
  highlighted: boolean
  badge?: string
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

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="text-center pb-2">
        <Skeleton className="h-6 w-32 mx-auto" />
        <Skeleton className="h-10 w-24 mx-auto mt-3" />
        <Skeleton className="h-3 w-40 mx-auto mt-2" />
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-10 w-full mt-4" />
      </CardContent>
    </Card>
  )
}

/**
 * Every number on these cards comes from the API (C06): packages from
 * `GET /packages?org_id`, the hourly rate from the rooms of the first public
 * space. Only the wording is translated copy. Savings are computed from the
 * real rate and only shown when positive; "best value" is the lowest price
 * per hour rather than a marketing claim.
 */
export function Pricing() {
  const t = useT()

  // Packages are org-scoped (§4) and this is a public landing page with no
  // org context of its own, so resolve the one seeded org through the public
  // spaces list — consistent with the single-main-space scoping decision.
  const spaceQuery = useQuery({
    queryKey: ['pricing', 'space'],
    queryFn: async () => (await spacesApi.list())[0] ?? null,
    staleTime: 5 * 60 * 1000,
  })
  const orgId = spaceQuery.data?.org_id
  const spaceId = spaceQuery.data?.id

  const packagesQuery = useQuery({
    queryKey: ['pricing', 'packages', orgId],
    queryFn: () => packagesApi.list(orgId as string),
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  })

  const roomsQuery = useQuery({
    queryKey: ['pricing', 'rooms', spaceId],
    queryFn: async () => (await spacesApi.get(spaceId as string)).rooms,
    enabled: !!spaceId,
    staleTime: 5 * 60 * 1000,
  })

  const rates = (roomsQuery.data ?? []).filter((r) => r.is_active).map((r) => r.hourly_rate)
  const hourlyRate = rates.length > 0 ? Math.min(...rates) : null
  const ratesDiffer = rates.length > 1 && Math.max(...rates) !== hourlyRate

  const isLoading = spaceQuery.isLoading || packagesQuery.isLoading || (!!spaceId && roomsQuery.isLoading)
  const packagesFailed = spaceQuery.isError || packagesQuery.isError
  const packages: Package[] = [...(packagesQuery.data ?? [])].sort((a, b) => a.hours - b.hours)
  const bestValueId =
    packages.length > 1
      ? packages.reduce((best, p) => (p.price / p.hours < best.price / best.hours ? p : best)).id
      : null

  const hourlyPlan: PlanCopy = {
    name: t('pricing.hourly_plan_name'),
    price: hourlyRate === null ? t('pricing.hourly_plan_price_unknown') : formatCurrency(hourlyRate),
    unit: hourlyRate === null ? '' : t('pricing.hourly_plan_unit'),
    desc: t('pricing.hourly_plan_desc'),
    features: [
      t('pricing.hourly_plan_feature_1'),
      t('pricing.hourly_plan_feature_2'),
      t('pricing.hourly_plan_feature_3'),
    ],
    highlighted: false,
  }
  if (hourlyRate !== null && ratesDiffer) {
    hourlyPlan.price = `${t('pricing.hourly_plan_from')} ${hourlyPlan.price}`
  }

  const packagePlan = (pkg: Package): PlanCopy => {
    const savings = hourlyRate === null ? 0 : pkg.hours * hourlyRate - pkg.price
    const features = [
      t('pricing.pack_prepaid_feature', { hours: pkg.hours }),
      t('pricing.pack_validity', { days: pkg.validity_days }),
    ]
    if (savings > 0) features.push(t('pricing.pack_savings', { amount: formatCurrency(savings) }))
    return {
      name: pkg.name,
      price: formatCurrency(pkg.price),
      unit: t('pricing.pack_hours_unit', { hours: pkg.hours }),
      desc: t('pricing.pack_validity', { days: pkg.validity_days }),
      features,
      highlighted: pkg.id === bestValueId,
      badge: pkg.id === bestValueId ? t('pricing.best_value_badge') : undefined,
    }
  }

  return (
    <section id="precos" className="py-20 bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">{t('pricing.section_title')}</h2>
          <p className="text-muted-foreground">{t('pricing.section_description')}</p>
        </div>
        {isLoading && (
          <p role="status" className="sr-only">{t('pricing.loading')}</p>
        )}
        {packagesFailed && !isLoading && (
          <div role="alert" className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{t('pricing.error')}</span>
            <button
              type="button"
              className="font-medium underline"
              onClick={() => {
                if (spaceQuery.isError) spaceQuery.refetch()
                else packagesQuery.refetch()
              }}
            >
              {t('pricing.retry')}
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          {isLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            <>
              <PlanCard plan={hourlyPlan}>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/spaces">{t('pricing.hourly_plan_cta')}</Link>
                </Button>
              </PlanCard>
              {packages.map((pkg) => (
                <PlanCard key={pkg.id} plan={packagePlan(pkg)}>
                  <PackageBuyButton pkg={pkg} variant={pkg.id === bestValueId ? 'default' : 'outline'} />
                </PlanCard>
              ))}
              {!packagesFailed && packages.length === 0 && (
                <Card className="md:col-span-2">
                  <CardContent className="p-8 text-center text-muted-foreground">{t('pricing.no_packs')}</CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
