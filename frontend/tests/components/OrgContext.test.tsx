import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrgProvider, useOrg } from '@/contexts/OrgContext'
import { authApi } from '@/lib/api'

// B22: the admin layout redirects on the first render where memberships are
// known but no current membership is resolved. The current org must therefore
// be derived synchronously from memberships, never in a later effect.

const memberships = [
  { org_id: 'org-a', role: 'owner' as const },
  { org_id: 'org-b', role: 'member' as const },
]

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'jwt', user: { id: 'u1' }, memberships },
    status: 'authenticated',
  }),
}))

vi.mock('@/lib/hooks/useAuthInstance', () => ({ useAuthInstance: () => ({}) }))

vi.mock('@/lib/api', () => ({
  authApi: { getMemberships: vi.fn() },
}))

const renders: Array<{ currentOrgId: string | null; membershipsCount: number; isLoading: boolean }> = []

function Probe() {
  const { currentOrgId, memberships, isLoading, setCurrentOrgId } = useOrg()
  renders.push({ currentOrgId, membershipsCount: memberships.length, isLoading })
  return (
    <div>
      <span data-testid="current">{currentOrgId ?? 'none'}</span>
      <button onClick={() => setCurrentOrgId('org-b')}>switch</button>
    </div>
  )
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgProvider>
        <Probe />
      </OrgProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  renders.length = 0
  window.localStorage.clear()
  // Never resolves: the session memberships alone must be enough.
  vi.mocked(authApi.getMemberships).mockReturnValue(new Promise(() => {}))
})

describe('OrgProvider (B22)', () => {
  it('never renders loaded memberships without a current org', () => {
    renderProvider()
    const inconsistent = renders.filter((r) => r.membershipsCount > 0 && r.currentOrgId === null)
    expect(inconsistent).toEqual([])
    expect(screen.getByTestId('current')).toHaveTextContent('org-a')
  })

  it('prefers a valid stored selection over the highest role', () => {
    window.localStorage.setItem('spacerental:selected_org_id', 'org-b')
    renderProvider()
    expect(renders.filter((r) => r.membershipsCount > 0 && r.currentOrgId === null)).toEqual([])
    expect(screen.getByTestId('current')).toHaveTextContent('org-b')
  })

  it('ignores a stored selection the user is no longer a member of', () => {
    window.localStorage.setItem('spacerental:selected_org_id', 'org-gone')
    renderProvider()
    expect(screen.getByTestId('current')).toHaveTextContent('org-a')
  })

  it('persists an explicit switch', () => {
    renderProvider()
    act(() => screen.getByText('switch').click())
    expect(screen.getByTestId('current')).toHaveTextContent('org-b')
    expect(window.localStorage.getItem('spacerental:selected_org_id')).toBe('org-b')
  })
})
