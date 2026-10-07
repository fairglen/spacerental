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

  it('opens with the brand word and then the headline: no pill above them (V04, B59)', () => {
    const { container } = render(<Hero />)
    const h1 = screen.getByRole('heading', { level: 1 })
    // The first text the hero renders is the headline itself.
    const firstText = container.textContent!.trim()
    expect(firstText.startsWith(`FlowSpace${h1.textContent!.trim()}`)).toBe(true)
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

// B51: the brand mark is the hero illustration from 1024px and a watermark
// under it — the same numbers as the static site's `.hero-grid`,
// `.hero-mark`, `.hero-mark::before` and `.hero-watermark`.
describe('Hero brand mark (B51)', () => {
  it('lays the text and the mark out as two columns from lg, the text column unchanged', () => {
    const { container } = render(<Hero />)
    const grid = container.querySelector('.lg\\:grid')!
    expect(grid.className).toContain('lg:grid-cols-[minmax(0,48rem)_1fr]')
    expect(grid.className).toContain('lg:gap-8')
    expect(grid.className).toContain('lg:items-center')
    const text = grid.firstElementChild!
    expect(text.className).toContain('max-w-3xl')
    // B59: the brand word comes first, then the headline (V04's "nothing
    // above the headline" meant no pill; the name is not a pill).
    const [brand, h1] = Array.from(text.firstElementChild!.children)
    expect(brand).toBe(text.querySelector('p.hero-brand'))
    expect(h1).toBe(text.querySelector('h1'))
  })

  it('B59: "FlowSpace" sits above the headline as a dual-colour brand line, outside the h1 and the catalogs', () => {
    const { container } = render(<Hero />)
    const brand = container.querySelector('p.hero-brand')!
    expect(brand.textContent).toBe('FlowSpace')
    expect(brand.nextElementSibling!.tagName).toBe('H1')
    expect(container.querySelector('h1')!.textContent).not.toContain('FlowSpace')
    for (const cls of ['text-4xl', 'md:text-5xl', 'font-extrabold', 'tracking-tight', 'text-foreground', 'whitespace-nowrap', 'mb-3']) {
      expect(brand.className, cls).toContain(cls)
    }
    const space = brand.querySelector('span')!
    expect(space.textContent).toBe('Space')
    expect(space.className).toContain('text-primary')
    expect(space).not.toHaveAttribute('aria-hidden')
    expect(brand).not.toHaveAttribute('aria-hidden')
  })

  it('the mark column is hidden until lg, decorative, 420px tall, with the disc as a before: pseudo and the 400px mark', () => {
    const { container } = render(<Hero />)
    const column = container.querySelector('[data-testid="hero-mark"]')!
    expect(column).toHaveAttribute('aria-hidden', 'true')
    for (const cls of ['hidden', 'lg:flex', 'relative', 'min-h-[420px]', 'items-center', 'justify-center', 'text-primary',
      'before:h-[460px]', 'before:w-[460px]', 'before:rounded-full', 'before:pointer-events-none',
      "before:bg-[radial-gradient(circle_at_30%_30%,rgba(168,213,186,.55),rgba(232,244,240,0)_70%)]"]) {
      expect(column.className, cls).toContain(cls)
    }
    const mark = column.querySelector('svg')!
    expect(mark).toHaveAttribute('width', '400')
    expect(mark).toHaveAttribute('height', '365')
    expect(mark).toHaveAttribute('aria-hidden', 'true')
    expect(mark.className.baseVal).toContain('w-[min(100%,400px)]')
    expect(mark.querySelector('use')).toHaveAttribute('href', '#brand-mark')
  })

  it('the watermark is the same mark, 440px, bleeding off the bottom-right at the tunable opacity, hidden from lg, behind the text', () => {
    const { container } = render(<Hero />)
    const uses = container.querySelectorAll('use[href="#brand-mark"]')
    expect(uses).toHaveLength(2)
    const watermark = uses[0].closest('svg')!
    expect(watermark).toHaveAttribute('width', '440')
    expect(watermark).toHaveAttribute('height', '401')
    expect(watermark).toHaveAttribute('aria-hidden', 'true')
    for (const cls of ['lg:hidden', 'absolute', '-right-28', '-bottom-12', 'w-[440px]', 'opacity-(--hero-watermark-opacity)', 'pointer-events-none', 'text-primary']) {
      expect(watermark.className.baseVal, cls).toContain(cls)
    }
    // Painted before the content box, which is positioned — so the words stay on top.
    const content = watermark.nextElementSibling!
    expect(content.className).toContain('relative')
    expect(content.querySelector('h1')).not.toBeNull()
  })
})
