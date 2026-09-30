import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminPackagePage from '@/app/admin/packages/[id]/page'
import { adminApi } from '@/lib/api'
import type { Package } from '@/types'

// B9: packages can be edited and deactivated after creation.

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
  usePathname: () => '/admin/packages/pkg-1',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ id: 'pkg-1' }),
}))

vi.mock('@/lib/api', () => ({
  adminApi: {
    getPackages: vi.fn(),
    getPackage: vi.fn(),
    createPackage: vi.fn(),
    updatePackage: vi.fn(),
    deletePackage: vi.fn(),
    getHistory: vi.fn(),
  },
}))

const pkg: Package = {
  id: 'pkg-1',
  org_id: 'org-1',
  name: '10h Pack',
  hours: 10,
  price: 100,
  validity_days: 365,
  is_active: true,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPackagePage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getPackages).mockResolvedValue([pkg])
})

describe('package page (G06): edit and take off sale', () => {
  it('opens pre-filled with the package and submits an update', async () => {
    vi.mocked(adminApi.getPackage).mockResolvedValue({ package: pkg, purchases: { total: 2, active: 1 }, hours_outstanding: 7.5 })
    vi.mocked(adminApi.updatePackage).mockResolvedValue({ ...pkg, price: 90 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: /10h Pack/ })
    await waitFor(() => expect(screen.getByLabelText('Preço (€)')).toHaveValue(100))
    expect(screen.getByText(/2 compra\(s\), 1 com horas por gastar · 7,5h em aberto/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Preço (€)'))
    await user.type(screen.getByLabelText('Preço (€)'), '90')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(adminApi.updatePackage).toHaveBeenCalledWith('pkg-1', expect.objectContaining({ price: 90, name: '10h Pack' }), expect.anything()))
  })

  it('takes a package off sale from the danger zone', async () => {
    vi.mocked(adminApi.getPackage).mockResolvedValue({ package: pkg, purchases: { total: 2, active: 1 }, hours_outstanding: 7.5 })
    vi.mocked(adminApi.updatePackage).mockResolvedValue({ ...pkg, is_active: false })
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { level: 1, name: /10h Pack/ })
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(adminApi.updatePackage).toHaveBeenCalledWith('pkg-1', { is_active: false }, expect.anything()))
    // The hard delete needs the name typed; a purchased pack is refused by the API, not the UI.
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeDisabled()
  })
})
