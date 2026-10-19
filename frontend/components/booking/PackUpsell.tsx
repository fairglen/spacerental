'use client'
import type { UseMutationResult } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { formatCurrency, formatHours } from '@/lib/utils'
import type { Package, PackagePurchaseCheckout } from '@/types'

interface PackUpsellProps {
  packages: Package[]
  buying: boolean
  onChoose: () => void
  purchase: UseMutationResult<PackagePurchaseCheckout, Error, string>
  disabled: boolean
  isUnauthenticated: boolean
}

/**
 * "Comprar um pack" (K02, Q51): the radio and, once chosen, the packs on
 * sale inline — "Comprar" leaves for Checkout and comes back to this slot.
 */
export function PackUpsell({ packages, buying, onChoose, purchase, disabled, isUnauthenticated }: PackUpsellProps) {
  const t = useT()
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="radio"
          name="payment_method"
          value="buy"
          checked={buying}
          onChange={onChoose}
          disabled={disabled}
        />
        <span>{t('booking.buy_pack')}</span>
      </label>
      {buying && (
        // K02: the packs on sale, inline; "Comprar" leaves for
        // Checkout and comes back to this slot.
        <div className="pl-6 space-y-2" data-testid="buy-pack">
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('booking.no_packs_for_sale')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {packages.map((pkg) => (
                <li key={pkg.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>
                    <span className="font-medium text-foreground">{pkg.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('booking.pack_line', { hours: formatHours(pkg.hours), price: formatCurrency(pkg.price), days: pkg.validity_days })}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    type="button"
                    onClick={() => purchase.mutate(pkg.id)}
                    disabled={purchase.isPending || isUnauthenticated}
                  >
                    {purchase.isPending && purchase.variables === pkg.id ? t('booking.processing') : t('booking.buy')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            {t('booking.slot_not_held')}
          </p>
          {purchase.isError && (
            <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {t('booking.purchase_failed')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
