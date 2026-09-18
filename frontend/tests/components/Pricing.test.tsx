import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { Pricing } from '@/components/landing/Pricing'
import { spacesApi, packagesApi } from '@/lib/api'
import type { Package, Room, Space } from '@/types'
import { beforeEach } from 'vitest'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  spacesApi: { list: vi.fn(), get: vi.fn() },
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

const room = (id: string, hourly_rate: number): Room => ({
  id, space_id: 'space-1', org_id: 'org-1', name: id, description: '', capacity: 4, hourly_rate,
  images: [], amenities: [], color: '#A8D5BA', is_active: true,
})

beforeEach(() => {
  vi.mocked(spacesApi.get).mockResolvedValue({ space, rooms: [room('a', 11), room('b', 11)] })
})

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

describe('Pricing renders what the API says (C06)', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    vi.mocked(spacesApi.list).mockResolvedValue([space])
  })

  it('shows each package with its own price, hours and validity, and savings from real numbers', async () => {
    vi.mocked(packagesApi.list).mockResolvedValue([
      { ...pack10, name: 'Pack Manhãs', hours: 8, price: 70, validity_days: 90 },
      { ...pack20, name: 'Pack Mensal', hours: 30, price: 330, validity_days: 30 },
    ])
    renderPricing()
    const morning = (await screen.findByRole('heading', { name: 'Pack Manhãs' })).closest('.rounded-xl') as HTMLElement
    expect(morning).toHaveTextContent('70,00')
    expect(morning).toHaveTextContent('8 horas')
    expect(morning).toHaveTextContent('90 dias')
    // 8h × 11 € = 88 € → saves 18 €
    expect(morning).toHaveTextContent(/18,00/)
    const monthly = (await screen.findByRole('heading', { name: 'Pack Mensal' })).closest('.rounded-xl') as HTMLElement
    expect(monthly).toHaveTextContent('330,00')
    // 30h × 11 € = 330 € → no saving, so no savings line at all
    expect(monthly).not.toHaveTextContent(/Poupa/)
    // No stale hard-coded packs survive.
    expect(screen.queryByText(/Pack 10 Horas|Pack 20 Horas/)).toBeNull()
  })

  it('takes the hourly price from the rooms', async () => {
    vi.mocked(spacesApi.get).mockResolvedValue({ space, rooms: [room('a', 12.5), room('b', 15)] })
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    renderPricing()
    const hourly = (await screen.findByRole('heading', { name: /Hora a Hora/i })).closest('.rounded-xl') as HTMLElement
    await waitFor(() => expect(hourly).toHaveTextContent('12,50'))
    expect(hourly).toHaveTextContent(/desde/i)
  })

  it('distinguishes an error (with retry) from having no packs', async () => {
    vi.mocked(packagesApi.list).mockRejectedValueOnce(new Error('boom')).mockResolvedValue([])
    renderPricing()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não foi possível/i)
    fireEvent.click(within(alert).getByRole('button', { name: /tentar novamente/i }))
    expect(await screen.findByText(/não há packs/i)).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('link', { name: /Comprar Pack/i })).toBeNull()
  })

  it('shows skeletons rather than numbers while loading', () => {
    vi.mocked(packagesApi.list).mockReturnValue(new Promise(() => {}))
    renderPricing()
    expect(screen.queryByText(/,00/)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent(/a carregar/i)
  })
})

describe('Pricing treats the rooms request as part of the load (review)', () => {
  it('shows the error state with a retry that refetches rooms when the rate fails to load', async () => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    vi.mocked(spacesApi.list).mockResolvedValue([space])
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    vi.mocked(spacesApi.get).mockClear()
    vi.mocked(spacesApi.get).mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ space, rooms: [room('a', 11)] })
    renderPricing()
    const alert = await screen.findByRole('alert')
    fireEvent.click(within(alert).getByRole('button', { name: /tentar novamente/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(spacesApi.get).toHaveBeenCalledTimes(2)
    const hourly = (await screen.findByRole('heading', { name: /Hora a Hora/i })).closest('.rounded-xl') as HTMLElement
    await waitFor(() => expect(hourly).toHaveTextContent('11,00'))
  })
})

describe('Pricing shares the landing page spaces cache (review)', () => {
  it('does not request /spaces again when SpaceCards already cached it', async () => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    vi.mocked(spacesApi.list).mockClear()
    vi.mocked(packagesApi.list).mockResolvedValue([pack10])
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    queryClient.setQueryData(['spaces'], [space])
    render(
      <QueryClientProvider client={queryClient}>
        <Pricing />
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: pack10.name })
    expect(spacesApi.list).not.toHaveBeenCalled()
  })
})
