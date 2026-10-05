import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { OrgProvider, useOrg } from '@/contexts/OrgContext'
import { authApi } from '@/lib/api'

// P1.4: a session with exactly one membership — the customer's case — is
// enough on its own: no /auth/memberships request on every page load.
const memberships = [{ org_id: 'org-a', role: 'member' as const }]

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

function Probe() {
  const { currentOrgId, currentMembership, isLoading } = useOrg()
  return (
    <div>
      <span data-testid="current">{currentOrgId ?? 'none'}</span>
      <span data-testid="role">{currentMembership?.role ?? 'none'}</span>
      <span data-testid="loading">{String(isLoading)}</span>
    </div>
  )
}

describe('OrgProvider with one membership in the session (P1.4)', () => {
  it('resolves the organisation and the role from the session and asks the API for nothing', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <OrgProvider>
          <Probe />
        </OrgProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('current')).toHaveTextContent('org-a')
    expect(screen.getByTestId('role')).toHaveTextContent('member')
    expect(screen.getByTestId('loading')).toHaveTextContent('false')
    await new Promise((r) => setTimeout(r, 20))
    expect(authApi.getMemberships).not.toHaveBeenCalled()
  })
})
