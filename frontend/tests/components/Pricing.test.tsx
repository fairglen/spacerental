import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Pricing } from '@/components/landing/Pricing'
import { spacesApi, packagesApi } from '@/lib/api'
import type { Package, Space } from '@/types'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  spacesApi: { list: vi.fn() },
  packagesApi: { list: vi.fn(), purchase: vi.fn() },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const space = { id: 'space-1', org_id: 'org-1' } as Space
const pack10: Package = {
  id: 'pkg-10h', org_id: 'org-1', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true,
}
const pack20: Package = {
  id: 'pkg-20h', org_id: 'org-1', name: 'Pack 20h', hours: 20, price: 190, validity_days: 365, is_active: true,
}

function renderPricing() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <Pricing />
    </QueryClientProvider>,
  )
}

describe('Pricing CTA (B12)', () => {
  it('the hourly plan always links to /spaces, no purchase flow involved', async () => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    vi.mocked(spacesApi.list).mockResolvedValue([space])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPricing()

    const link = await screen.findByRole('link', { name: /Reservar Agora/i })
    expect(link).toHaveAttribute('href', '/spaces')
  })

  it('signed-out visitors get sent to sign-up with the chosen package id preserved', async () => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    vi.mocked(spacesApi.list).mockResolvedValue([space])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPricing()

    const packLinks = await screen.findAllByRole('link', { name: /Comprar Pack/i })
    expect(packLinks).toHaveLength(2)
    expect(packLinks[0]).toHaveAttribute('href', `/sign-up?packageId=${pack10.id}`)
    expect(packLinks[1]).toHaveAttribute('href', `/sign-up?packageId=${pack20.id}`)
  })

  it('signed-in visitors get a real buy button instead of a sign-up redirect', async () => {
    vi.mocked(useSession).mockReturnValue({
      data: { accessToken: 'jwt-token', user: { name: 'Demo' } } as any,
      status: 'authenticated',
    } as any)
    vi.mocked(spacesApi.list).mockResolvedValue([space])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10, pack20])
    renderPricing()

    const packButtons = await screen.findAllByRole('button', { name: /Comprar Pack/i })
    expect(packButtons).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /Comprar Pack/i })).not.toBeInTheDocument()
  })
})
