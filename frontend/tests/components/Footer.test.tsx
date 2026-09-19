import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/layout/Footer'
import { t } from '@/lib/i18n'
import { CONTACT_EMAIL } from '@/lib/contact'

describe('Footer navigation', () => {
  it('preserves destinations for translated links', () => {
    render(<Footer />)
    for (const [key, href] of [
      ['footer.spaces', '/spaces'],
      ['footer.how_it_works', '/#como-funciona'],
      ['footer.pricing', '/#precos'],
      ['footer.sign_in', '/sign-in'],
    ]) {
      expect(screen.getByRole('link', { name: t(key) })).toHaveAttribute('href', href)
    }
  })

  it('links the contact address from the single source (C09)', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: CONTACT_EMAIL })).toHaveAttribute('href', `mailto:${CONTACT_EMAIL}`)
  })
})
