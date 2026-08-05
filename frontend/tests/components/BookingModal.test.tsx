import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingModal } from '@/components/booking/BookingModal'
import { bookingsApi } from '@/lib/api'
import type { Booking, Room } from '@/types'

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

beforeEach(() => {
  vi.clearAllMocks()
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
