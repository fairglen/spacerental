import { describe, it, expect } from 'vitest'
import pt from '@/lib/i18n/pt.json'
import en from '@/lib/i18n/en.json'

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.entries(obj).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') acc[path] = value
    else Object.assign(acc, flatten(value, path))
    return acc
  }, {})
}

const ptFlat = flatten(pt)
const enFlat = flatten(en)

describe('i18n catalogs', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(ptFlat).sort()).toEqual(Object.keys(enFlat).sort())
  })

  // B32: the landing page must not advertise what the product does not do.
  it.each([
    ['Google sign-in', /google/i],
    // "Sem mensalidade" / "No monthly fee" is a true negation and stays.
    ['monthly plans', /\bmensalmente\b|\bmonthly\b(?! fee)/i],
    ['priority booking', /priorit/i],
    ['recurring bookings (feature-flagged off by default)', /recorrente|recurring/i],
  ])('do not promise %s', (_label, pattern) => {
    const offenders = [...Object.entries(ptFlat), ...Object.entries(enFlat)]
      .filter(([, value]) => pattern.test(value))
      .map(([key, value]) => `${key}: ${value}`)
    expect(offenders).toEqual([])
  })
})
