import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SpaceCards } from '@/components/landing/SpaceCards'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { spacesApi } from '@/lib/api'
import { makeRoom, makeSpace, modeState } from './spaceModeFixtures'

vi.mock('@/lib/api', () => ({ spacesApi: { list: vi.fn(), get: vi.fn() } }))

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SpaceCards /></QueryClientProvider>)
}

const hrefs = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spacesApi.get).mockResolvedValue({
    space: makeSpace('s-1'),
    rooms: [makeRoom('r-a', { name: 'Sala Calma' }), makeRoom('r-b', { name: 'Sala Brisa', capacity: 1 })],
  })
})

// C11: the landing section, driven by the one hook that knows the mode.
describe('landing section by space mode', () => {
  it('one space: shows its rooms, each deep-linking to that room on the space page', async () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'single', space: makeSpace('s-1') }))
    renderSection()

    const calma = (await screen.findByText('Sala Calma')).closest('[data-testid="room-card"]') as HTMLElement
    expect(within(calma).getByRole('link')).toHaveAttribute('href', '/spaces/s-1?room=r-a')
    expect(within(calma).getByText(/11/)).toBeVisible()
    expect(within(calma).getByText('WiFi')).toBeVisible()
    expect(hrefs()).toContain('/spaces/s-1?room=r-b')
    // No "choose a space" step: nothing links to a bare space or the list.
    expect(hrefs()).not.toContain('/spaces/s-1')
    expect(hrefs()).not.toContain('/spaces')
  })

  it('one space: keeps the location visible although the space layer is hidden', async () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'single', space: makeSpace('s-1') }))
    renderSection()
    const where = await screen.findByRole('region', { name: /onde estamos/i })
    expect(within(where).getByText('2745-841 Queluz')).toBeVisible()
    expect(within(where).getByRole('link', { name: /como chegar/i })).toBeVisible()
    // The venue name is no longer printed in the block (M03); the hours line follows the heading.
    expect(within(where).queryByText('Espaço s-1')).toBeNull()
    expect(within(where).getByTestId('opening-hours')).toBeVisible()
  })

  it('one space with no rooms yet: says so instead of an empty grid', async () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'single', space: makeSpace('s-1') }))
    vi.mocked(spacesApi.get).mockResolvedValue({ space: makeSpace('s-1'), rooms: [] })
    renderSection()
    expect(await screen.findByTestId('rooms-empty')).toBeVisible()
    expect(screen.queryAllByTestId('room-card')).toHaveLength(0)
  })

  it('two spaces: the spaces UI, exactly as before', async () => {
    vi.mocked(useSingleSpace).mockReturnValue(
      modeState({ mode: 'multi', spaces: [makeSpace('s-1'), makeSpace('s-2')] }),
    )
    renderSection()
    expect(screen.getByText('Espaço s-1')).toBeVisible()
    expect(screen.getByText('Espaço s-2')).toBeVisible()
    expect(hrefs()).toEqual(expect.arrayContaining(['/spaces/s-1', '/spaces/s-2', '/spaces']))
    expect(screen.queryAllByTestId('room-card')).toHaveLength(0)
    expect(screen.queryByRole('region', { name: /onde estamos/i })).toBeNull()
    expect(spacesApi.get).not.toHaveBeenCalled()
  })

  it('no spaces: a plain empty state with nowhere pointless to click', () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'empty' }))
    renderSection()
    expect(screen.getByTestId('spaces-empty')).toBeVisible()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })

  it('unknown yet: skeletons only — neither UI is drawn and then swapped', () => {
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'loading' }))
    renderSection()
    expect(screen.getAllByTestId('card-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.queryAllByRole('heading')).toHaveLength(0)
    expect(spacesApi.get).not.toHaveBeenCalled()
  })

  it('lookup failed: says so and offers a retry', () => {
    const retry = vi.fn()
    vi.mocked(useSingleSpace).mockReturnValue(modeState({ mode: 'error', retry }))
    renderSection()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'))
    expect(retry).toHaveBeenCalled()
    expect(screen.queryAllByRole('link')).toHaveLength(0)
  })
})
