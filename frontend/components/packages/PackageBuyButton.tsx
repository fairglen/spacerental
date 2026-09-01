'use client'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { packagesApi, createAuthenticatedApi } from '@/lib/api'
import { statusOf } from '@/lib/httpError'
import { Button } from '@/components/ui/button'
import type { Package } from '@/types'

interface PackageBuyButtonProps {
  pkg: Package
  label?: string
  variant?: 'default' | 'outline'
  className?: string
}

function errorMessage(error: unknown): string {
  return statusOf(error) === 403
    ? 'A tua conta não tem acesso a este pacote.'
    : 'Erro ao iniciar a compra. Tenta novamente.'
}

/**
 * Buys a package and follows the returned Checkout URL — the same
 * create-then-redirect pattern BookingModal uses for bookings (B4). Used both
 * on the landing page pricing table and on /dashboard/packages, so the
 * signed-in-vs-signed-out branching only lives in one place (B12).
 */
export function PackageBuyButton({ pkg, label = 'Comprar Pack', variant = 'default', className }: PackageBuyButtonProps) {
  const { data: session, status } = useSession()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const api = createAuthenticatedApi(session?.accessToken)
      const result = await packagesApi.purchase(pkg.id, pkg.org_id, api)
      // Without a Checkout URL the purchase is stranded `pending` with no way
      // to pay for it — surface that instead of redirecting to nowhere.
      if (!result.checkout_url) throw new Error('Purchase created without a checkout_url')
      return result
    },
    onSuccess: ({ checkout_url }) => {
      queryClient.invalidateQueries({ queryKey: ['packages', 'me'] })
      // Payment confirms the purchase (the Stripe webhook activates it), so
      // the flow continues at Checkout, not back on the page.
      window.location.assign(checkout_url)
    },
  })

  if (status === 'unauthenticated') {
    // The chosen package must survive sign-up (B12) — carried as a query
    // param the sign-up/sign-in pages read and resume into on success.
    return (
      <Link href={`/sign-up?packageId=${pkg.id}`} className={className}>
        <Button variant={variant} className="w-full">{label}</Button>
      </Link>
    )
  }

  return (
    <div className={className}>
      <Button
        variant={variant}
        className="w-full"
        onClick={() => mutation.mutate()}
        disabled={status === 'loading' || mutation.isPending}
      >
        {mutation.isPending ? 'A processar...' : label}
      </Button>
      {mutation.isError && (
        <p role="alert" className="text-xs text-red-600 mt-2">{errorMessage(mutation.error)}</p>
      )}
    </div>
  )
}
