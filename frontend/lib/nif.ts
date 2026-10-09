// The Portuguese NIF's check digit (I04), mirrored from backend/app/nif.py so
// a form can say "NIF inválido" before the request. The API is the judge.

export function normaliseNif(value: string): string {
  return value.replace(/\s+/g, '')
}

export function isValidNif(value: string): boolean {
  const digits = normaliseNif(value)
  if (!/^[1-9]\d{8}$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 8; i += 1) sum += Number(digits[i]) * (9 - i)
  const remainder = sum % 11
  const check = remainder < 2 ? 0 : 11 - remainder
  return Number(digits[8]) === check
}

/** Blank is allowed (no NIF); anything else must check out. */
export function nifError(value: string): string | null {
  const digits = normaliseNif(value)
  if (digits === '') return null
  return isValidNif(digits) ? null : 'NIF inválido'
}
