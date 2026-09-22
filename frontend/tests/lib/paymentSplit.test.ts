import { describe, it, expect } from 'vitest'
import { planPayment } from '@/lib/paymentSplit'
import type { UserPackagePurchase } from '@/types'

const NOW = new Date('2026-09-22T12:00:00Z')

function purchase(id: string, hours: number, overrides: Partial<UserPackagePurchase> = {}): UserPackagePurchase {
  return {
    id, user_id: 'u', package_id: 'p', org_id: 'org-1', hours_total: 10, hours_used: 10 - hours,
    hours_remaining: hours, amount_paid: 100, status: 'active', purchased_at: '2026-01-01T00:00:00Z',
    expires_at: '2027-01-01T00:00:00Z', ...overrides,
  }
}

// Mirrors `create_booking` on the backend (C13, pooled by H02): the server
// decides the real split, this only tells the customer beforehand what it
// will be.
describe('planPayment', () => {
  it('7h pack, 8h booking: the pack gives 7 and 1 hour is paid', () => {
    expect(planPayment([purchase('a', 7)], 'org-1', 8, NOW)).toEqual({
      kind: 'partial', packHours: 7, paidHours: 1, hoursLeftAfter: 0, packsUsed: 1,
    })
  })

  it('a pack that covers everything pays for everything', () => {
    expect(planPayment([purchase('a', 10)], 'org-1', 8, NOW)).toEqual({
      kind: 'full', packHours: 8, paidHours: 0, hoursLeftAfter: 2, packsUsed: 1,
    })
  })

  it('exactly enough is full, not partial', () => {
    expect(planPayment([purchase('a', 8)], 'org-1', 8, NOW).kind).toBe('full')
  })

  it('the bank is one balance: 2h + 10h cover 8h, the sooner pack first (H02)', () => {
    const plan = planPayment(
      [purchase('soon', 2, { expires_at: '2026-10-01T00:00:00Z' }), purchase('big', 10)], 'org-1', 8, NOW,
    )
    expect(plan).toEqual({ kind: 'full', packHours: 8, paidHours: 0, hoursLeftAfter: 4, packsUsed: 2 })
  })

  it('3h + 5h pay an 8h block outright, nothing in money (H02)', () => {
    const plan = planPayment(
      [purchase('later', 5), purchase('soon', 3, { expires_at: '2026-10-01T00:00:00Z' })], 'org-1', 8, NOW,
    )
    expect(plan).toEqual({ kind: 'full', packHours: 8, paidHours: 0, hoursLeftAfter: 0, packsUsed: 2 })
  })

  it('money starts only when the whole bank is spent: 2h + 10h against 13h', () => {
    const plan = planPayment(
      [purchase('soon', 2, { expires_at: '2026-10-01T00:00:00Z' }), purchase('big', 10)], 'org-1', 13, NOW,
    )
    expect(plan).toEqual({ kind: 'partial', packHours: 12, paidHours: 1, hoursLeftAfter: 0, packsUsed: 2 })
  })

  it('counts only the packs the block actually draws on', () => {
    const plan = planPayment(
      [purchase('soon', 2, { expires_at: '2026-10-01T00:00:00Z' }), purchase('big', 10)], 'org-1', 2, NOW,
    )
    expect(plan).toEqual({ kind: 'full', packHours: 2, paidHours: 0, hoursLeftAfter: 10, packsUsed: 1 })
  })

  it.each([
    ['no purchases', []],
    ['an empty pack', [purchase('a', 0)]],
    ['an expired pack', [purchase('a', 5, { expires_at: '2026-09-22T11:59:59Z' })]],
    ['an unpaid pack', [purchase('a', 5, { status: 'pending' })]],
    ['a cancelled pack', [purchase('a', 5, { status: 'cancelled' })]],
    ["another organization's pack", [purchase('a', 5, { org_id: 'org-2' })]],
  ])('%s leaves nothing to use', (_label, purchases) => {
    expect(planPayment(purchases as UserPackagePurchase[], 'org-1', 8, NOW)).toEqual({ kind: 'none' })
  })

  it('a zero-length selection plans nothing', () => {
    expect(planPayment([purchase('a', 7)], 'org-1', 0, NOW)).toEqual({ kind: 'none' })
  })
})
