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

/**
 * An optional phone number for "Onde estamos" (V06). Empty by default — there
 * is no number yet — and rendered only when set: NEXT_PUBLIC_CONTACT_PHONE,
 * which Compose fills from CONTACT_PHONE in .env.
 */
export const CONTACT_PHONE = (process.env.NEXT_PUBLIC_CONTACT_PHONE ?? '').trim()

export function contactMailto(subject?: string): string {
  const base = `mailto:${CONTACT_EMAIL}`
  return subject ? `${base}?subject=${encodeURIComponent(subject)}` : base
}
