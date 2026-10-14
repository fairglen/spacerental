'use client'
import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { packagesApi } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { detailOf } from '@/lib/httpError'
import { useLocale, useT } from '@/lib/i18n'
import { dateFnsLocale, formatCurrency, formatHours } from '@/lib/utils'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { PackageBuyButton } from '@/components/packages/PackageBuyButton'
import { UseHoursPrompt } from '@/components/packages/UseHoursPrompt'
import { purchaseLabel } from '@/lib/cancellationCredit'

export default function MyPackagesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { currentOrgId } = useOrg()
  const searchParams = useSearchParams()
  const t = useT()
  const [locale] = useLocale()
  const dateLocale = dateFnsLocale(locale)
  // Set when arriving from Pricing/sign-up with a package pre-selected (B12)
  // — highlights that card instead of leaving the visitor to hunt for it.
  const highlightId = searchParams.get('packageId')
  const highlightRef = useRef<HTMLDivElement | null>(null)

  // The purchases and the bank they form (H02), in one read — with the
  // purchases whose Checkout is still open (B68), shown apart below.
  const { data: mine, isLoading } = useQuery({
    queryKey: queryKeys.myPackages,
    queryFn: () => packagesApi.myPackages(api, { includePending: true }),
    enabled: !!session?.accessToken,
  })
  const purchases = (mine?.purchases ?? []).filter((p) => p.status === 'active')
  const pending = (mine?.purchases ?? []).filter((p) => p.status === 'pending')
  const balance = mine?.balance

  // "Cancelar" on a pending purchase: the row goes to `cancelled` and its
  // Checkout page stops accepting a payment.
  const cancel = useMutation({
    mutationFn: (purchaseId: string) => packagesApi.cancelPurchase(purchaseId, api),
    onSuccess: async () => {
      toast({ title: t('packs.cancel_purchase_done'), variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: queryKeys.myPackages })
    },
    onError: (err) => toast({ title: detailOf(err) ?? t('packs.cancel_purchase_error'), variant: 'error' }),
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
            <h1 className="text-2xl font-bold text-foreground">{t('packs.page_title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('packs.page_subtitle')}</p>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8 space-y-10">
          {/* H02: one balance across every pack; the API's number, not a client sum. */}
          {balance && (
            <section aria-labelledby="banco-de-horas">
              <Card className="border-primary/40 bg-accent">
                <CardContent className="p-5 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h2 id="banco-de-horas" className="text-sm font-medium text-muted-foreground">{t('packs.bank_title')}</h2>
                    <p className="text-2xl font-bold text-foreground">{t('packs.bank_available', { hours: formatHours(balance.hours_available) })}</p>
                  </div>
                  {balance.hours_expiring_next && (
                    <p className="text-sm text-muted-foreground">
                      {t('packs.bank_expiring', {
                        hours: formatHours(balance.hours_expiring_next.hours),
                        date: format(parseISO(balance.hours_expiring_next.expires_at), t('packs.bank_expiring_date_format'), { locale: dateLocale }),
                      })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </section>
          )}
          {/* B68: a Checkout left open is not a pack — resume it or let it go. */}
          {pending.length > 0 && (
            <section aria-labelledby="pagamento-pendente" data-testid="pending-purchases">
              <h2 id="pagamento-pendente" className="text-sm font-medium text-muted-foreground mb-3">{t('packs.pending_title')}</h2>
              <div className="space-y-3">
                {pending.map((p) => (
                  <Card key={p.id} className="border-dashed">
                    <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{purchaseLabel(p, locale)}</p>
                        <p className="text-xs text-muted-foreground">{t('packs.pending_note')}</p>
                      </div>
                      <div className="flex gap-2">
                        {p.checkout_url && (
                          <Button asChild size="sm">
                            <a href={p.checkout_url}>{t('packs.pending_resume')}</a>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate(p.id)}>
                          {t('packs.pending_cancel')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
          <section>
            {isLoading ? (
              <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
            ) : purchases.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground space-y-3">
                  <p>{t('packs.empty')}</p>
                  <UseHoursPrompt className="justify-center" />
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {purchases.map((p) => (
                  <Card key={p.id}>
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <p className="font-semibold text-foreground">{purchaseLabel(p, locale)}</p>
                        <span className="text-sm text-muted-foreground">
                          {t('packs.expires', { date: format(parseISO(p.expires_at), 'd MMM yyyy', { locale: dateLocale }) })}
                        </span>
                      </div>
                      <div className="w-full bg-border rounded-full h-2 mb-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all"
                          style={{ width: `${(p.hours_remaining / p.hours_total) * 100}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {t('packs.remaining_of', { remaining: formatHours(p.hours_remaining), total: formatHours(p.hours_total) })}
                      </p>
                      <UseHoursPrompt compact className="mt-3 text-muted-foreground" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-4">{t('packs.buy_more_title')}</h2>
            {!currentOrgId ? (
              <p className="text-sm text-muted-foreground">{t('packs.no_org')}</p>
            ) : isLoadingAvailable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
              </div>
            ) : (availablePackages ?? []).length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-muted-foreground">
                  <p>{t('packs.none_available')}</p>
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
                      <p className="text-sm text-muted-foreground">{t('packs.pack_meta', { hours: pkg.hours, days: pkg.validity_days })}</p>
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
