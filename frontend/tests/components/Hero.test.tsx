import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '@/components/landing/Hero'
import { t } from '@/lib/i18n'

describe('Hero structure', () => {
  it('renders one headline, the subtitle and support line, and the conversion pill from the catalog (W03)', () => {
    render(<Hero />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(`${t('hero.headline_start')} ${t('hero.headline_highlight')}`)
    expect(screen.getByText(t('hero.description'))).toBeInTheDocument()
    expect(screen.getByText(t('hero.support'))).toBeInTheDocument()
    for (const key of ['hero.benefit_booking', 'hero.benefit_1', 'hero.benefit_2', 'hero.benefit_3']) {
      expect(screen.getByText(t(key))).toBeInTheDocument()
    }
  })
})

describe('Hero navigation', () => {
  it('keeps translated calls to action linked to browsing and instructions', () => {
    render(<Hero />)
    expect(screen.getByRole('link', { name: t('hero.cta_primary') })).toHaveAttribute('href', '/spaces')
    expect(screen.getByRole('link', { name: t('hero.cta_secondary') })).toHaveAttribute('href', '/#como-funciona')
  })
})
