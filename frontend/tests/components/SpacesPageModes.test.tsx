import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SpacesPage from '@/app/spaces/page'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'
import { spacesApi } from '@/lib/api'
import { makeRoom, makeSpace, modeState } from './spaceModeFixtures'

const replace = vi.fn()
const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/spaces',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/components/booking/BookingCalendar', () => ({ BookingCalendar: () => <div data-testid="calendar" /> }))
vi.mock('@/components/booking/BookingModal', () => ({ BookingModal: () => null }))
vi.mock('@/lib/api', () => ({ spacesApi: { list: vi.fn(), get: vi.fn() } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SpacesPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spacesApi.get).mockResolvedValue({ space: makeSpace('s-1'), rooms: [makeRoom('r-a'), makeRoom('r-b')] })
})

// C11: /spaces never shows a one-card list.
describe('/spaces by space mode', () => {
  it('one space: is that space\'s rooms view, in place', async () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'single', space: makeSpace('s-1') }))
    renderPage()
    expect(await screen.findAllByRole('button', { name: /Reservar Esta Sala/i })).toHaveLength(2)
    expect(spacesApi.get).toHaveBeenCalledWith('s-1')
    expect(screen.getByRole('link', { name: /como chegar/i })).toBeVisible()
    // Rendered, not redirected: no history entry to bounce the back button off.
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain('/spaces/s-1')
  })

  it('two spaces: the list, exactly as before', () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'multi', spaces: [makeSpace('s-1'), makeSpace('s-2')] }))
    renderPage()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toEqual(expect.arrayContaining(['/spaces/s-1', '/spaces/s-2']))
    expect(screen.queryByRole('button', { name: /Reservar Esta Sala/i })).toBeNull()
    expect(spacesApi.get).not.toHaveBeenCalled()
  })

  it('no spaces: an empty state', () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'empty' }))
    renderPage()
    expect(screen.getByTestId('spaces-empty')).toBeVisible()
  })

  it('unknown yet: skeletons, and no list heading to swap out later', () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'loading' }))
    renderPage()
    expect(screen.getAllByTestId('page-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    expect(spacesApi.get).not.toHaveBeenCalled()
  })

  it('lookup failed: says so and offers a retry', () => {
    const retry = vi.fn()
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'error', retry }))
    renderPage()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'))
    expect(retry).toHaveBeenCalled()
  })
})

// B65: the same three states in English.
describe('/spaces in English', () => {
  afterEach(() => resetLocaleForTests())

  it('the list, the empty state and the error speak English', () => {
    setLocale('en')
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'multi', spaces: [makeSpace('s-1'), makeSpace('s-2')] }))
    const list = renderPage()
    expect(screen.getByRole('heading', { name: 'All Spaces' })).toBeVisible()
    expect(screen.getByText('Find the perfect room for your practice.')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'View Rooms and Book' })).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/Reservar|Comprar|Os meus|Não tem|Entrar/)
    list.unmount()

    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'empty' }))
    const empty = renderPage()
    expect(screen.getByTestId('spaces-empty')).toHaveTextContent('No rooms available yet. Check back soon.')
    empty.unmount()

    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'error' }))
    renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the rooms.')
    expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})
