import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminSpacesPage from '@/app/admin/spaces/page'
import { adminApi } from '@/lib/api'

// B7: admin pages must refetch (not serve stale cache) when the selected org
// changes, because useApi() attaches org_id as an axios default param — the
// only place org_id enters these requests. If the query key doesn't include
// currentOrgId, React Query happily serves the previous org's cached data.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))

const mockUseOrg = vi.fn()
vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => mockUseOrg(),
}))

vi.mock('@/lib/hooks/useApi', () => ({
  useApi: () => ({}),
}))

vi.mock('@/lib/api', () => ({
  adminApi: {
    getSpaces: vi.fn().mockResolvedValue([]),
    updateSpace: vi.fn(),
  },
}))

function setOrg(orgId: string | null) {
  mockUseOrg.mockReturnValue({
    currentOrgId: orgId,
    memberships: [],
    currentMembership: null,
    setCurrentOrgId: vi.fn(),
    isLoading: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Admin org-switch cache behavior (B7)', () => {
  it('does not fetch while no org is selected yet', async () => {
    setOrg(null)
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <AdminSpacesPage />
      </QueryClientProvider>,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(adminApi.getSpaces).not.toHaveBeenCalled()
  })

  it('refetches instead of serving stale cache when the admin switches org', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    setOrg('org-1')
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AdminSpacesPage />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(adminApi.getSpaces).toHaveBeenCalledTimes(1))

    setOrg('org-2')
    rerender(
      <QueryClientProvider client={queryClient}>
        <AdminSpacesPage />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(adminApi.getSpaces).toHaveBeenCalledTimes(2))
  })
})
