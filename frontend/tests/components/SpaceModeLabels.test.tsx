import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Hero } from '@/components/landing/Hero'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { t } from '@/lib/i18n'
import { makeSpace, modeState } from './spaceModeFixtures'

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ memberships: [], currentOrgId: null, currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))

const single = modeState({ mode: 'single', space: makeSpace('s-1') })
const multi = modeState({ mode: 'multi', spaces: [makeSpace('s-1'), makeSpace('s-2')] })
const loading = modeState({ mode: 'loading' })

// Keys, not strings: what is asserted is that the label follows the mode and
// the link still goes to /spaces, not what marketing called it this week.
const surfaces = [
  ['navbar', () => <Navbar />, 'navbar.rooms_link', 'navbar.spaces_link'],
  ['footer', () => <Footer />, 'footer.rooms', 'footer.spaces'],
  ['hero call to action', () => <Hero />, 'hero.cta_primary_rooms', 'hero.cta_primary'],
] as const

beforeEach(() => vi.clearAllMocks())

describe.each(surfaces)('%s browse link', (_name, Surface, roomsKey, spacesKey) => {
  it('talks about rooms while there is one space', () => {
    vi.mocked(useSingleSpace).mockReturnValue(single)
    render(<Surface />)
    expect(screen.getAllByRole('link', { name: t(roomsKey) })[0]).toHaveAttribute('href', '/spaces')
    expect(screen.queryByRole('link', { name: t(spacesKey) })).toBeNull()
  })

  it('talks about spaces when there are several', () => {
    vi.mocked(useSingleSpace).mockReturnValue(multi)
    render(<Surface />)
    expect(screen.getAllByRole('link', { name: t(spacesKey) })[0]).toHaveAttribute('href', '/spaces')
    expect(screen.queryByRole('link', { name: t(roomsKey) })).toBeNull()
  })

  it('commits to neither word until the mode is known', () => {
    vi.mocked(useSingleSpace).mockReturnValue(loading)
    const { container } = render(<Surface />)
    expect(screen.queryByRole('link', { name: t(roomsKey) })).toBeNull()
    expect(screen.queryByRole('link', { name: t(spacesKey) })).toBeNull()
    const browse = Array.from(container.querySelectorAll('a[href="/spaces"]'))
    expect(browse.length).toBeGreaterThan(0)
    browse.forEach((a) => expect(within(a as HTMLElement).getByTestId('mode-text-skeleton')).toBeInTheDocument())
  })
})

describe('how it works, step 2', () => {
  it('does not ask the customer to choose a space when there is only one', () => {
    vi.mocked(useSingleSpace).mockReturnValue(single)
    render(<HowItWorks />)
    expect(screen.getByRole('heading', { name: t('howItWorks.step_2_title_rooms') })).toBeVisible()
    expect(screen.queryByRole('heading', { name: t('howItWorks.step_2_title') })).toBeNull()
  })

  it('does when there are several', () => {
    vi.mocked(useSingleSpace).mockReturnValue(multi)
    render(<HowItWorks />)
    expect(screen.getByRole('heading', { name: t('howItWorks.step_2_title') })).toBeVisible()
  })
})
