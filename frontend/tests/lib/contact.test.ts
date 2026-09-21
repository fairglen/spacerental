import { describe, it, expect } from 'vitest'
import { CONTACT_EMAIL, contactMailto } from '@/lib/contact'
import pt from '@/lib/i18n/pt.json'
import en from '@/lib/i18n/en.json'

describe('public contact address (C09)', () => {
  it('is the flowspace mailbox', () => {
    expect(CONTACT_EMAIL).toBe('geral@flowspace.pt')
  })

  it('builds a plain mailto link', () => {
    expect(contactMailto()).toBe(`mailto:${CONTACT_EMAIL}`)
  })

  it('encodes a prefilled subject', () => {
    const href = contactMailto('Pedido de reserva — Sala Calma & Cª')
    expect(href.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true)
    expect(new URL(href).searchParams.get('subject')).toBe('Pedido de reserva — Sala Calma & Cª')
    // A raw "&" would start a second mailto header.
    expect(href.split('?')[1]).not.toContain('& ')
  })

  // The single source is lib/contact.ts: a catalog that spells an address out
  // is a second copy waiting to drift, which is how the footer went stale.
  it('is not repeated in the i18n catalogs', () => {
    const literal = /[\w.+-]+@[\w-]+\.[\w.]+/
    expect(JSON.stringify(pt)).not.toMatch(literal)
    expect(JSON.stringify(en)).not.toMatch(literal)
  })
})
