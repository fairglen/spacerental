import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Hero } from '@/components/landing/Hero'
import { t } from '@/lib/i18n'
import pt from '@/lib/i18n/pt.json'

describe('Hero structure', () => {
  it('renders one headline with its emphasis, the lede and support line, two CTAs and four benefits from the catalog (W03/L02)', () => {
    render(<Hero />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(`${t('hero.headline_start')} ${t('hero.headline_highlight')}`)
    // The emphasis is on the second half only, exactly as before L02.
    expect(h1.querySelector('span')).toHaveTextContent(t('hero.headline_highlight'))
    expect(screen.getByText(t('hero.description'))).toBeInTheDocument()
    expect(screen.getByText(t('hero.support'))).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    const benefits = ['hero.benefit_booking', 'hero.benefit_1', 'hero.benefit_2', 'hero.benefit_3'].map((key) =>
      screen.getByText(t(key)),
    )
    // Four, in the catalog's order, each with its dot.
    expect(benefits).toHaveLength(4)
    benefits.forEach((benefit, i) => {
      expect(benefit.querySelector('span.rounded-full')).not.toBeNull()
      if (i > 0) expect(benefits[i - 1].compareDocumentPosition(benefit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
  })

  it('carries the whole message: no "O espaço" section is rendered under it (L02)', () => {
    // The landing page's sections: the hero is followed by the value props,
    // not by a section repeating the hero's message.
    expect(Object.keys(pt)).not.toContain('theSpace')
  })

  it('opens with the headline: nothing sits above it any more (V04)', () => {
    const { container } = render(<Hero />)
    const h1 = screen.getByRole('heading', { level: 1 })
    // The first text the hero renders is the headline itself.
    const firstText = container.textContent!.trim()
    expect(firstText.startsWith(h1.textContent!.trim())).toBe(true)
    expect(container.querySelector('.rounded-full.bg-accent')).toBeNull()
  })
})

describe('Hero navigation', () => {
  it('keeps translated calls to action linked to browsing and instructions', () => {
    render(<Hero />)
    expect(screen.getByRole('link', { name: t('hero.cta_primary') })).toHaveAttribute('href', '/spaces')
    expect(screen.getByRole('link', { name: t('hero.cta_secondary') })).toHaveAttribute('href', '/#como-funciona')
  })
})
