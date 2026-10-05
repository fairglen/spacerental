import { signOut } from 'next-auth/react'

let signingOut = false

/**
 * The backend refused the bearer token (401): it was revoked by a password
 * change, a suspension or an anonymisation, or it simply expired. The
 * NextAuth cookie that carries it is still valid on its own, so the browser
 * would keep opening protected pages that then fail on every call. End the
 * NextAuth session too and say why on the sign-in page (review on #65).
 * Once per page load: every in-flight call fails at the same moment.
 */
export function sessionRevoked(): void {
  if (typeof window === 'undefined' || signingOut) return
  signingOut = true
  void signOut({ callbackUrl: '/sign-in?session=expired' })
}

/** Test seam: forget that a sign-out is already under way. */
export function resetSessionRevoked(): void {
  signingOut = false
}
