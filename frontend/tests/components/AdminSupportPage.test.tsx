import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminSupportPage from '@/app/admin/support/page'
import { adminApi } from '@/lib/api'
import type { SupportRequestRow } from '@/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))
vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/lib/api', () => ({ adminApi: { getSupportRequests: vi.fn(), updateSupportRequest: vi.fn() } }))

const row = (id: string, overrides: Partial<SupportRequestRow> = {}): SupportRequestRow => ({
  id, reference: id.slice(0, 8).toUpperCase(), category: 'technical', status: 'new', contact_email: 'ana@example.com',
  user_id: 'u1', booking_id: null, booking: null,
  message: 'O calendário não carrega na primeira visita, só depois de recarregar a página inteira, e isto acontece sempre.',
  context: { page_url: 'http://localhost:3000/spaces', viewport: '390x844', user_agent: 'Mozilla/5.0 (test)', app_version: 'abc1234', timestamp: '2026-09-22T10:00:00Z' },
  created_at: '2026-09-22T10:00:00Z', updated_at: '2026-09-22T10:00:00Z', ...overrides,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><AdminSupportPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getSupportRequests).mockResolvedValue({
    requests: [
      row('11111111-aaaa', { category: 'payment', booking_id: 'b-1', booking: { id: 'b-1', start_time: '2026-10-01T09:00:00Z', room: { name: 'Sala Calma' } } as never }),
      row('22222222-bbbb', { status: 'closed', contact_email: 'rui@example.com' }),
    ],
    total: 2, page: 1, page_size: 20,
  })
})

describe('/admin/support (C19)', () => {
  it('lists requests with category, email, an excerpt, the linked booking and the status', async () => {
    renderPage()
    const rows = await screen.findAllByRole('row')
    const first = rows[1]
    expect(within(first).getByText('Pagamento')).toBeVisible()
    expect(within(first).getByText('ana@example.com')).toBeVisible()
    expect(within(first).getByText(/O calendário não carrega/)).toBeVisible()
    expect(within(first).getByText(/Sala Calma/)).toBeVisible()
    expect(within(first).getByText('Nova')).toBeVisible()
    expect(within(rows[2]).getByText('Fechada')).toBeVisible()
    expect(within(rows[2]).getByText('—')).toBeVisible()
  })

  it('shows the whole message and the context on request, escaped as text', async () => {
    vi.mocked(adminApi.getSupportRequests).mockResolvedValue({
      requests: [row('33333333-cccc', { message: '<img src=x onerror=alert(1)> ' + 'a'.repeat(200) })], total: 1, page: 1, page_size: 20,
    })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Ver pedido/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/<img src=x onerror=alert\(1\)>/)).toBeVisible()
    expect(dialog.querySelector('img')).toBeNull()
    expect(within(dialog).getByText(/390x844/)).toBeVisible()
    expect(within(dialog).getByText(/abc1234/)).toBeVisible()
  })

  it('toggles a request between new and closed', async () => {
    vi.mocked(adminApi.updateSupportRequest).mockResolvedValue(row('11111111-aaaa', { status: 'closed' }))
    const user = userEvent.setup()
    renderPage()
    const rows = await screen.findAllByRole('row')
    await user.click(within(rows[1]).getByRole('button', { name: /Marcar como fechada/ }))
    await waitFor(() => expect(adminApi.updateSupportRequest).toHaveBeenCalledWith('11111111-aaaa', 'closed', expect.anything()))
    await user.click(within(rows[2]).getByRole('button', { name: /Reabrir/ }))
    await waitFor(() => expect(adminApi.updateSupportRequest).toHaveBeenLastCalledWith('22222222-bbbb', 'new', expect.anything()))
  })

  it('filters by status', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByRole('row')
    await user.selectOptions(screen.getByLabelText(/Estado/), 'new')
    await waitFor(() => expect(vi.mocked(adminApi.getSupportRequests).mock.calls.at(-1)?.[0]).toMatchObject({ status: 'new' }))
  })

  it('says so when the inbox is empty', async () => {
    vi.mocked(adminApi.getSupportRequests).mockResolvedValue({ requests: [], total: 0, page: 1, page_size: 20 })
    renderPage()
    expect(await screen.findByText(/Sem pedidos/)).toBeVisible()
  })
})
