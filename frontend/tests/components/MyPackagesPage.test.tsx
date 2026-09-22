import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyPackagesPage from '@/app/dashboard/packages/page'
import { packagesApi } from '@/lib/api'
import type { MyPackages, Package, UserPackagePurchase } from '@/types'

let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/packages',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token', user: { name: 'Demo' } }, status: 'authenticated' }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/contexts/OrgContext', () => ({ useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }) }))

vi.mock('@/lib/api', () => ({
  packagesApi: { listMine: vi.fn(), myPackages: vi.fn(), list: vi.fn(), purchase: vi.fn() },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const pack10: Package = {
  id: 'pkg-10h', org_id: 'org-1', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true,
}
const pack20: Package = {
  id: 'pkg-20h', org_id: 'org-1', name: 'Pack 20h', hours: 20, price: 190, validity_days: 365, is_active: true,
}
const activePurchase: UserPackagePurchase = {
  id: 'purchase-1',
  user_id: 'user-1',
  package_id: pack10.id,
  org_id: 'org-1',
  hours_total: 10,
  hours_used: 3,
  hours_remaining: 7, amount_paid: 100,
  status: 'active',
  purchased_at: new Date().toISOString(),
  expires_at: new Date('2027-01-01').toISOString(),
  package: pack10,
}

/** The page reads purchases and the bank together (H02); build both from a list. */
function mine(purchases: UserPackagePurchase[], balance?: MyPackages['balance']) {
  const spendable = purchases
    .filter((p) => p.status === 'active' && new Date(p.expires_at).getTime() > Date.now() && p.hours_remaining > 0)
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
  const first = spendable[0]
  vi.mocked(packagesApi.myPackages).mockResolvedValue({
    purchases,
    balance: balance ?? {
      hours_available: spendable.reduce((sum, p) => sum + p.hours_remaining, 0),
      hours_expiring_next: first ? { hours: first.hours_remaining, expires_at: first.expires_at } : null,
    },
  })
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MyPackagesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe('Dashboard packages page — buy section (B12)', () => {
  it('lists owned purchases and offers a buy button per available package', async () => {
    mine([activePurchase])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPage()

    expect(await screen.findByText(/7h restantes de 10h/)).toBeInTheDocument()
    const buyButtons = await screen.findAllByRole('button', { name: /Comprar Pack/i })
    expect(buyButtons).toHaveLength(2)
  })

  it('highlights the package carried over from sign-up via ?packageId', async () => {
    searchParams = new URLSearchParams('packageId=pkg-20h')
    mine([])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPage()

    const highlighted = (await screen.findByText('Pack 20h')).closest('.border-primary')
    expect(highlighted).not.toBeNull()
  })
})

describe('Packages page hours formatting (B30)', () => {
  it('renders whole hours without a decimal and fractions with a comma', async () => {
    mine([
      { ...activePurchase, id: 'whole', hours_remaining: 10, amount_paid: 100, hours_used: 0 },
      { ...activePurchase, id: 'frac', hours_remaining: 7.5, amount_paid: 100, hours_used: 2.5 },
    ])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    renderPage()
    expect(await screen.findByText(/10h restantes de 10h/)).toBeVisible()
    expect(screen.getByText(/7,5h restantes de 10h/)).toBeVisible()
    expect(screen.queryByText(/10\.0h/)).toBeNull()
  })
})

describe('Packages page — the hour bank (H02)', () => {
  it('shows one balance across packs and the slice that lapses first, then the history', async () => {
    mine([
      { ...activePurchase, id: 'later', hours_remaining: 10, hours_used: 0, expires_at: '2027-03-01T00:00:00Z' },
      { ...activePurchase, id: 'soon', hours_remaining: 2, hours_used: 8, expires_at: '2026-10-03T00:00:00Z' },
    ])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    renderPage()

    const bank = await screen.findByRole('region', { name: /banco de horas/i })
    expect(bank).toHaveTextContent(/12h disponíveis/)
    expect(bank).toHaveTextContent(/2h expiram a 3 de out\./)
    // The purchase history stays exactly as it was, below the bank.
    const history = screen.getByText(/10h restantes de 10h/)
    expect(bank.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(/2h restantes de 10h/)).toBeVisible()
  })

  it('says the bank is empty and names nothing as expiring when there is nothing to spend', async () => {
    mine([{ ...activePurchase, hours_remaining: 0, hours_used: 10 }])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    renderPage()
    const bank = await screen.findByRole('region', { name: /banco de horas/i })
    expect(bank).toHaveTextContent(/0h disponíveis/)
    expect(bank).not.toHaveTextContent(/expira/)
  })

  it('trusts the API balance over its own sum', async () => {
    // A lapsed hold's hours the client cannot see yet: the server's number wins.
    mine([activePurchase], { hours_available: 9, hours_expiring_next: { hours: 9, expires_at: activePurchase.expires_at } })
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    renderPage()
    expect(await screen.findByRole('region', { name: /banco de horas/i })).toHaveTextContent(/9h disponíveis/)
  })
})
