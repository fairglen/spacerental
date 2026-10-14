// The password policy as the browser can check it (B66): length and the
// address's local part, so the hint under the field says what the server
// will say before the request is sent. The breached-password list is
// server-side only; the routes answer 422 with every reason, which the
// forms show verbatim (`passwordReasonsOf`). Mirrors backend/app/passwords.py.

export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
const MIN_LOCAL_PART = 4
const PRODUCT_WORD = 'flowspace'

export const PASSWORD_LENGTH_MESSAGE = `A password tem de ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`
export const PASSWORD_EMAIL_MESSAGE = 'A password não pode conter a parte do seu email antes do @.'
export const PASSWORD_PRODUCT_MESSAGE = `A password não pode conter "${PRODUCT_WORD}".`
export const PASSWORD_HINT =
  `Entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres; uma frase que só a sua pessoa conhece. ` +
  'Passwords comuns e a parte do seu email antes do @ são recusadas.'

export function emailLocalPart(email: string): string {
  return email.split('@', 1)[0].trim().toLowerCase()
}

/** Why `password` would be refused for `email`; empty when the browser sees nothing wrong. */
export function passwordProblems(password: string, email = ''): string[] {
  const problems: string[] = []
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) problems.push(PASSWORD_LENGTH_MESSAGE)
  const lowered = password.toLowerCase()
  const local = emailLocalPart(email)
  if (local.length >= MIN_LOCAL_PART && lowered.includes(local)) problems.push(PASSWORD_EMAIL_MESSAGE)
  if (lowered.includes(PRODUCT_WORD)) problems.push(PASSWORD_PRODUCT_MESSAGE)
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
