import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpacePage from '@/app/spaces/[id]/page'
import { spacesApi } from '@/lib/api'
import { makeRoom, makeSpace } from './spaceModeFixtures'

let search = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spaces/s-1',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/components/booking/BookingCalendar', () => ({
  BookingCalendar: ({ room }: { room: { id: string } }) => <div data-testid="calendar" data-room={room.id} />,
}))
vi.mock('@/components/booking/BookingModal', () => ({ BookingModal: () => null }))
vi.mock('@/lib/api', () => ({ spacesApi: { get: vi.fn() } }))

const scrollIntoView = vi.fn()

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SpacePage params={{ id: 's-1' }} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  search = ''
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
    expect(screen.getByTestId('calendar')).toHaveAttribute('data-room', 'r-b')
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
