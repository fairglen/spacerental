import type { UserPackagePurchase } from '@/types'

/**
 * What a booking of `duration` hours will cost this customer BEFORE they
 * confirm: all from their packs, part packs and part money, or all money
 * (C13, pooled by H02).
 *
 * It mirrors `create_booking` on the backend so the modal can show the split
 * up front — but it is only a preview. The server recomputes it from the
 * ledger and ignores any numbers the client sends, because a balance can
 * change between this render and the click.
 *
 * Same rules, same order: every active, unexpired pack in this org forms one
 * bank; the block draws on it soonest-expiring first; money starts only when
 * the bank is empty.
 */
export type PaymentPlan =
  | { kind: 'none' }
  | {
      kind: 'full' | 'partial'
      packHours: number
      paidHours: number
      /** What the bank holds once this block is taken out of it. */
      hoursLeftAfter: number
      /** How many packs the block draws on — "(de 2 packs)" in the breakdown. */
      packsUsed: number
    }

export function planPayment(
  purchases: UserPackagePurchase[],
  orgId: string,
  duration: number,
  now: Date = new Date(),
): PaymentPlan {
  if (duration <= 0) return { kind: 'none' }
  const bank = purchases
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

  let needed = duration
  let packsUsed = 0
  for (const p of bank) {
    if (needed <= 0) break
    needed -= Math.min(p.hours_remaining, needed)
    packsUsed += 1
  }
  const packHours = duration - needed
  if (packHours <= 0) return { kind: 'none' }
  const available = bank.reduce((sum, p) => sum + p.hours_remaining, 0)
  return {
    kind: needed === 0 ? 'full' : 'partial',
    packHours,
    paidHours: needed,
    hoursLeftAfter: available - packHours,
    packsUsed,
  }
}
