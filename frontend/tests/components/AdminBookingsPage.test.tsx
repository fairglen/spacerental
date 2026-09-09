import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminBookingsPage from '@/app/admin/bookings/page'
import { adminApi } from '@/lib/api'

const org = vi.hoisted(() => ({ id: 'large-org' }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'jwt' } }) }))
vi.mock('@/contexts/OrgContext', () => ({ useOrg: () => ({ currentOrgId: org.id }) }))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({ orgId: org.id }) }))
vi.mock('@/lib/api', () => ({ adminApi: {
  getBookings: vi.fn(async ({ page, page_size }, api) => ({
    bookings: [], total: api.orgId === 'large-org' ? 60 : 1, page, page_size,
  })),
  updateBooking: vi.fn(),
} }))

describe('admin bookings organization changes', () => {
  it('requests page one after switching from a later page to a smaller organization', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const view = () => <QueryClientProvider client={client}><AdminBookingsPage /></QueryClientProvider>
    const { rerender } = render(view())
    await user.click(await screen.findByRole('button', { name: /Seguinte/ }))
    await screen.findByText('Página 2 de 3 · 60 reservas')
    await user.click(screen.getByRole('button', { name: /Seguinte/ }))
    await screen.findByText('Página 3 de 3 · 60 reservas')
    vi.mocked(adminApi.getBookings).mockClear()
    org.id = 'small-org'
    rerender(view())
    await waitFor(() => expect(adminApi.getBookings).toHaveBeenCalledWith(
      { page: 1, page_size: 20 }, { orgId: 'small-org' },
    ))
    expect(adminApi.getBookings).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('button', { name: /Seguinte/ })).not.toBeInTheDocument())
  })
})
