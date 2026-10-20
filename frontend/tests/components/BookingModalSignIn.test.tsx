import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingModal } from '@/components/booking/BookingModal'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'
import type { Room } from '@/types'

// Signed-out visitor (the global next-auth mock in tests/setup.ts is
// unauthenticated) on a space page: the sign-in link must bring them back
// here, not to the dashboard (B28).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spaces/space-1',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/api', () => ({
  bookingsApi: { create: vi.fn() },
  recurrencesApi: { create: vi.fn() },
  packagesApi: { listMine: vi.fn().mockResolvedValue([]) },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const room: Room = {
  id: 'r-1', space_id: 'space-1', org_id: 'org-1', name: 'Sala Calma', description: '', capacity: 4,
  hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true,
}

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BookingModal room={room} start={new Date('2030-08-12T09:00:00Z')} end={new Date('2030-08-12T10:00:00Z')} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

afterEach(() => resetLocaleForTests())

describe('BookingModal sign-in link (B28)', () => {
  it('links to sign-in with a callbackUrl back to the space page', () => {
    renderModal()
    expect(screen.getByRole('link', { name: /Entrar na conta/i }))
      .toHaveAttribute('href', '/sign-in?callbackUrl=%2Fspaces%2Fspace-1')
  })

  // B65: the same link and reason in English.
  it('says so in English, with the same callbackUrl', () => {
    setLocale('en')
    renderModal()
    expect(screen.getByRole('link', { name: 'Sign in to your account' }))
      .toHaveAttribute('href', '/sign-in?callbackUrl=%2Fspaces%2Fspace-1')
    expect(screen.getByText(/You need to be signed in to book\./)).toBeVisible()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/Reservar|Comprar|Os meus|Não tem|Entrar/)
  })
})
