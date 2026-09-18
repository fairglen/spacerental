import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotFound from '@/app/not-found'

vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))

// B33f: the default Next 404 is English on a Portuguese site.
describe('Not found page', () => {
  it('explains in Portuguese and offers a way back', () => {
    render(<NotFound />)
    expect(screen.getByRole('heading', { name: /Página não encontrada/i })).toBeVisible()
    expect(screen.getByRole('link', { name: /Voltar ao início/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /Ver espaços/i })).toHaveAttribute('href', '/spaces')
  })
})
