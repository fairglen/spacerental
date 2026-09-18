/**
 * Only ever follow a `callbackUrl` that is a same-origin relative path (B28).
 * The value arrives in the query string, so anything that could leave the
 * site — absolute URLs, protocol-relative `//host`, schemes, backslash tricks
 * — is refused and the caller falls back to its default destination.
 */
export function safeInternalPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (raw.startsWith('/')) {
    if (raw.startsWith('//') || raw.startsWith('/\\')) return null
    return raw
  }
  // NextAuth's middleware hands over an absolute URL for the page it
  // protected; keep it only when the origin is exactly ours.
  if (typeof window === 'undefined') return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.origin !== window.location.origin) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/** `/sign-in?callbackUrl=…` for the page the customer is on right now. */
export function signInHref(returnTo: string | null | undefined): string {
  const path = safeInternalPath(returnTo)
  return path ? `/sign-in?callbackUrl=${encodeURIComponent(path)}` : '/sign-in'
}
