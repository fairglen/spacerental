import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher'
import { Hero } from '@/components/landing/Hero'
import { setLocale } from '@/lib/i18n'

const STORAGE_KEY = 'espacohora.locale'

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

    expect(screen.getByText('O teu espaço,')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(screen.getByText('Your space,')).toBeInTheDocument()
    expect(screen.queryByText('O teu espaço,')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'PT' })).toHaveAttribute('aria-pressed', 'false')

    // Toggling back to PT is equally immediate.
    fireEvent.click(screen.getByRole('button', { name: 'PT' }))
    expect(screen.getByText('O teu espaço,')).toBeInTheDocument()
  })

  it('writes the choice to localStorage under the documented key', () => {
    render(<LocaleSwitcher />)

    fireEvent.click(screen.getByRole('button', { name: 'EN' }))

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
  })

  it('persists the choice across a simulated remount (fresh module load re-reading storage)', async () => {
    const { unmount } = render(<LocaleSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'EN' }))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('en')
    unmount()

    // Reset the module registry so the i18n locale store re-initializes from
    // scratch, the same way it would on a fresh page load/remount — proving
    // the persisted value (not just in-memory state) drives the next render.
    vi.resetModules()
    const { Hero: RehydratedHero } = await import('@/components/landing/Hero')

    render(<RehydratedHero />)
    expect(screen.getByText('Your space,')).toBeInTheDocument()
  })
})
