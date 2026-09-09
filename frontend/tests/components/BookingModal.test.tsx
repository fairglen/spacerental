import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingModal } from '@/components/booking/BookingModal'
import { bookingsApi, packagesApi } from '@/lib/api'
import type { Booking, Room, UserPackagePurchase } from '@/types'

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { accessToken: 'jwt-token', user: { name: 'Demo Admin' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  bookingsApi: { create: vi.fn() },
  packagesApi: { listMine: vi.fn() },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const room: Room = {
  id: 'room-1',
  space_id: 'space-1',
  org_id: 'org-1',
  name: 'Sala Calma',
  description: '',
  capacity: 6,
  hourly_rate: 11,
  images: [],
  amenities: [],
  color: '#A8D5BA',
  is_active: true,
}

const start = new Date('2026-08-10T09:00:00Z')
const end = new Date('2026-08-10T12:00:00Z')

const pendingBooking: Booking = {
  id: 'booking-1',
  org_id: 'org-1',
  room_id: room.id,
  user_id: 'user-1',
  start_time: start.toISOString(),
  end_time: end.toISOString(),
  duration_hours: 3,
  total_amount: 33,
  status: 'pending',
  payment_method: 'hourly',
  created_at: new Date().toISOString(),
}

const CHECKOUT_URL = 'https://checkout.stripe.stub/cs_stub_deadbeef'

const assign = vi.fn()

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BookingModal room={room} start={start} end={end} onClose={vi.fn()} />
    </QueryClientProvider>,
  )
}

/** An active purchase in the room's org with `hours` left, expiring next year. */
function purchase(hours: number, overrides: Partial<UserPackagePurchase> = {}): UserPackagePurchase {
  return {
    id: 'purchase-1',
    user_id: 'user-1',
    package_id: 'package-1',
    org_id: 'org-1',
    hours_total: 10,
    hours_used: 10 - hours,
    hours_remaining: hours,
    status: 'active',
    purchased_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    expires_at: new Date('2027-01-01T00:00:00Z').toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no packages, so the hourly path is what renders unless a test
  // says otherwise.
  vi.mocked(packagesApi.listMine).mockResolvedValue([])
  // jsdom refuses real navigation; the component only needs location.assign.
  vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost:3000/spaces/space-1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BookingModal checkout', () => {
  it('sends the user to the Stripe Checkout URL on success (B4)', async () => {
    vi.mocked(bookingsApi.create).mockResolvedValue({
      booking: pendingBooking,
      checkout_url: CHECKOUT_URL,
    })
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith(CHECKOUT_URL))
  })

  it('surfaces a 409 as a slot conflict rather than the generic error (B1)', async () => {
    vi.mocked(bookingsApi.create).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { detail: 'This time slot is already booked' } },
      }),
    )
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/já (está|foi) reservad/i)
    expect(alert).not.toHaveTextContent(/Erro ao criar reserva/i)
    expect(assign).not.toHaveBeenCalled()
  })

  it('keeps the generic error for failures that are not conflicts', async () => {
    vi.mocked(bookingsApi.create).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500, data: {} },
      }),
    )
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/Erro ao criar reserva/i)
  })
})

describe('BookingModal package redemption (Epic 2.4)', () => {
  const confirmedBooking: Booking = {
    ...pendingBooking,
    status: 'confirmed',
    payment_method: 'package',
  }

  it('offers no payment choice when the user has no usable hours', async () => {
    renderModal()

    await waitFor(() => expect(packagesApi.listMine).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: /pack/i })).not.toBeInTheDocument()
  })

  it('offers the pack once the user has enough hours for the whole block', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    renderModal()

    // 3h block against 5h remaining.
    expect(await screen.findByRole('radio', { name: /5h disponíveis/i })).toBeChecked()
  })

  it('hides the pack when the remaining hours cannot cover the block', async () => {
    // 2h left, 3h block — the backend would 409, so never offer it.
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(2)])
    renderModal()

    await waitFor(() => expect(packagesApi.listMine).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: /pack/i })).not.toBeInTheDocument()
  })

  it.each([
    ['pending' as const],
    ['cancelled' as const],
  ])('hides the pack for a %s purchase', async status => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5, { status })])
    renderModal()

    await waitFor(() => expect(packagesApi.listMine).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: /pack/i })).not.toBeInTheDocument()
  })

  it('hides the pack once it has expired', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([
      purchase(5, { expires_at: new Date('2020-01-01T00:00:00Z').toISOString() }),
    ])
    renderModal()

    await waitFor(() => expect(packagesApi.listMine).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: /pack/i })).not.toBeInTheDocument()
  })

  it("hides the pack when it belongs to another org", async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5, { org_id: 'org-2' })])
    renderModal()

    await waitFor(() => expect(packagesApi.listMine).toHaveBeenCalled())
    expect(screen.queryByRole('radio', { name: /pack/i })).not.toBeInTheDocument()
  })

  it('books with payment_method package and closes without a redirect', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    vi.mocked(bookingsApi.create).mockResolvedValue({
      booking: confirmedBooking,
      checkout_url: null,
    })
    const onClose = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingModal room={room} start={start} end={end} onClose={onClose} />
      </QueryClientProvider>,
    )
    const user = userEvent.setup()

    await screen.findByRole('radio', { name: /5h disponíveis/i })
    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    await waitFor(() =>
      expect(bookingsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_method: 'package' }),
        expect.anything(),
      ),
    )
    // Nothing left to pay, so the user is not sent to Checkout.
    expect(assign).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('still goes to Checkout when the user picks hourly despite having a pack', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    vi.mocked(bookingsApi.create).mockResolvedValue({
      booking: pendingBooking,
      checkout_url: CHECKOUT_URL,
    })
    const user = userEvent.setup()
    renderModal()

    await user.click(await screen.findByRole('radio', { name: /Pagar/i }))
    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    await waitFor(() =>
      expect(bookingsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_method: 'hourly' }),
        expect.anything(),
      ),
    )
    expect(assign).toHaveBeenCalledWith(CHECKOUT_URL)
  })

  it('reads a 409 on the package path as missing hours, not a taken slot', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    vi.mocked(bookingsApi.create).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { detail: 'No active package with 3 hours remaining' } },
      }),
    )
    const user = userEvent.setup()
    renderModal()

    await screen.findByRole('radio', { name: /5h disponíveis/i })
    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/horas suficientes/i)
    expect(alert).not.toHaveTextContent(/horário já está reservado/i)
  })
})
