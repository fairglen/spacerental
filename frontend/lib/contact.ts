/**
 * The public contact address, and the only place it is written in the
 * frontend (C09). Catalogs take it as an `{email}` placeholder rather than
 * spelling it out: the footer went stale precisely because the address lived
 * in two JSON files.
 *
 * This is where customers write to us. It is unrelated to the backend's
 * EMAIL_FROM_ADDRESS, the no-reply sending domain.
 */
export const CONTACT_EMAIL = 'geral@flowspace.pt'

export function contactMailto(subject?: string): string {
  const base = `mailto:${CONTACT_EMAIL}`
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base
}
