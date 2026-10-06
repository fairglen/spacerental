import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { Navbar } from '@/components/layout/Navbar'
import { useOrg } from '@/contexts/OrgContext'
import { t } from '@/lib/i18n'

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: vi.fn(),
}))

describe('Navbar component i18n refactor (9.1)', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
      update: vi.fn(),
    })
    vi.mocked(useOrg).mockReturnValue({
      memberships: [],
      currentOrgId: null,
      currentMembership: null,
      setCurrentOrgId: vi.fn(),
      isLoading: false,
    })
  })

  it('shows the brand from the catalog, not a hard-coded name (W02)', () => {
    render(<Navbar />)

    expect(screen.getByRole('link', { name: t('brand.name') })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/espa[cç]ohora/i)).not.toBeInTheDocument()
  })

  it('the brand link carries the wordmark alone, 22px tall, decorative inside the named link, taking the primary colour (B51)', () => {
    render(<Navbar />)
    const link = screen.getByRole('link', { name: t('brand.name') })
    const logo = link.querySelector('svg')!
    expect(logo).not.toBeNull()
    expect(logo).toHaveAttribute('aria-hidden', 'true')
    expect(logo).toHaveAttribute('height', '22')
    expect(Number(logo.getAttribute('width'))).toBeCloseTo(22 * 1018.5 / 216.5, 0)
    expect(logo.querySelector('use')).toHaveAttribute('href', '#brand-wordmark')
    // The mark on its own never appears under 36px: the header has no mark at all.
    expect(link.querySelector('use[href="#brand-mark"], use[href*="lockup"]')).toBeNull()
    expect(link.className).toContain('text-primary')
    // No text wordmark or icon next to it.
    expect(link.textContent).toBe('')
  })

  it('renders nav links in Portuguese', () => {
    render(<Navbar />)

    expect(screen.getByText('Espaços')).toBeInTheDocument()
    expect(screen.getByText('Como Funciona')).toBeInTheDocument()
    expect(screen.getByText('Preços')).toBeInTheDocument()
  })

  it('offers sign-in and booking links to unauthenticated users', () => {
    render(<Navbar />)

    expect(screen.getByRole('link', { name: /Entrar/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reservar/ })).toBeInTheDocument()
  })

  it('offers reservations and sign-out to authenticated users', () => {
    vi.mocked(useSession).mockReturnValue({
      data: {
        accessToken: 'jwt-token',
        user: { id: 'user-1', email: 'demo@example.com', name: 'Demo' },
        role: 'member',
        memberships: [],
        expires: '2030-01-01T00:00:00Z',
      },
      status: 'authenticated',
      update: vi.fn(),
    })

    render(<Navbar />)

    expect(screen.getByText('As minhas reservas')).toBeInTheDocument()
    expect(screen.getByText('Sair')).toBeInTheDocument()
  })
})

describe('Navbar packs entry (B30)', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() })
    vi.mocked(useOrg).mockReturnValue({
      memberships: [], currentOrgId: null, currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false,
    })
  })

  it('links signed-in users to their packs', () => {
    vi.mocked(useSession).mockReturnValue({
      data: { accessToken: 'jwt-token', user: { name: 'Demo' } } as never,
      status: 'authenticated',
      update: vi.fn(),
    })
    vi.mocked(useOrg).mockReturnValue({
      memberships: [{ org_id: 'org-1', org_name: 'Demo', org_slug: 'demo', role: 'member' }],
      currentOrgId: 'org-1',
      currentMembership: { org_id: 'org-1', org_name: 'Demo', org_slug: 'demo', role: 'member' },
      setCurrentOrgId: vi.fn(),
      isLoading: false,
    })
    render(<Navbar />)
    expect(screen.getAllByRole('link', { name: /packs/i })[0]).toHaveAttribute('href', '/dashboard/packages')
  })

  it('does not show the packs entry to visitors', () => {
    render(<Navbar />)
    expect(screen.queryByRole('link', { name: /packs/i })).toBeNull()
  })
})

describe('Navbar org switcher visibility (B33b/B33c)', () => {
  const membership = (org_id: string, role: 'owner' | 'member' = 'member') =>
    ({ org_id, org_name: `Org ${org_id}`, org_slug: org_id, role })

  function signedInWith(memberships: ReturnType<typeof membership>[]) {
    vi.mocked(useSession).mockReturnValue({
      data: { accessToken: 'jwt-token', user: { name: 'Demo' } } as never,
      status: 'authenticated',
      update: vi.fn(),
    })
    vi.mocked(useOrg).mockReturnValue({
      memberships,
      currentOrgId: memberships[0]?.org_id ?? null,
      currentMembership: memberships[0] ?? null,
      setCurrentOrgId: vi.fn(),
      isLoading: false,
    })
  }

  it('hides the switcher for a customer with a single membership', () => {
    signedInWith([membership('org-1')])
    render(<Navbar />)
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('keeps the switcher for multi-org users, controlled from the first render', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      signedInWith([membership('org-1', 'owner'), membership('org-2')])
      render(<Navbar />)
      // The switcher's module loads on demand (P1.3): wait for it, then the
      // same assertions as before.
      expect((await screen.findAllByRole('combobox')).length).toBeGreaterThan(0)
      const uncontrolled = error.mock.calls.filter((call) => String(call[0]).includes('uncontrolled'))
      expect(uncontrolled).toEqual([])
    } finally {
      error.mockRestore()
    }
  })
})
