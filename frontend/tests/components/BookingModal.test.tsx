import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingModal } from '@/components/booking/BookingModal'
import { bookingsApi, recurrencesApi, packagesApi } from '@/lib/api'
import type { Booking, Room, RecurrenceWithBookings, UserPackagePurchase } from '@/types'

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
  recurrencesApi: { create: vi.fn() },
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
  vi.stubEnv('NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED', 'false')
  // Default: no packages, so the hourly path is what renders unless a test
  // says otherwise.
  vi.mocked(packagesApi.listMine).mockResolvedValue([])
  // jsdom refuses real navigation; the component only needs location.assign.
  vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost:3000/spaces/space-1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
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

  it('keeps a package booking slot conflict distinct from insufficient hours', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    vi.mocked(bookingsApi.create).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { detail: 'This time slot is already booked' } },
      }),
    )
    const user = userEvent.setup()
    renderModal()
    await screen.findByRole('radio', { name: /5h disponíveis/i })
    await user.click(screen.getByRole('button', { name: /Confirmar Reserva/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/horário já está reservado/i)
    expect(alert).not.toHaveTextContent(/horas suficientes/i)
  })
})

const recurrenceResult: RecurrenceWithBookings = {
  recurrence: {
    id: 'rule-1',
    org_id: 'org-1',
    room_id: room.id,
    user_id: 'user-1',
    frequency: 'weekly',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    until_date: '2026-08-24',
    notes: null,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  bookings: [pendingBooking],
}

describe('BookingModal recurring series (Epic 1.4)', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED', 'true'))
  it('shows the until-date field and a dated preview once "repeat weekly" is toggled', async () => {
    const user = userEvent.setup()
    renderModal()

    expect(screen.queryByLabelText(/Repetir até/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/Repetir semanalmente/i))
    const untilInput = screen.getByLabelText(/Repetir até/i)
    fireEvent.change(untilInput, { target: { value: '2026-08-24' } })

    // start = 2026-08-10T09:00Z on a Monday; weekly until 2026-08-24 → 3 occurrences.
    expect(await screen.findByText(/Datas a criar \(3\)/i)).toBeInTheDocument()
  })

  it('disables submit while repeating is on but no valid until date is picked yet', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByLabelText(/Repetir semanalmente/i))
    expect(screen.getByRole('button', { name: /Confirmar Série/i })).toBeDisabled()
  })

  it('creates a pending series and requires acknowledgement without charging a pack', async () => {
    vi.mocked(recurrencesApi.create).mockResolvedValue(recurrenceResult)
    vi.mocked(packagesApi.listMine).mockResolvedValue([purchase(5)])
    const onClose = vi.fn()
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookingModal room={room} start={start} end={end} onClose={onClose} />
      </QueryClientProvider>,
    )

    await user.click(screen.getByLabelText(/Repetir semanalmente/i))
    fireEvent.change(screen.getByLabelText(/Repetir até/i), { target: { value: '2026-08-24' } })
    await user.click(screen.getByRole('button', { name: /Confirmar Série/i }))

    await waitFor(() => expect(recurrencesApi.create).toHaveBeenCalledWith(
      {
        room_id: room.id,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        until_date: '2026-08-24',
      },
      expect.anything(),
    ))
    expect(bookingsApi.create).not.toHaveBeenCalled()
    expect(await screen.findByRole('status')).toHaveTextContent(/1 reservas pendentes/)
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalled()
    expect(assign).not.toHaveBeenCalled()
  })

  it('lists conflicting dates inline on a 409 instead of the generic error', async () => {
    vi.mocked(recurrencesApi.create).mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: {
          status: 409,
          data: {
            detail: 'Some occurrences in this series are already booked',
            conflicts: ['2026-08-17T09:00:00Z'],
          },
        },
      }),
    )
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByLabelText(/Repetir semanalmente/i))
    fireEvent.change(screen.getByLabelText(/Repetir até/i), { target: { value: '2026-08-24' } })
    await user.click(screen.getByRole('button', { name: /Confirmar Série/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/já estão reservadas/i)
    expect(alert).toHaveTextContent(/17 de agosto de 2026/i)
    expect(alert).not.toHaveTextContent(/Erro ao criar reserva/i)
  })
})

it('hides experimental recurrence by default', () => {
  renderModal()
  expect(screen.queryByLabelText(/Repetir semanalmente/i)).not.toBeInTheDocument()
})
