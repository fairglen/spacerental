import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '@/app/dashboard/page'
import { bookingsApi, packagesApi } from '@/lib/api'
import type { Booking } from '@/types'

let searchParams = new URLSearchParams()
const replace = vi.fn()
// Stable across renders, like the real App Router instance.
const router = { push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token', user: { name: 'Demo' } }, status: 'authenticated' }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
const openHelp = vi.fn()
vi.mock('@/components/help/HelpProvider', () => ({ useHelp: () => ({ openHelp }) }))
vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))

vi.mock('@/lib/api', () => ({
  bookingsApi: { listMine: vi.fn(), cancel: vi.fn(), checkout: vi.fn() },
  packagesApi: { listMine: vi.fn().mockResolvedValue([]) },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const inThreeDays = new Date(Date.now() + 3 * 86_400_000)
inThreeDays.setUTCHours(10, 0, 0, 0)

function booking(overrides: Partial<Booking>): Booking {
  const start = overrides.start_time ? new Date(overrides.start_time) : inThreeDays
  return {
    id: 'b-1',
    org_id: 'org-1',
    room_id: 'room-1',
    user_id: 'user-1',
    start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 3_600_000).toISOString(),
    duration_hours: 1,
    total_amount: 11,
    status: 'confirmed',
    payment_method: 'hourly',
    created_at: new Date().toISOString(),
    room: {
      id: 'room-1', space_id: 's-1', org_id: 'org-1', name: 'Sala Calma', description: '',
      capacity: 6, hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true,
    },
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe('Dashboard — door code (B23)', () => {
  it('shows the access code on a confirmed upcoming booking', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ access_code: '482913' })])
    renderPage()
    expect(await screen.findByText('482913')).toBeVisible()
    expect(screen.getByText(/Código de acesso/i)).toBeVisible()
  })

  it('explains calmly when a confirmed booking has no code yet', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ access_code: null })])
    renderPage()
    expect(await screen.findByText('Sala Calma')).toBeVisible()
    expect(screen.getByText(/código de acesso/i)).toHaveTextContent(/ainda não|em breve/i)
    expect(screen.queryByText(/^\d{6}$/)).toBeNull()
  })

  it('never shows a code or the code label on pending or cancelled bookings', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-pending', status: 'pending', access_code: null }),
      booking({ id: 'b-cancelled', status: 'cancelled', access_code: '111111' }),
    ])
    renderPage()
    expect(await screen.findAllByText('Sala Calma')).toHaveLength(2)
    expect(screen.queryByText(/código de acesso/i)).toBeNull()
    expect(screen.queryByText('111111')).toBeNull()
  })
})

describe('Dashboard — payment return notice (B25)', () => {
  beforeEach(() => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
  })

  it('shows a dismissible success notice linking to packs and strips the param', async () => {
    searchParams = new URLSearchParams('pagamento=sucesso')
    renderPage()
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/pagamento concluído/i)
    // Bookings and pack purchases return to the same URL, so the notice must
    // not assert a reservation was confirmed (a pack buyer has none, and a live
    // webhook may still be in flight).
    expect(notice).not.toHaveTextContent(/reserva está confirmada/i)
    expect(notice.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
    expect(replace).toHaveBeenCalledWith('/dashboard', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }))
    await screen.findByText('Não tens reservas futuras.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows a "não concluído" notice when checkout was cancelled', async () => {
    searchParams = new URLSearchParams('pagamento=cancelado')
    renderPage()
    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent(/pagamento não concluído/i)
    // Pack purchases return here too, and a stub-cancelled hold reads as
    // expired below, so the copy must not promise a reservation is waiting
    // to be paid or cancelled.
    expect(notice).not.toHaveTextContent(/a aguardar pagamento|cancelá-la/i)
    expect(replace).toHaveBeenCalledWith('/dashboard', expect.anything())
  })

  it('shows nothing without the param', async () => {
    renderPage()
    await screen.findByText('Não tens reservas futuras.')
    expect(screen.queryByRole('status')).toBeNull()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('Dashboard — cancellation eligibility and failures (C07)', () => {
  it('states the 24h rule in the dialog and cancels an eligible booking', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-ok' })])
    vi.mocked(bookingsApi.cancel).mockResolvedValue(undefined as never)
    renderPage()
    const cancel = await screen.findByRole('button', { name: /^Cancelar$/ })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)
    expect(await screen.findByRole('dialog')).toHaveTextContent(/24 horas/)
    fireEvent.click(screen.getByRole('button', { name: /Sim, cancelar/i }))
    await waitFor(() => expect(bookingsApi.cancel).toHaveBeenCalledWith('b-ok', expect.anything()))
  })

  it('disables Cancel with a visible reason when the booking starts within 24h', async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000)
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-soon', start_time: soon.toISOString() })])
    renderPage()
    const cancel = await screen.findByRole('button', { name: /^Cancelar$/ })
    expect(cancel).toBeDisabled()
    expect(screen.getByText(/24 horas/)).toBeVisible()
  })

  it('keeps the dialog open and explains a backend 400 in Portuguese', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-late' })])
    vi.mocked(bookingsApi.cancel).mockRejectedValue({
      response: { status: 400, data: { detail: 'Bookings can only be cancelled more than 24 hours in advance' } },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Cancelar$/ }))
    fireEvent.click(screen.getByRole('button', { name: /Sim, cancelar/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/24 horas/)
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(alert).not.toHaveTextContent(/reembols/i)
  })
})

describe('Dashboard — package bookings show hours, not money (B29)', () => {
  it('labels an upcoming pack booking with the hours used and no euro amount', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-pack', payment_method: 'package', duration_hours: 3, total_amount: 33 }),
    ])
    renderPage()
    expect(await screen.findByText('3h do pack')).toBeVisible()
    expect(screen.queryByText(/33,00/)).toBeNull()
  })

  it('does the same in the history', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-past-pack', payment_method: 'package', duration_hours: 2, total_amount: 22, start_time: past, end_time: past }),
      booking({ id: 'b-past-hourly', payment_method: 'hourly', duration_hours: 1, total_amount: 11, start_time: past, end_time: past }),
    ])
    renderPage()
    expect(await screen.findByText('2h do pack')).toBeVisible()
    expect(screen.getByText(/11,00/)).toBeVisible()
    expect(screen.queryByText(/22,00/)).toBeNull()
  })
})

describe('Dashboard — a mixed booking shows both halves of what it cost (C13)', () => {
  it('labels it with the pack hours and the money paid', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-mixed', payment_method: 'mixed', duration_hours: 8, package_hours_used: 7, total_amount: 11 }),
    ])
    renderPage()
    expect(await screen.findByText(/7h do pack \+ 11,00\s€/)).toBeVisible()
  })

  it('does the same in the history', async () => {
    const past = new Date(Date.now() - 5 * 86_400_000).toISOString()
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-mixed-past', payment_method: 'mixed', duration_hours: 3, package_hours_used: 2, total_amount: 11, start_time: past, end_time: past }),
    ])
    renderPage()
    expect(await screen.findByText(/2h do pack \+ 11,00\s€/)).toBeVisible()
  })

  it('explains a retry refused because the pack hours went elsewhere', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-mixed-gone', status: 'expired', payment_method: 'mixed', package_hours_used: 7, total_amount: 11, hold_expires_at: new Date(Date.now() - 60_000).toISOString() }),
    ])
    vi.mocked(bookingsApi.checkout).mockRejectedValue({
      response: { status: 409, data: { detail: 'The package no longer has the hours this booking reserved' } },
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Tentar pagar de novo/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/pack/i)
    expect(alert).not.toHaveTextContent(/já está reservado/)
  })
})

describe('Dashboard — packs summary (B30)', () => {
  it('summarises active packs with hours left, expiry and a link', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockResolvedValue([
      {
        id: 'p-1', user_id: 'user-1', package_id: 'pkg-10', org_id: 'org-1',
        hours_total: 10, hours_used: 2.5, hours_remaining: 7.5, amount_paid: 100, status: 'active',
        purchased_at: new Date().toISOString(), expires_at: '2027-03-01T00:00:00Z',
        package: { id: 'pkg-10', org_id: 'org-1', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true },
      },
      {
        id: 'p-2', user_id: 'user-1', package_id: 'pkg-20', org_id: 'org-1',
        hours_total: 20, hours_used: 0, hours_remaining: 20, amount_paid: 100, status: 'pending',
        purchased_at: new Date().toISOString(), expires_at: '2027-03-01T00:00:00Z',
      },
    ])
    renderPage()
    await screen.findByText('Pack 10h')
    const summary = screen.getByRole('region', { name: /packs/i })
    expect(summary).toHaveTextContent('Pack 10h')
    expect(summary).toHaveTextContent('7,5h')
    expect(summary).toHaveTextContent(/2027/)
    expect(summary).not.toHaveTextContent('20h')
    expect(summary.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
  })

  it('invites the customer to buy a pack when there is none', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockResolvedValue([])
    renderPage()
    await screen.findByText(/ainda não tens/i)
    const summary = screen.getByRole('region', { name: /packs/i })
    expect(summary).toHaveTextContent(/ainda não tens/i)
    expect(summary.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
  })
})

describe('Dashboard — history is not capped silently (B33e)', () => {
  it('shows five entries with a "Ver mais" control that reveals the rest', async () => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([])
    const past = Array.from({ length: 7 }, (_, i) => {
      const start = new Date(Date.now() - (i + 2) * 86_400_000).toISOString()
      return booking({ id: `past-${i}`, start_time: start, end_time: start, room: { ...booking({}).room!, name: `Sala ${i}` } })
    })
    vi.mocked(bookingsApi.listMine).mockResolvedValue(past)
    renderPage()
    await screen.findByText('Sala 0')
    expect(screen.getAllByText(/^Sala \d$/)).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: /ver mais/i }))
    expect(screen.getAllByText(/^Sala \d$/)).toHaveLength(7)
    expect(screen.queryByRole('button', { name: /ver mais/i })).toBeNull()
  })
})

describe('Dashboard — unpaid holds (C03)', () => {
  const assign = vi.fn()
  beforeEach(() => {
    vi.mocked(packagesApi.listMine).mockResolvedValue([])
    vi.stubGlobal('location', { ...window.location, assign, href: 'http://localhost:3000/dashboard' })
  })
  afterEach(() => vi.unstubAllGlobals())

  const deadline = new Date(Date.now() + 10 * 60_000).toISOString()

  it('shows a pending hourly hold as awaiting payment with a "Pagar agora" action', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-hold', status: 'pending', hold_expires_at: deadline }),
    ])
    vi.mocked(bookingsApi.checkout).mockResolvedValue({
      booking: booking({ id: 'b-hold', status: 'pending', hold_expires_at: deadline }),
      checkout_url: 'http://localhost:8000/checkout/stub/cs_stub_bhold',
    })
    renderPage()
    expect(await screen.findByText('A aguardar pagamento')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Pagar agora/i }))
    await waitFor(() => expect(bookingsApi.checkout).toHaveBeenCalledWith('b-hold', expect.anything()))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:8000/checkout/stub/cs_stub_bhold'))
    // An unpaid hold can be let go at any time.
    expect(screen.getByRole('button', { name: /^Cancelar$/ })).toBeEnabled()
  })

  it('offers a retry on an expired hold and explains a paid-but-unfulfilled one', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-exp', status: 'expired', hold_expires_at: new Date(Date.now() - 60_000).toISOString() }),
      booking({ id: 'b-paid', status: 'paid_unfulfilled', start_time: new Date(Date.now() + 4 * 86_400_000).toISOString() }),
    ])
    renderPage()
    expect(await screen.findByText('Expirada')).toBeVisible()
    expect(screen.getByRole('button', { name: /Tentar pagar de novo/i })).toBeVisible()
    expect(screen.getByText(/Pagamento recebido/)).toBeVisible()
    expect(screen.getByText(/horário já não está disponível/)).toBeVisible()
  })

  it('does not offer payment on a pending series occurrence', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-series', status: 'pending', hold_expires_at: null, recurrence_rule_id: 'rule-1' }),
    ])
    renderPage()
    expect(await screen.findByText('Pendente')).toBeVisible()
    expect(screen.queryByRole('button', { name: /Pagar agora/i })).toBeNull()
  })

  it('explains a failed "Pagar agora" instead of staying silent', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-gone', status: 'expired', hold_expires_at: new Date(Date.now() - 60_000).toISOString() }),
    ])
    vi.mocked(bookingsApi.checkout).mockRejectedValue({ response: { status: 409, data: { detail: 'This time slot is already booked' } } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Tentar pagar de novo/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/já está reservado/)
  })
})

describe('Dashboard — packs summary counts only spendable packs (review)', () => {
  const purchase = (id: string, overrides: Record<string, unknown>) => ({
    id, user_id: 'user-1', package_id: 'pkg', org_id: 'org-1', hours_total: 10, hours_used: 0, hours_remaining: 10, amount_paid: 100,
    status: 'active' as const, purchased_at: new Date().toISOString(), expires_at: '2027-03-01T00:00:00Z',
    package: { id: 'pkg', org_id: 'org-1', name: 'Pack 10h', hours: 10, price: 100, validity_days: 365, is_active: true },
    ...overrides,
  })

  it('ignores expired and exhausted purchases even when their status is active', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockResolvedValue([
      purchase('p-expired', { expires_at: '2020-01-01T00:00:00Z' }),
      purchase('p-empty', { hours_remaining: 0, amount_paid: 100, hours_used: 10 }),
    ])
    renderPage()
    await screen.findByText(/ainda não tens/i)
    expect(screen.queryByText('Pack 10h')).toBeNull()
  })

  it('shows a fallback instead of a skeleton when the packs request fails', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([])
    vi.mocked(packagesApi.listMine).mockRejectedValue(new Error('boom'))
    renderPage()
    const summary = await screen.findByRole('region', { name: /packs/i })
    await waitFor(() => expect(summary).toHaveTextContent(/não foi possível/i))
    expect(summary.querySelector('a[href="/dashboard/packages"]')).not.toBeNull()
  })
})

// C18: money questions after a cancellation go to a person, through the help
// dialog; inside the 24h window the customer can ask for an exception there
// instead of hitting a dead end. The dashboard itself says nothing about money.
describe('Dashboard — cancellations route to the help dialog (C18)', () => {
  it.each([
    ['an hourly booking', { payment_method: 'hourly' as const }],
    ['a mixed booking', { payment_method: 'mixed' as const, package_hours_used: 2, total_amount: 11 }],
  ])('a cancellable %s keeps self-service cancel and adds one muted line to the help dialog', async (_label, extra) => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-paid', ...extra })])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Cancelar$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Sim, cancelar/i })).toBeEnabled()
    const line = within(dialog).getByText(/Questões sobre o valor pago\?/)
    expect(line.className).toMatch(/muted/)
    // Below the buttons, and no claim either way about the money.
    const confirm = within(dialog).getByRole('button', { name: /Sim, cancelar/i })
    expect(confirm.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/reembols|devolv|refund/i)
    fireEvent.click(within(dialog).getByRole('button', { name: /Fala connosco/ }))
    expect(openHelp).toHaveBeenCalledWith({ category: 'payment', bookingId: 'b-paid' })
  })

  it('a package booking gets no money line: nothing was paid for it', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-pack', payment_method: 'package' })])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Cancelar$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByText(/valor pago/)).toBeNull()
  })

  it('an unpaid hold gets no money line either', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      booking({ id: 'b-hold', status: 'pending', hold_expires_at: new Date(Date.now() + 600_000).toISOString() }),
    ])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /^Cancelar$/ }))
    expect(within(await screen.findByRole('dialog')).queryByText(/valor pago/)).toBeNull()
  })

  it('inside the 24h window, Cancel stays disabled with its reason and offers the help dialog instead', async () => {
    const soon = new Date(Date.now() + 3 * 3_600_000)
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-soon', start_time: soon.toISOString() })])
    renderPage()
    expect(await screen.findByRole('button', { name: /^Cancelar$/ })).toBeDisabled()
    expect(screen.getByText(/24 horas/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Precisas de cancelar\? Fala connosco/ }))
    expect(openHelp).toHaveBeenCalledWith({ category: 'booking', bookingId: 'b-soon' })
  })

  it('a booking that can be cancelled does not show the exception link', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([booking({ id: 'b-ok' })])
    renderPage()
    await screen.findByRole('button', { name: /^Cancelar$/ })
    expect(screen.queryByRole('button', { name: /Precisas de cancelar/ })).toBeNull()
  })
})
