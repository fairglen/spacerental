import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ContactNote } from '@/components/booking/ContactNote'
import { BookingModal } from '@/components/booking/BookingModal'
import SpacePage from '@/app/spaces/[id]/page'
import { CONTACT_EMAIL } from '@/lib/contact'
import { spacesApi } from '@/lib/api'
import { makeRoom, makeSpace } from './spaceModeFixtures'

vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/components/booking/BookingCalendar', () => ({ BookingCalendar: () => <div data-testid="calendar" /> }))
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  spacesApi: { get: vi.fn() },
  packagesApi: { listMine: vi.fn().mockResolvedValue([]) },
}))

const room = makeRoom('r-a', { name: 'Sala Calma & Cª' })

function withClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

function expectContactLink(scope: HTMLElement, roomName: string) {
  const link = within(scope).getByRole('link', { name: CONTACT_EMAIL })
  const href = link.getAttribute('href')!
  expect(href.startsWith(`mailto:${CONTACT_EMAIL}?subject=`)).toBe(true)
  expect(new URL(href).searchParams.get('subject')).toBe(`Pedido de reserva — ${roomName}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_RECURRING_BOOKINGS_ENABLED', 'false')
  vi.mocked(spacesApi.get).mockResolvedValue({ space: makeSpace('s-1'), rooms: [room] })
})

// C12: special requests go to a mailbox, not a form. The note offers that
// without getting in the way of the booking.
describe('ContactNote', () => {
  it('links the single-source address, with the room in a prefilled subject', () => {
    const { container } = render(<ContactNote roomName={room.name} />)
    expectContactLink(container, room.name)
  })

  it('is a note, never an alert or a status that interrupts', () => {
    render(<ContactNote roomName={room.name} />)
    expect(screen.getByRole('note')).toBeVisible()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull() // nothing to dismiss, nothing persisted
  })

  it('does not dress up as a warning', () => {
    render(<ContactNote roomName={room.name} />)
    expect(screen.getByRole('note').className).not.toMatch(/red|amber|yellow|destructive/)
  })
})

describe('contact note on the booking page', () => {
  it('sits between the help text and the calendar, for the room being booked', async () => {
    withClient(<SpacePage params={{ id: 's-1' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Reservar Esta Sala/i }))

    const help = await screen.findByTestId('calendar-help')
    const note = screen.getByRole('note')
    const calendar = screen.getByTestId('calendar')
    expect(help.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expectContactLink(note, room.name)
  })

  it('explains the two ways to pick hours, and no longer mentions a month view', async () => {
    withClient(<SpacePage params={{ id: 's-1' }} />)
    fireEvent.click(await screen.findByRole('button', { name: /Reservar Esta Sala/i }))
    const help = await screen.findByTestId('calendar-help')
    expect(help.textContent).toMatch(/clica/i)
    expect(help.textContent).toMatch(/arrasta/i)
    expect(help.textContent).not.toMatch(/m[êe]s/i)
    expect(help.textContent!.split(/[.!?](?:\s|$)/).filter(Boolean)).toHaveLength(1)
  })
})

describe('contact note in the confirm dialog', () => {
  const start = new Date('2030-08-12T09:00:00Z')
  const end = new Date('2030-08-12T10:00:00Z')

  it('is one muted line above the buttons, and blocks nothing', () => {
    withClient(<BookingModal room={room} start={start} end={end} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    const note = within(dialog).getByRole('note')
    expectContactLink(note, room.name)
    expect(note.className).toMatch(/muted/)
    expect(note.querySelectorAll('p, div').length).toBeLessThanOrEqual(1)

    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' })
    expect(note.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(cancel).toBeEnabled()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('offers no weekly repeat while the recurrence flag is off', () => {
    withClient(<BookingModal room={room} start={start} end={end} onClose={vi.fn()} />)
    expect(screen.queryByLabelText(/Repetir semanalmente/i)).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})
