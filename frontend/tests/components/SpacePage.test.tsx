import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpacePage from '@/app/spaces/[id]/page'
import { spacesApi } from '@/lib/api'
import type { Room, Space } from '@/types'

vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/components/booking/BookingCalendar', () => ({
  BookingCalendar: () => <div data-testid="calendar" />,
}))
vi.mock('@/components/booking/BookingModal', () => ({ BookingModal: () => null }))
vi.mock('@/lib/api', () => ({ spacesApi: { get: vi.fn() } }))

const space: Space = {
  id: 's-1', org_id: 'org-1', name: 'Espaço Calmo', description: '', address: 'Rua', city: 'Lisboa',
  images: [], amenities: [], is_active: true, created_at: '',
}
const roomA: Room = {
  id: 'r-a', space_id: 's-1', org_id: 'org-1', name: 'Sala Calma', description: '', capacity: 4,
  hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true,
}
const roomB: Room = { ...roomA, id: 'r-b', name: 'Sala Brisa' }

let reducedMotion = false
const scrollIntoView = vi.fn()

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SpacePage params={{ id: 's-1' }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  reducedMotion = false
  Element.prototype.scrollIntoView = scrollIntoView
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reducedMotion,
    media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  vi.mocked(spacesApi.get).mockResolvedValue({ space, rooms: [roomA, roomB] })
})

describe('Space page — selecting a room (B27)', () => {
  it('scrolls the calendar into view and focuses its heading', async () => {
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: /Reservar Esta Sala/i })
    fireEvent.click(buttons[1])
    const heading = await screen.findByRole('heading', { name: /Disponibilidade — Sala Brisa/ })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('does not animate when the user prefers reduced motion', async () => {
    reducedMotion = true
    renderPage()
    fireEvent.click((await screen.findAllByRole('button', { name: /Reservar Esta Sala/i }))[0])
    await screen.findByRole('heading', { name: /Disponibilidade — Sala Calma/ })
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
    expect(scrollIntoView).not.toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('marks the selected room card and only that one', async () => {
    renderPage()
    const buttons = await screen.findAllByRole('button', { name: /Reservar Esta Sala/i })
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false'])
    fireEvent.click(buttons[0])
    await waitFor(() => expect(buttons[0]).toHaveAttribute('aria-pressed', 'true'))
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/Sala selecionada/i)).toBeVisible()
  })
})

describe('Space page — location header (C10)', () => {
  it('shows the address through SpaceLocation, with directions', async () => {
    vi.mocked(spacesApi.get).mockResolvedValue({
      space: { ...space, address: 'R. 12 de Julho de 1997 5, Loja 1', postal_code: '2745-841', city: 'Queluz', latitude: 38.755723, longitude: -9.279799 },
      rooms: [roomA],
    })
    renderPage()
    expect(await screen.findByText('2745-841 Queluz')).toBeVisible()
    expect(screen.getByRole('link', { name: /como chegar/i })).toHaveAttribute('href', expect.stringContaining('destination=38.755723,-9.279799'))
  })

  it('prints no "null" for a space whose address was never filled in', async () => {
    vi.mocked(spacesApi.get).mockResolvedValue({
      space: { ...space, address: null as unknown as string, city: null as unknown as string },
      rooms: [roomA],
    })
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'Espaço Calmo' })
    expect(heading.parentElement?.textContent).not.toMatch(/null|undefined/)
  })
})

// V03: photos instead of descriptions. The field stays in the API and the
// admin form (as internal notes); customers never see it.
describe('room description is not shown to customers (V03)', () => {
  it('a room card renders name, price, capacity and amenities but not the description', async () => {
    const { RoomCard } = await import('@/components/spaces/RoomCard')
    render(<RoomCard room={{ ...roomA, description: 'Chave no armário 2', amenities: ['WiFi'] }} href="/spaces?room=r-a" />)
    expect(screen.getByText('Sala Calma')).toBeInTheDocument()
    expect(screen.getByText('WiFi')).toBeInTheDocument()
    expect(screen.queryByText('Chave no armário 2')).toBeNull()
  })
})
