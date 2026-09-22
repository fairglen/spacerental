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

// Mirrors `create_booking` on the backend (C13): the server decides the real
// split, this only tells the customer beforehand what it will be.
describe('planPayment', () => {
  it('7h pack, 8h booking: the pack gives 7 and 1 hour is paid', () => {
    expect(planPayment([purchase('a', 7)], 'org-1', 8, NOW)).toEqual({
      kind: 'partial', purchaseId: 'a', packHours: 7, paidHours: 1, hoursLeftAfter: 0,
    })
  })

  it('a pack that covers everything pays for everything', () => {
    expect(planPayment([purchase('a', 10)], 'org-1', 8, NOW)).toEqual({
      kind: 'full', purchaseId: 'a', packHours: 8, paidHours: 0, hoursLeftAfter: 2,
    })
  })

  it('exactly enough is full, not partial', () => {
    expect(planPayment([purchase('a', 8)], 'org-1', 8, NOW).kind).toBe('full')
  })

  it('a whole-block pack wins over a sooner-expiring partial one', () => {
    const plan = planPayment(
      [purchase('soon', 2, { expires_at: '2026-10-01T00:00:00Z' }), purchase('big', 10)], 'org-1', 8, NOW,
    )
    expect(plan).toMatchObject({ kind: 'full', purchaseId: 'big' })
  })

  it('otherwise the soonest-expiring pack gives its hours, and only that one', () => {
    const plan = planPayment(
      [purchase('later', 5), purchase('soon', 3, { expires_at: '2026-10-01T00:00:00Z' })], 'org-1', 8, NOW,
    )
    expect(plan).toEqual({ kind: 'partial', purchaseId: 'soon', packHours: 3, paidHours: 5, hoursLeftAfter: 0 })
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
