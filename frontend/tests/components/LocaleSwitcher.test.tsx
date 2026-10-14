import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'
import { Hero } from '@/components/landing/Hero'
import { setLocale } from '@/lib/i18n'
import pt from '@/lib/i18n/pt.json'
import en from '@/lib/i18n/en.json'

// B64: the choice is a cookie the server reads; localStorage was the old store.
const COOKIE = 'flowspace.locale'

afterEach(() => {
  cleanup()
  setLocale('pt')
  window.localStorage.clear()
})

describe('LocaleSwitcher (9.2)', () => {
  it('defaults to Portuguese with both options visible', () => {
    render(<LocaleSwitcher />)

    expect(screen.getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('toggling to EN updates already-rendered copy in migrated components immediately, no reload', () => {
    render(
      <>
        <LocaleSwitcher />
        <Hero />
      </>
    )

    expect(screen.getByText(pt.hero.headline_start)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(screen.getByText(en.hero.headline_start)).toBeInTheDocument()
    expect(screen.queryByText(pt.hero.headline_start)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'false')

    // Toggling back to PT is equally immediate.
    fireEvent.click(screen.getByRole('button', { name: 'PT' }))
    expect(screen.getByText(pt.hero.headline_start)).toBeInTheDocument()
  })

  it('writes the choice to the locale cookie (B64)', () => {
    render(<LocaleSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(document.cookie).toContain(`${COOKIE}=en`)
    expect(window.localStorage.getItem('espacohora.locale')).toBeNull()
  })

  it('persists the choice across a simulated remount (fresh module load re-reading storage)', async () => {
    const { unmount } = render(<LocaleSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(document.cookie).toContain(`${COOKIE}=en`)
    unmount()

    // Reset the module registry so the i18n locale store re-initializes from
    // scratch, the same way it would on a fresh page load/remount — proving
    // the persisted value (not just in-memory state) drives the next render.
    vi.resetModules()
    // A fresh page load in EN gets the catalog from the server's render
    // (Providers → LocaleProvider, B65); here that is the registry call.
    const { registerCatalog: registerFresh } = await import('@/lib/i18n/registry')
    registerFresh('en', (await import('@/lib/i18n/en.json')).default)
    const { Hero: RehydratedHero } = await import('@/components/landing/Hero')

    render(<RehydratedHero />)
    expect(screen.getByText('Your space,')).toBeInTheDocument()
  })
})
