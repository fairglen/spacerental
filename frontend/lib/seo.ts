import type { Metadata } from 'next'

// S2.1: flowspace.pt (the static site) is the only indexable surface. The
// app exists to be used, not found: every route says `noindex, follow` — a
// shared link still unfurls (the Open Graph tags stay), its links are still
// followed, nothing of it ranks — and the landing canonicalises to the site,
// so the two never compete for the same query.

/** The static site, which the app's landing canonicalises to. */
export const SITE_CANONICAL = 'https://flowspace.pt/'

/** Every route: not indexed, links followed. */
export const ROBOTS_APP: NonNullable<Metadata['robots']> = { index: false, follow: true }

/**
 * The private surface — sign-in, password reset, the customer area, the
 * admin panel: nothing beyond them is for a crawler either. `lib/robotsHeaders.js`
 * sends the same answer as an `X-Robots-Tag` header, which covers the
 * redirects these routes answer with before a page exists.
 */
export const ROBOTS_PRIVATE: NonNullable<Metadata['robots']> = { index: false, follow: false }

/**
 * The app's public URL, which makes relative Open Graph images absolute:
 * `FRONTEND_URL` (the backend's name for it, the one deploys set) or, failing
 * that, `NEXTAUTH_URL` (required by Compose and always the same address).
 * Unset — a bare `next build` — Next falls back to localhost and says so.
 */
export function metadataBaseFrom(env: { FRONTEND_URL?: string; NEXTAUTH_URL?: string }): URL | undefined {
  const url = env.FRONTEND_URL || env.NEXTAUTH_URL
  return url ? new URL(url) : undefined
}
