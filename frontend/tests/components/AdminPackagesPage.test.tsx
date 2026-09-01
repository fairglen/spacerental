import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminPackagesPage from '@/app/admin/packages/page'
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

vi.mock('@/lib/api', () => ({
  adminApi: {
    getPackages: vi.fn(),
    createPackage: vi.fn(),
    updatePackage: vi.fn(),
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
      <AdminPackagesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getPackages).mockResolvedValue([pkg])
})

describe('AdminPackagesPage edit/deactivate (B9)', () => {
  it('opens an edit dialog pre-filled with the package and submits an update', async () => {
    vi.mocked(adminApi.updatePackage).mockResolvedValue({ ...pkg, price: 90 })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Editar pacote' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByDisplayValue('10h Pack')).toBeInTheDocument()

    const priceInput = within(dialog).getByDisplayValue('100')
    await user.clear(priceInput)
    await user.type(priceInput, '90')
    await user.click(within(dialog).getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      expect(adminApi.updatePackage).toHaveBeenCalledWith(
        'pkg-1',
        expect.objectContaining({ price: 90, name: '10h Pack', hours: 10, validity_days: 365 }),
        expect.anything(),
      )
    })
  })

  it('deactivates an active package with a single click', async () => {
    vi.mocked(adminApi.updatePackage).mockResolvedValue({ ...pkg, is_active: false })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Desativar pacote' }))

    await waitFor(() => {
      expect(adminApi.updatePackage).toHaveBeenCalledWith('pkg-1', { is_active: false }, expect.anything())
    })
  })
})
