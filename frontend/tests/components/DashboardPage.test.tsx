import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '@/app/dashboard/page'
import { bookingsApi } from '@/lib/api'
import type { Booking } from '@/types'

let searchParams = new URLSearchParams()
const replace = vi.fn()
// Stable across renders, like the real App Router instance.
const router = { push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token', user: { name: 'Demo' } }, status: 'authenticated' }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))

vi.mock('@/lib/api', () => ({
  bookingsApi: { listMine: vi.fn(), cancel: vi.fn() },
  packagesApi: { listMine: vi.fn().mockResolvedValue([]) },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const inThreeDays = new Date(Date.now() + 3 * 86_400_000)
inThreeDays.setUTCHours(10, 0, 0, 0)

function booking(overrides: Partial<Booking>): Booking {
  const start = overrides.start_time ? new Date(overrides.start_time) : inThreeDays
  return {
    id: 'b-1',
    org_id: 'org-1',
    room_id: 'room-1',
    user_id: 'user-1',
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 3_600_000).toISOString(),
    duration_hours: 1,
    total_amount: 11,
    status: 'confirmed',
    payment_method: 'hourly',
    created_at: new Date().toISOString(),
    room: {
      id: 'room-1', space_id: 's-1', org_id: 'org-1', name: 'Sala Calma', description: '',
      capacity: 6, hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true,
    },
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe('Dashboard — door code (B23)', () => {
  it('shows the access code on a confirmed upcoming booking', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ access_code: '482913' })])
    renderPage()
    expect(await screen.findByText('482913')).toBeVisible()
    expect(screen.getByText(/Código de acesso/i)).toBeVisible()
  })

  it('explains calmly when a confirmed booking has no code yet', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ access_code: null })])
    renderPage()
    expect(await screen.findByText('Sala Calma')).toBeVisible()
    expect(screen.getByText(/código de acesso/i)).toHaveTextContent(/ainda não|em breve/i)
    expect(screen.queryByText(/^\d{6}$/)).toBeNull()
  })

  it('never shows a code or the code label on pending or cancelled bookings', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-pending', status: 'pending', access_code: null }),
      booking({ id: 'b-cancelled', status: 'cancelled', access_code: '111111' }),
    ])
    renderPage()
    expect(await screen.findAllByText('Sala Calma')).toHaveLength(2)
    expect(screen.queryByText(/código de acesso/i)).toBeNull()
    expect(screen.queryByText('111111')).toBeNull()
  })
})

describe('Dashboard — payment return notice (B25)', () => {
  beforeEach(() => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
  })

  it('shows a dismissible success notice linking to packs and strips the param', async () => {
    searchParams = new URLSearchParams('pagamento=sucesso')
    renderPage()
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/pagamento concluído/i)
    expect(notice.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
    expect(replace).toHaveBeenCalledWith('/dashboard', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))
    await screen.findByText('Não tens reservas futuras.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a "não concluído" notice when checkout was cancelled', async () => {
    searchParams = new URLSearchParams('pagamento=cancelado')
    renderPage()
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/pagamento não concluído/i)
    expect(replace).toHaveBeenCalledWith('/dashboard', expect.anything())
  })

  it('shows nothing without the param', async () => {
    renderPage()
    await screen.findByText('Não tens reservas futuras.')
    expect(screen.queryByRole('status')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})
