import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotFound from '@/app/not-found'
import { LOCALE_COOKIE } from '@/lib/i18n'

vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))

// A Server Component: the language is the request's cookie (B65).
const requestCookies = vi.hoisted(() => ({ locale: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === LOCALE_COOKIE && requestCookies.locale ? { name, value: requestCookies.locale } : undefined),
  }),
}))

beforeEach(() => {
  requestCookies.locale = undefined
})

// B33f: the default Next 404 is English on a Portuguese site.
describe('Not found page', () => {
  it('explains in Portuguese and offers a way back', () => {
    render(<NotFound />)
    expect(screen.getByRole('heading', { name: /Página não encontrada/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /Voltar ao início/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Ver espaços/i })).toHaveAttribute('href', '/spaces')
  })

  it('explains in English when the locale cookie says so (B65)', () => {
    requestCookies.locale = 'en'
    render(<NotFound />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    expect(screen.getByText('The page you are looking for does not exist or has been moved.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'View spaces' })).toHaveAttribute('href', '/spaces')
    expect(document.body.textContent).not.toMatch(/Página|Voltar|espaços/)
  })
})
