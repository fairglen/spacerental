import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '@/app/dashboard/page'
import { bookingsApi, packagesApi } from '@/lib/api'
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

describe('Dashboard — cancellation eligibility and failures (C07)', () => {
  it('states the 24h rule in the dialog and cancels an eligible booking', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-ok' })])
    vi.mocked(bookingsApi.cancel).mockResolvedValue(undefined as never)
    renderPage()
    const cancel = await screen.findByRole('button', { name: /^Cancelar$/ })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(await screen.findByRole('dialog')).toHaveTextContent(/24 horas/)
    fireEvent.click(screen.getByRole('button', { name: /Sim, cancelar/i }))
    await waitFor(() => expect(bookingsApi.cancel).toHaveBeenCalledWith('b-ok', expect.anything()))
  })

  it('disables Cancel with a visible reason when the booking starts within 24h', async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000)
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-soon', start_time: soon.toISOString() })])
    renderPage()
    const cancel = await screen.findByRole('button', { name: /^Cancelar$/ })
    expect(cancel).toBeDisabled()
    expect(screen.getByText(/24 horas/)).toBeVisible()
  })

  it('keeps the dialog open and explains a backend 400 in Portuguese', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-late' })])
    vi.mocked(bookingsApi.cancel).mockRejectedValue({
      response: { status: 400, data: { detail: 'Bookings can only be cancelled more than 24 hours in advance' } },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Cancelar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sim, cancelar/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/24 horas/)
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(alert).not.toHaveTextContent(/reembols/i)
  })
})

describe('Dashboard — package bookings show hours, not money (B29)', () => {
  it('labels an upcoming pack booking with the hours used and no euro amount', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-pack', payment_method: 'package', duration_hours: 3, total_amount: 33 }),
    ])
    renderPage()
    expect(await screen.findByText('3h do pack')).toBeVisible()
    expect(screen.queryByText(/33,00/)).toBeNull()
  })

  it('does the same in the history', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-past-pack', payment_method: 'package', duration_hours: 2, total_amount: 22, start_time: past, end_time: past }),
      booking({ id: 'b-past-hourly', payment_method: 'hourly', duration_hours: 1, total_amount: 11, start_time: past, end_time: past }),
    ])
    renderPage()
    expect(await screen.findByText('2h do pack')).toBeVisible()
    expect(screen.getByText(/11,00/)).toBeVisible()
    expect(screen.queryByText(/22,00/)).toBeNull()
  })
})

describe('Dashboard — packs summary (B30)', () => {
  it('summarises active packs with hours left, expiry and a link', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockResolvedValue([
      {
        id: 'p-1', user_id: 'user-1', package_id: 'pkg-10', org_id: 'org-1',
        hours_total: 10, hours_used: 2.5, hours_remaining: 7.5, status: 'active',
        purchased_at: new Date().toISOString(), expires_at: '2027-03-01T00:00:00Z',
        package: { id: 'pkg-10', org_id: 'org-1', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true },
      },
      {
        id: 'p-2', user_id: 'user-1', package_id: 'pkg-20', org_id: 'org-1',
        hours_total: 20, hours_used: 0, hours_remaining: 20, status: 'pending',
        purchased_at: new Date().toISOString(), expires_at: '2027-03-01T00:00:00Z',
      },
    ])
    renderPage()
    await screen.findByText('Pack 10h')
    const summary = screen.getByRole('region', { name: /packs/i })
    expect(summary).toHaveTextContent('Pack 10h')
    expect(summary).toHaveTextContent('7,5h')
    expect(summary).toHaveTextContent(/2027/)
    expect(summary).not.toHaveTextContent('20h')
    expect(summary.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
  })

  it('invites the customer to buy a pack when there is none', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockResolvedValue([])
    renderPage()
    await screen.findByText(/ainda não tens/i)
    const summary = screen.getByRole('region', { name: /packs/i })
    expect(summary).toHaveTextContent(/ainda não tens/i)
    expect(summary.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
  })
})
