import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { Navbar } from '@/components/layout/Navbar'
import { useOrg } from '@/contexts/OrgContext'

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
