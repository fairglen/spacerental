import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { PackageBuyButton } from '@/components/packages/PackageBuyButton'
import { packagesApi } from '@/lib/api'
import type { Package, UserPackagePurchase } from '@/types'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  packagesApi: { purchase: vi.fn() },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const pkg: Package = {
  id: 'pkg-10h',
  org_id: 'org-1',
  name: 'Pack 10h',
  hours: 10,
  price: 100,
  validity_days: 365,
  is_active: true,
}

const pendingPurchase: UserPackagePurchase = {
  id: 'purchase-1',
  user_id: 'user-1',
  package_id: pkg.id,
  org_id: pkg.org_id,
  hours_total: 10,
  hours_used: 0,
  hours_remaining: 10,
  status: 'pending',
  purchased_at: new Date().toISOString(),
  expires_at: new Date().toISOString(),
}

const CHECKOUT_URL = 'https://checkout.stripe.stub/cs_stub_deadbeef'
const assign = vi.fn()

function renderButton() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PackageBuyButton pkg={pkg} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost:3000/' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PackageBuyButton — signed in', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: { accessToken: 'jwt-token', user: { id: 'user-1', email: 'admin@demo.com', name: 'Demo Admin' }, role: 'member', memberships: [], expires: '2099-01-01' },
      update: vi.fn(),
      status: 'authenticated',
    })
  })

  it('purchases the package and follows the Checkout URL (B12)', async () => {
    vi.mocked(packagesApi.purchase).mockResolvedValue({ purchase: pendingPurchase, checkout_url: CHECKOUT_URL })
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: /Comprar Pack/i }))

    expect(packagesApi.purchase).toHaveBeenCalledWith(pkg.id, pkg.org_id, {})
    await waitFor(() => expect(assign).toHaveBeenCalledWith(CHECKOUT_URL))
  })

  it('handles an invalid backend token while the browser session is active, preserving the selected pack', async () => {
    vi.mocked(packagesApi.purchase).mockRejectedValue({ response: { status: 401, data: { detail: 'Could not validate credentials' } } })
    const user = userEvent.setup()
    renderButton()
    await user.click(screen.getByRole('button', { name: /Comprar Pack/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/sessão deixou de ser válida/)
    expect(screen.getByRole('link', { name: 'Entrar e continuar a compra' })).toHaveAttribute('href', `/sign-in?packageId=${pkg.id}`)
    expect(screen.queryByRole('button', { name: /Comprar Pack/i })).not.toBeInTheDocument()
    expect(packagesApi.purchase).toHaveBeenCalledTimes(1)
    expect(assign).not.toHaveBeenCalled()
  })

  it('surfaces a 403 as a membership error', async () => {
    vi.mocked(packagesApi.purchase).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 403'), {
        response: { status: 403, data: { detail: 'You are not a member of this organization' } },
      }),
    )
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: /Comprar Pack/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não tem acesso/i)
    expect(assign).not.toHaveBeenCalled()
  })

  it('keeps the generic error for failures that are not membership issues', async () => {
    vi.mocked(packagesApi.purchase).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 502'), {
        response: { status: 502, data: {} },
      }),
    )
    const user = userEvent.setup()
    renderButton()

    await user.click(screen.getByRole('button', { name: /Comprar Pack/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Erro ao iniciar a compra/i)
  })
})

describe('PackageBuyButton — signed out', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() })
  })

  it('links to sign-up with the package id preserved instead of purchasing (B12)', () => {
    renderButton()

    const link = screen.getByRole('link', { name: /Comprar Pack/i })
    expect(link).toHaveAttribute('href', `/sign-up?packageId=${pkg.id}`)
    expect(packagesApi.purchase).not.toHaveBeenCalled()
  })
})
