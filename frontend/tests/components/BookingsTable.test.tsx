import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BookingsTable } from '@/components/admin/BookingsTable'
import type { Booking } from '@/types'

function makeBooking(id: string, overrides: Partial<Booking> = {}): Booking {
  return {
    id,
    org_id: 'org-1',
    room_id: 'room-1',
    user_id: 'user-1',
    start_time: '2026-08-10T09:00:00Z',
    end_time: '2026-08-10T11:00:00Z',
    duration_hours: 2,
    total_amount: 22,
    status: 'confirmed',
    payment_method: 'hourly',
    created_at: '2026-08-01T00:00:00Z',
    room: { id: 'room-1', space_id: 'space-1', org_id: 'org-1', name: 'Sala Calma', description: '', capacity: 4, hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true },
    user: { id: 'user-1', email: 'cliente@example.com', name: 'Cliente' },
    ...overrides,
  }
}

describe('BookingsTable', () => {
  it('renders the given bookings without a pager when total <= page_size', () => {
    const bookings = [makeBooking('b1'), makeBooking('b2')]
    render(
      <BookingsTable bookings={bookings} total={2} page={1} pageSize={20} onPageChange={vi.fn()} />,
    )
    expect(screen.getAllByRole('row')).toHaveLength(3) // header + 2 rows
    expect(screen.queryByText('Seguinte')).not.toBeInTheDocument()
    expect(screen.queryByText('Anterior')).not.toBeInTheDocument()
  })

  it('shows the pager when total exceeds page_size', () => {
    const bookings = [makeBooking('b1')]
    render(
      <BookingsTable bookings={bookings} total={45} page={1} pageSize={20} onPageChange={vi.fn()} />,
    )
    expect(screen.getByText(/Página 1 de 3/)).toBeInTheDocument()
    expect(screen.getByText('Seguinte')).toBeInTheDocument()
    expect(screen.getByText('Anterior')).toBeInTheDocument()
  })

  it('disables "Anterior" on the first page and "Seguinte" on the last page', () => {
    const bookings = [makeBooking('b1')]
    const { rerender } = render(
      <BookingsTable bookings={bookings} total={45} page={1} pageSize={20} onPageChange={vi.fn()} />,
    )
    expect(screen.getByText('Anterior').closest('button')).toBeDisabled()
    expect(screen.getByText('Seguinte').closest('button')).not.toBeDisabled()

    rerender(
      <BookingsTable bookings={bookings} total={45} page={3} pageSize={20} onPageChange={vi.fn()} />,
    )
    expect(screen.getByText('Seguinte').closest('button')).toBeDisabled()
    expect(screen.getByText('Anterior').closest('button')).not.toBeDisabled()
  })

  it('requests the next page when "Seguinte" is clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const bookings = [makeBooking('b1')]
    render(
      <BookingsTable bookings={bookings} total={45} page={1} pageSize={20} onPageChange={onPageChange} />,
    )
    await user.click(screen.getByText('Seguinte'))
    expect(onPageChange).toHaveBeenCalledWith(2)
  })

  it('requests the previous page when "Anterior" is clicked', async () => {
    const user = userEvent.setup()
    const onPageChange = vi.fn()
    const bookings = [makeBooking('b1')]
    render(
      <BookingsTable bookings={bookings} total={45} page={2} pageSize={20} onPageChange={onPageChange} />,
    )
    await user.click(screen.getByText('Anterior'))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('calls onUpdateStatus when confirming a pending booking', async () => {
    const user = userEvent.setup()
    const onUpdateStatus = vi.fn()
    const bookings = [makeBooking('b1', { status: 'pending' })]
    render(
      <BookingsTable
        bookings={bookings}
        total={1}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
        onUpdateStatus={onUpdateStatus}
      />,
    )
    const buttons = screen.getAllByRole('button')
    await user.click(buttons[0])
    expect(onUpdateStatus).toHaveBeenCalledWith('b1', 'confirmed')
  })
})
