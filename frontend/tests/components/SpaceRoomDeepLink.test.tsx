import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpacePage from '@/app/spaces/[id]/page'
import { spacesApi } from '@/lib/api'
import { makeRoom, makeSpace } from './spaceModeFixtures'

let search = ''
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spaces/s-1',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
type CalendarProps = { room: { id: string }; initialDate?: Date; reopen?: { start: Date; end: Date } | null; onSlotSelect: (s: Date, e: Date) => void; onReopenDone?: () => void }
let lastCalendar: CalendarProps | null = null
vi.mock('@/components/booking/BookingCalendar', () => ({
  BookingCalendar: (props: CalendarProps) => { lastCalendar = props; return <div data-testid="calendar" data-room={props.room.id} data-initial={props.initialDate?.toISOString() ?? ''} data-reopen={props.reopen ? `${props.reopen.start.toISOString()}/${props.reopen.end.toISOString()}` : ''} /> },
}))
vi.mock('@/components/booking/BookingModal', () => ({
  BookingModal: ({ room, start, end, awaitingPurchase, onClose }: { room: { id: string } | null; start: Date | null; end: Date | null; awaitingPurchase?: boolean; onClose: () => void }) =>
    room && start && end ? (
      <div data-testid="modal" data-room={room.id} data-start={start.toISOString()} data-end={end.toISOString()} data-awaiting={String(awaitingPurchase ?? false)}>
        <button onClick={onClose}>fechar</button>
      </div>
    ) : null,
}))
vi.mock('@/lib/api', () => ({ spacesApi: { get: vi.fn() } }))

const scrollIntoView = vi.fn()

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SpacePage params={{ id: 's-1' }} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  search = ''
  lastCalendar = null
  Element.prototype.scrollIntoView = scrollIntoView
  vi.mocked(spacesApi.get).mockResolvedValue({
    space: makeSpace('s-1'),
    rooms: [makeRoom('r-a', { name: 'Sala Calma' }), makeRoom('r-b', { name: 'Sala Brisa' }), makeRoom('r-off', { name: 'Sala Fechada', is_active: false })],
  })
})

// C11: a room card on the landing page lands on that room's calendar.
describe('space page ?room= deep link', () => {
  it('opens the calendar for the requested room and brings it into view', async () => {
    search = 'room=r-b'
    renderPage()
    const heading = await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    // The calendar's module loads on demand (P1.3): the heading is there first.
    expect(await screen.findByTestId('calendar')).toHaveAttribute('data-room', 'r-b')
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const pressed = screen.getAllByRole('button', { name: /Reservar Esta Sala/i }).map((b) => b.getAttribute('aria-pressed'))
    expect(pressed).toEqual(['false', 'true'])
  })

  it.each([
    ['an unknown id', 'room=nope'],
    ['an inactive room', 'room=r-off'],
    ['an empty value', 'room='],
    ['no parameter', ''],
  ])('quietly ignores %s', async (_label, query) => {
    search = query
    renderPage()
    await screen.findAllByRole('button', { name: /Reservar Esta Sala/i })
    expect(screen.queryByTestId('calendar')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('still lets the customer pick another room afterwards', async () => {
    search = 'room=r-b'
    renderPage()
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    screen.getAllByRole('button', { name: /Reservar Esta Sala/i })[0].click()
    expect(await screen.findByRole('heading', { name: /Disponibilidade — Sala Calma/ })).toBeVisible()
  })
})

// K02: back from buying a pack, the page reopens the slot the customer left
// and shows how Checkout ended, then strips those params (keeping ?room=).
describe('space page ?room=&start=&end=&pagamento= after a pack purchase (K02)', () => {
  const start = '2030-08-12T09:00:00.000Z'
  const end = '2030-08-12T11:00:00.000Z'

  it('opens the room on that day, hands the slot to the calendar, shows the success notice and strips the query', async () => {
    search = `room=r-b&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&pagamento=sucesso`
    renderPage()
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    const calendar = await screen.findByTestId('calendar')
    expect(calendar).toHaveAttribute('data-initial', start)
    expect(calendar).toHaveAttribute('data-reopen', `${start}/${end}`)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent('Pagamento concluído.')
    expect(notice).toHaveTextContent(/Confirme a reserva abaixo/)
    expect(replace).toHaveBeenCalledWith('/spaces/s-1?room=r-b', { scroll: false })
  })

  it('a free slot reported back by the calendar opens the modal on it; the calendar is told once', async () => {
    search = `room=r-b&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&pagamento=cancelado`
    renderPage()
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    expect(screen.getByRole('status')).toHaveTextContent('Pagamento não concluído.')
    const { act } = await import('@testing-library/react')
    act(() => { lastCalendar!.onSlotSelect(new Date(start), new Date(end)); lastCalendar!.onReopenDone?.() })
    const modal = await screen.findByTestId('modal')
    expect(modal).toHaveAttribute('data-room', 'r-b')
    expect(modal).toHaveAttribute('data-start', start)
    // Nothing was bought: the modal has no pack to wait for.
    expect(modal).toHaveAttribute('data-awaiting', 'false')
    await waitFor(() => expect(screen.getByTestId('calendar')).toHaveAttribute('data-reopen', ''))
  })

  it('after a successful purchase the reopened modal is told to wait for the pack, until it is closed (review on #69)', async () => {
    search = `room=r-b&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&pagamento=sucesso`
    renderPage()
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    const { act } = await import('@testing-library/react')
    act(() => { lastCalendar!.onSlotSelect(new Date(start), new Date(end)); lastCalendar!.onReopenDone?.() })
    expect(await screen.findByTestId('modal')).toHaveAttribute('data-awaiting', 'true')

    // Closed and reopened on another slot by hand: the wait is over.
    fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
    await waitFor(() => expect(screen.queryByTestId('modal')).toBeNull())
    act(() => { lastCalendar!.onSlotSelect(new Date('2030-08-13T09:00:00Z'), new Date('2030-08-13T10:00:00Z')) })
    expect(await screen.findByTestId('modal')).toHaveAttribute('data-awaiting', 'false')
  })

  it.each([
    ['a half hour', '2030-08-12T09:30:00Z', '2030-08-12T11:00:00Z'],
    ['an end before the start', '2030-08-12T11:00:00Z', '2030-08-12T09:00:00Z'],
    ['garbage', 'yesterday', 'tomorrow'],
    ['only one of them', '2030-08-12T09:00:00Z', ''],
  ])('ignores %s and opens the room as a plain ?room= link would', async (_label, s, e) => {
    search = `room=r-b&start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`
    renderPage()
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    expect(await screen.findByTestId('calendar')).toHaveAttribute('data-reopen', '')
    expect(screen.queryByRole('status')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})
