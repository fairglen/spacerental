import type { UserPackagePurchase } from '@/types'

/**
 * What a booking of `duration` hours will cost this customer BEFORE they
 * confirm: all from a pack, part pack and part money, or all money (C13).
 *
 * It mirrors `create_booking` on the backend so the modal can show the split
 * up front — but it is only a preview. The server recomputes it from the
 * ledger and ignores any numbers the client sends, because a balance can
 * change between this render and the click.
 *
 * Same rules, same order: a pack that can pay for the whole block wins
 * (soonest-expiring first); otherwise the soonest-expiring pack that still has
 * hours gives what it has. One pack per booking, never a sum across packs.
 */
export type PaymentPlan =
  | { kind: 'none' }
  | { kind: 'full' | 'partial'; purchaseId: string; packHours: number; paidHours: number; hoursLeftAfter: number }

export function planPayment(
  purchases: UserPackagePurchase[],
  orgId: string,
  duration: number,
  now: Date = new Date(),
): PaymentPlan {
  if (duration <= 0) return { kind: 'none' }
  const usable = purchases
    .filter(
      (p) =>
        p.org_id === orgId &&
        p.status === 'active' &&
        new Date(p.expires_at).getTime() > now.getTime() &&
        p.hours_remaining > 0,
    )
    .sort(
      (a, b) =>
        new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime() || a.id.localeCompare(b.id),
    )

  const whole = usable.find((p) => p.hours_remaining >= duration)
  if (whole) {
    return {
      kind: 'full', purchaseId: whole.id, packHours: duration, paidHours: 0,
      hoursLeftAfter: whole.hours_remaining - duration,
    }
  }
  const first = usable[0]
  if (!first) return { kind: 'none' }
  return {
    kind: 'partial', purchaseId: first.id, packHours: first.hours_remaining,
    paidHours: duration - first.hours_remaining, hoursLeftAfter: 0,
  }
}
