import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminDashboard from '@/app/admin/page'
import { periodLabel } from '@/components/admin/ThisMonthCard'
import { adminApi } from '@/lib/api'
import type { AdminStats, BillingSummary } from '@/types'

// I03: the dashboard shows this month's money on the statement's basis and
// "Receita Total" includes pack sales (the O03 smoke finding).

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    currentOrgId: 'org-1',
    memberships: [],
    currentMembership: null,
    setCurrentOrgId: vi.fn(),
    isLoading: false,
  }),
}))

vi.mock('@/lib/hooks/useApi', () => ({
  useApi: () => ({}),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/api', () => ({
  adminApi: {
    getDashboard: vi.fn(),
    getBookings: vi.fn(),
  },
}))

const september: BillingSummary = {
  from: '2026-09-01',
  to: '2026-09-30',
  received_total: '221.00',
  by_channel: { online: '199.00', manual: '22.00' },
  pack_sales: [
    { package_id: 'p10', name: 'Pack 10h', count: 1, amount: '100.00', hours: '10.00' },
    { package_id: 'p5', name: 'Pack 5h', count: 1, amount: '55.00', hours: '5.00' },
  ],
  hourly: { count: 3, amount: '33.00', hours: '3.00' },
  mixed: { count: 1, amount: '11.00', hours: '1.00' },
  manual: { count: 1, amount: '22.00', hours: '2.00' },
  transactions_count: 7,
  invoiced_amount: '0.00',
  pending_amount: '221.00',
}

const stats: AdminStats = {
  total_bookings: 8,
  total_revenue: '232.00',
  occupancy_rate: 75,
  active_users: 2,
  this_month: september,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDashboard />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getBookings).mockResolvedValue({ bookings: [], total: 0, page: 1, page_size: 10 })
})

describe('admin dashboard (I03): this month and the revenue basis', () => {
  it('shows the month received, packs sold, paid hours and what is left to invoice', async () => {
    vi.mocked(adminApi.getDashboard).mockResolvedValue(stats)
    renderPage()
    const card = within(await screen.findByTestId('this-month'))
    expect(card.getByText('Este mês')).toBeInTheDocument()
    expect(card.getByText('1–30 de setembro de 2026')).toBeInTheDocument()
    // Received and still-to-invoice are both 221 € while nothing is recorded.
    expect(card.getByText('Recebido').parentElement).toHaveTextContent(/221,00\s?€/)
    expect(card.getByText('Por faturar').parentElement).toHaveTextContent(/221,00\s?€/)
    expect(card.getByText(/7 transações · 22,00\s?€ fora da plataforma/)).toBeInTheDocument()
    expect(card.getByText('Pack 10h × 1 · Pack 5h × 1')).toBeInTheDocument()
    expect(card.getByText('5')).toBeInTheDocument()
    expect(card.getByText(/6h pagas · 1 com pack/)).toBeInTheDocument()
    expect(card.getByText(/faturado 0,00\s?€/)).toBeInTheDocument()
    expect(card.getByRole('link', { name: /Ver faturação/ })).toHaveAttribute('href', '/admin/billing')
  })

  it('renders the all-time revenue from the Decimal string', async () => {
    vi.mocked(adminApi.getDashboard).mockResolvedValue(stats)
    renderPage()
    await screen.findByTestId('this-month')
    const revenue = screen.getByText('Receita Total').parentElement
    expect(revenue).toHaveTextContent(/232,00\s?€/)
  })

  it('says so when the month has no movements yet', async () => {
    vi.mocked(adminApi.getDashboard).mockResolvedValue({
      ...stats,
      this_month: { ...september, transactions_count: 0, received_total: '0.00', pack_sales: [] },
    })
    renderPage()
    const card = within(await screen.findByTestId('this-month'))
    expect(card.getByText('Ainda não há movimentos este mês.')).toBeInTheDocument()
  })
})

describe('labels', () => {
  it('formats periods in Portuguese', () => {
    expect(periodLabel('2026-09-01', '2026-09-30')).toBe('1–30 de setembro de 2026')
    // date-fns' pt locale abbreviates months without a dot.
    expect(periodLabel('2026-09-15', '2026-10-14')).toBe('15 de set – 14 de out de 2026')
  })
})
