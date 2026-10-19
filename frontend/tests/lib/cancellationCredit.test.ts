import { describe, it, expect } from 'vitest'
import { purchaseLabel, purchaseSourceLabels, PURCHASE_SOURCE_LABELS } from '@/lib/cancellationCredit'

// B65: the bank-card label in both languages; the operator's constant stays Portuguese.
describe('purchaseLabel', () => {
  const credit = { source: 'cancellation_credit' as const, purchased_at: '2026-10-01T10:00:00Z', package: null }
  const pack = {
    source: 'purchase' as const,
    purchased_at: '2026-10-01T10:00:00Z',
    package: { id: 'pkg', org_id: 'org', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true },
  }

  it('names a credit by its cancellation date, Portuguese by default', () => {
    expect(purchaseLabel(credit)).toBe('Crédito — cancelamento de 1 out')
    expect(purchaseLabel(credit, 'pt')).toBe('Crédito — cancelamento de 1 out')
    expect(purchaseLabel(credit, 'en')).toBe('Credit — cancellation of 1 Oct')
  })

  it('names a pack by its name, with a fallback in either language', () => {
    expect(purchaseLabel(pack, 'en')).toBe('Pack 10h')
    expect(purchaseLabel({ ...pack, package: null })).toBe('Pack')
    expect(purchaseLabel({ ...pack, package: null }, 'en')).toBe('Pack')
  })
})

describe('purchase source labels', () => {
  it('keeps the operator constant Portuguese and offers the English map', () => {
    expect(PURCHASE_SOURCE_LABELS).toEqual({ purchase: 'Compra', complimentary: 'Oferta', cancellation_credit: 'Crédito de cancelamento' })
    expect(purchaseSourceLabels('pt')).toEqual(PURCHASE_SOURCE_LABELS)
    expect(purchaseSourceLabels('en')).toEqual({ purchase: 'Purchase', complimentary: 'Complimentary', cancellation_credit: 'Cancellation credit' })
  })
})
