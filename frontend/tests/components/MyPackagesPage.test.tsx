import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyPackagesPage from '@/app/dashboard/packages/page'
import { packagesApi } from '@/lib/api'
import type { Package, UserPackagePurchase } from '@/types'

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
  packagesApi: { listMine: vi.fn(), list: vi.fn(), purchase: vi.fn() },
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
  hours_remaining: 7,
  status: 'active',
  purchased_at: new Date().toISOString(),
  expires_at: new Date('2027-01-01').toISOString(),
  package: pack10,
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
    vi.mocked(packagesApi.listMine).mockResolvedValue([activePurchase])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPage()

    expect(await screen.findByText(/7\.0h restantes de 10h/)).toBeInTheDocument()
    const buyButtons = await screen.findAllByRole('button', { name: /Comprar Pack/i })
    expect(buyButtons).toHaveLength(2)
  })

  it('highlights the package carried over from sign-up via ?packageId', async () => {
    searchParams = new URLSearchParams('packageId=pkg-20h')
    vi.mocked(packagesApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPage()

    const highlighted = (await screen.findByText('Pack 20h')).closest('.border-primary')
    expect(highlighted).not.toBeNull()
  })
})
