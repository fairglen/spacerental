import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BookingSheet } from '@/components/admin/calendar/BookingSheet'
import { MoveConfirm } from '@/components/admin/calendar/MoveConfirm'
import { adminApi } from '@/lib/api'
import type { Booking, Room } from '@/types'

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/lib/api', () => ({
  adminApi: {
    updateBooking: vi.fn(), updateBookingDetails: vi.fn(), markBookingPaid: vi.fn(), getSupportRequests: vi.fn(),
  },
}))

const rooms: Room[] = [
  { id: 'r-a', space_id: 's', org_id: 'o', name: 'Sala Calma', description: '', capacity: 4, hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true },
  { id: 'r-b', space_id: 's', org_id: 'o', name: 'Sala Brisa', description: '', capacity: 4, hourly_rate: 11, images: [], amenities: [], color: '#B8D4E8', is_active: true },
]
const booking: Booking = {
  id: 'b-1', org_id: 'o', room_id: 'r-a', user_id: 'u-1', start_time: '2030-01-07T10:00:00Z', end_time: '2030-01-07T12:00:00Z',
  duration_hours: 2, total_amount: 22, package_hours_used: 0, status: 'confirmed', payment_method: 'hourly', notes: 'traz o meu próprio material',
  admin_note: 'cliente habitual', access_code: '123456', created_at: '', room: rooms[0],
  user: { id: 'u-1', email: 'ana@example.com', name: 'Ana' },
}

function renderSheet(b: Booking = booking, onChanged = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <BookingSheet booking={b} rooms={rooms} onClose={onClose} onChanged={onChanged} />
    </QueryClientProvider>,
  )
  return { onChanged, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getSupportRequests).mockResolvedValue({ requests: [], total: 0, page: 1, page_size: 20 })
})

describe('BookingSheet — what it shows', () => {
  it('customer, time, room, status, payment, code, notes, and a link to the customer page', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: /reserva/i })
    expect(within(sheet).getByText('Ana')).toBeVisible()
    expect(within(sheet).getByRole('link', { name: /ana@example\.com/ })).toHaveAttribute('href', '/admin/users/u-1')
    expect(within(sheet).getByText('Sala Calma')).toBeVisible()
    expect(within(sheet).getByText(/10:00/)).toBeVisible()
    expect(within(sheet).getByText('Confirmado')).toBeVisible()
    expect(within(sheet).getByText(/22,00\s€/)).toBeVisible()
    expect(within(sheet).getByText('123456')).toBeVisible()
    expect(within(sheet).getByText(/traz o meu próprio material/)).toBeVisible()
    expect(within(sheet).getByDisplayValue('cliente habitual')).toBeInTheDocument()
  })

  it('shows the pack share of a mixed booking and "Pago no local" for a manual one', () => {
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><BookingSheet booking={{ ...booking, payment_method: 'mixed', package_hours_used: 1, total_amount: 11 }} rooms={rooms} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText(/1h do pack \+ 11,00\s€/)).toBeVisible()
    unmount()
    render(<QueryClientProvider client={new QueryClient()}><BookingSheet booking={{ ...booking, payment_method: 'manual' }} rooms={rooms} onClose={vi.fn()} onChanged={vi.fn()} /></QueryClientProvider>)
    expect(screen.getByText(/Pago no local/)).toBeVisible()
  })
})

describe('BookingSheet — actions', () => {
  it('Confirmar on a pending booking', async () => {
    vi.mocked(adminApi.updateBooking).mockResolvedValue({ ...booking, status: 'confirmed' })
    const { onChanged } = renderSheet({ ...booking, status: 'pending' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(adminApi.updateBooking).toHaveBeenCalledWith('b-1', 'confirmed', expect.anything()))
    expect(onChanged).toHaveBeenCalled()
  })

  it('Marcar como pago asks for a reason and sends it', async () => {
    vi.mocked(adminApi.markBookingPaid).mockResolvedValue({ ...booking, status: 'confirmed', payment_method: 'manual' })
    const user = userEvent.setup()
    renderSheet({ ...booking, status: 'pending', hold_expires_at: '2030-01-01T00:00:00Z' })
    await user.click(screen.getByRole('button', { name: 'Marcar como pago' }))
    const submit = screen.getByRole('button', { name: 'Confirmar pagamento' })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/Motivo/), 'Pagou por MB WAY')
    await user.click(submit)
    await waitFor(() => expect(adminApi.markBookingPaid).toHaveBeenCalledWith('b-1', 'Pagou por MB WAY', expect.anything()))
  })

  it('Cancelar needs a reason and a confirm step', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({ booking: { ...booking, status: 'cancelled' }, hours: undefined })
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Cancelar reserva' }))
    expect(adminApi.updateBookingDetails).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Motivo do cancelamento/), 'Cliente pediu')
    await user.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith(
      'b-1', expect.objectContaining({ status: 'cancelled', admin_note: expect.stringContaining('Cliente pediu') }), expect.anything(),
    ))
  })

  it('Alterar horário sends the new time and room and reports the hours', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({
      booking: { ...booking, room_id: 'r-b', end_time: '2030-01-07T13:00:00Z', duration_hours: 3 }, hours: { before: 2, after: 3 },
    })
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Alterar horário' }))
    await user.selectOptions(screen.getByLabelText(/^Sala/), 'r-b')
    fireEvent.change(screen.getByLabelText(/Fim/), { target: { value: '13:00' } })
    await user.click(screen.getByRole('button', { name: 'Guardar horário' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalled())
    const [, body] = vi.mocked(adminApi.updateBookingDetails).mock.calls[0]
    expect(body.room_id).toBe('r-b')
    expect(body.end_time).toBe('2030-01-07T13:00:00.000Z')
    expect(await screen.findByRole('status')).toHaveTextContent(/2h → 3h/)
    expect(screen.getByRole('status')).toHaveTextContent(/fora da plataforma/)
  })

  it('shows the API error inline when a move conflicts', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockRejectedValue({ response: { status: 409, data: { detail: 'This time slot is already booked' } } })
    const user = userEvent.setup()
    renderSheet()
    await user.click(screen.getByRole('button', { name: 'Alterar horário' }))
    fireEvent.change(screen.getByLabelText(/Início/), { target: { value: '15:00' } })
    await user.click(screen.getByRole('button', { name: 'Guardar horário' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/já está reservado/)
  })

  it('Guardar nota', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({ booking: { ...booking, admin_note: 'nova nota' }, hours: undefined })
    const user = userEvent.setup()
    renderSheet()
    const note = screen.getByLabelText(/Nota interna/)
    await user.clear(note)
    await user.type(note, 'nova nota')
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith('b-1', { admin_note: 'nova nota' }, expect.anything()))
  })

  it('lists linked support requests', async () => {
    vi.mocked(adminApi.getSupportRequests).mockResolvedValue({
      requests: [{ id: 'q1', reference: 'ABCD1234', category: 'payment', status: 'new', contact_email: 'ana@example.com', user_id: 'u-1', booking_id: 'b-1', booking: null, message: 'dúvida', context: {}, created_at: '2030-01-01T00:00:00Z', updated_at: '' }],
      total: 1, page: 1, page_size: 20,
    })
    renderSheet()
    expect(await screen.findByRole('link', { name: /#ABCD1234/ })).toHaveAttribute('href', '/admin/support')
  })
})

describe('MoveConfirm — never optimistic', () => {
  const proposal = { booking, room: rooms[1], start: new Date('2030-01-07T14:00:00Z'), end: new Date('2030-01-07T16:00:00Z') }

  it('describes the move and only calls the API on confirm', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<MoveConfirm proposal={proposal} onConfirm={onConfirm} onCancel={onCancel} />)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Mover para Sala Brisa/)
    expect(dialog).toHaveTextContent(/14:00–16:00/)
    // Named when known: the operator is told WHO gets the email.
    expect(dialog).toHaveTextContent(/Ana recebe um email/)
    expect(onConfirm).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Mover' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancelling does nothing, and so does Escape', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<MoveConfirm proposal={proposal} onConfirm={onConfirm} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Não mover' }))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('says when only the end changes (a resize) and mentions the hour count', () => {
    render(<MoveConfirm proposal={{ ...proposal, room: rooms[0], start: new Date('2030-01-07T10:00:00Z'), end: new Date('2030-01-07T13:00:00Z') }} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(/Alterar para .*10:00–13:00/)
    expect(dialog).toHaveTextContent(/2h → 3h/)
  })

  it('shows the API refusal inline instead of closing', async () => {
    const onConfirm = vi.fn().mockRejectedValue({ response: { status: 409, data: { detail: 'This time slot is already booked' } } })
    render(<MoveConfirm proposal={proposal} onConfirm={onConfirm} onCancel={vi.fn()} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Mover' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/já está reservado/)
    expect(screen.getByRole('alertdialog')).toBeVisible()
  })
})
