import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Footer } from '@/components/layout/Footer'
import { t } from '@/lib/i18n'

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
})
