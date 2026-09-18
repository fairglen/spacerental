import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { Footer } from '@/components/layout/Footer'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))

// B33a: the footer offered "Entrar" to people who were already signed in.
describe('Footer account link', () => {
  it('offers sign-in to visitors', () => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() })
    render(<Footer />)
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/sign-in')
  })

  it('offers the bookings page instead once signed in', () => {
    vi.mocked(useSession).mockReturnValue({
      data: { accessToken: 'jwt', user: { name: 'Demo' } } as never,
      status: 'authenticated',
      update: vi.fn(),
    })
    render(<Footer />)
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull()
    expect(screen.getByRole('link', { name: /As minhas reservas/ })).toHaveAttribute('href', '/dashboard')
  })
})
