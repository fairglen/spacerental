import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminBookingsPage from '@/app/admin/bookings/page'
import { adminApi } from '@/lib/api'

// The list keeps its page in the URL (G05); switching to a smaller
// organisation must still go back to page one, or the operator would look at
// a page that does not exist there.
const org = vi.hoisted(() => ({ id: 'large-org' }))
const nav = vi.hoisted(() => ({ params: new URLSearchParams('page=3'), replace: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'jwt' } }) }))
vi.mock('@/contexts/OrgContext', () => ({ useOrg: () => ({ currentOrgId: org.id }) }))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({ orgId: org.id }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/bookings',
  useSearchParams: () => nav.params,
}))
vi.mock('@/lib/api', () => ({ adminApi: {
  getBookings: vi.fn(async ({ page, page_size }, api) => ({
    bookings: [], total: api.orgId === 'large-org' ? 60 : 1, page, page_size,
  })),
  getSpaces: vi.fn(async () => []),
} }))

describe('admin bookings organization changes', () => {
  it('requests page one after switching from a later page to a smaller organization', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = () => <QueryClientProvider client={client}><AdminBookingsPage /></QueryClientProvider>
    const { rerender } = render(view())
    await waitFor(() => expect(adminApi.getBookings).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }), { orgId: 'large-org' }))
    await screen.findByText(/página 3 de 3/)
    vi.mocked(adminApi.getBookings).mockClear()
    org.id = 'small-org'
    rerender(view())
    // The page is reset through the URL, which the harness echoes back.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/admin/bookings', { scroll: false }))
    nav.params = new URLSearchParams()
    rerender(view())
    await waitFor(() => expect(adminApi.getBookings).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }), { orgId: 'small-org' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Seguinte/ })).not.toBeInTheDocument())
  })
})
