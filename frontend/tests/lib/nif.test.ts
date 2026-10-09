import { describe, it, expect } from 'vitest'
import { isValidNif, nifError, normaliseNif } from '@/lib/nif'

// I04: the same table as backend/tests/test_billing_details.py::TestNif.

describe('NIF check digit', () => {
  it.each(['123456789', '501234560', '999999990'])('accepts %s', (value) => {
    expect(isValidNif(value)).toBe(true)
    expect(nifError(value)).toBeNull()
  })

  it.each(['123456780', '12345678', '1234567890', '12345678a', '023456787', 'PT123456789'])('refuses %s', (value) => {
    expect(isValidNif(value)).toBe(false)
    expect(nifError(value)).toBe('NIF inválido')
  })

  it('tolerates spaces and treats blank as no NIF', () => {
    expect(normaliseNif(' 123 456 789 ')).toBe('123456789')
    expect(isValidNif(' 123 456 789 ')).toBe(true)
    expect(nifError('')).toBeNull()
    expect(nifError('   ')).toBeNull()
  })
})
