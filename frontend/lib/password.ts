// The password policy as the browser can check it (B66): length and the
// address's local part, so the hint under the field says what the server
// will say before the request is sent. The breached-password list is
// server-side only; the routes answer 422 with every reason, which the
// forms show verbatim (`passwordReasonsOf`). Mirrors backend/app/passwords.py.
import { t, tFor } from '@/lib/i18n'

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
const MIN_LOCAL_PART = 4
const PRODUCT_WORD = 'flowspace'

type Translate = typeof t
const LENGTH = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }

/** The hint under a new-password field, in the browser's locale unless the caller binds one (B65). */
export function passwordHint(translate: Translate = t): string {
  return translate('password.hint', LENGTH)
}

// B65: the admin's forms are Portuguese only (D02) and read these as values.
const pt = tFor('pt')
export const PASSWORD_LENGTH_MESSAGE = pt('password.length', LENGTH)
export const PASSWORD_EMAIL_MESSAGE = pt('password.email_part')
export const PASSWORD_PRODUCT_MESSAGE = pt('password.product', { word: PRODUCT_WORD })
export const PASSWORD_HINT = passwordHint(pt)

export function emailLocalPart(email: string): string {
  return email.split('@', 1)[0].trim().toLowerCase()
}

/**
 * Why `password` would be refused for `email`; empty when the browser sees
 * nothing wrong. In the browser's locale unless the caller binds one (B65).
 */
export function passwordProblems(password: string, email = '', translate: Translate = t): string[] {
  const problems: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) problems.push(translate('password.length', LENGTH))
  const lowered = password.toLowerCase()
  const local = emailLocalPart(email)
  if (local.length >= MIN_LOCAL_PART && lowered.includes(local)) problems.push(translate('password.email_part'))
  if (lowered.includes(PRODUCT_WORD)) problems.push(translate('password.product', { word: PRODUCT_WORD }))
  return problems
}

/**
 * The reasons a 422 from a password route carries (`detail` is a list of
 * strings), or undefined for any other error shape.
 */
export function passwordReasonsOf(error: unknown): string[] | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined
  const response = (error as { response?: unknown }).response
  if (typeof response !== 'object' || response === null || !('data' in response)) return undefined
  const data = (response as { data?: unknown }).data
  if (typeof data !== 'object' || data === null || !('detail' in data)) return undefined
  const detail = (data as { detail?: unknown }).detail
  if (!Array.isArray(detail) || !detail.every((d) => typeof d === 'string')) return undefined
  return detail as string[]
}
