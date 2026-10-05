import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { adminApi } from '@/lib/api'
import { ToastProvider } from '@/components/ui/toast'
import AdminRoomPage from '@/app/admin/rooms/[id]/page'
import AdminSpacePage from '@/app/admin/spaces/[id]/page'
import NewSpacePage from '@/app/admin/spaces/new/page'
import AdminRoomsListPage from '@/app/admin/rooms/page'
import AdminBookingPage from '@/app/admin/bookings/[id]/page'
import AdminUserPage from '@/app/admin/users/[id]/page'
import NewUserPage from '@/app/admin/users/new/page'
import AdminPurchasePage from '@/app/admin/purchases/[id]/page'
import AdminSupportRequestPage from '@/app/admin/support/[id]/page'
import AdminAuditPage from '@/app/admin/audit/page'
import AdminSettingsPage from '@/app/admin/settings/page'
import type { AdminAction, Booking, OrgUser, Room, Space } from '@/types'

// One harness for every G06 page: the API is mocked at the wrapper level, the
// router at the navigation level, and each test asserts what the page sends.

const nav = vi.hoisted(() => ({
  push: vi.fn(), replace: vi.fn(), params: { id: 'r-1' }, search: new URLSearchParams(), role: 'owner' as 'owner' | 'admin', userId: 'admin-1',
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'jwt', user: { id: nav.userId } }, status: 'authenticated' }) }))
vi.mock('@/contexts/OrgContext', () => ({ useOrg: () => ({ currentOrgId: 'org-1', currentMembership: { org_id: 'org-1', role: nav.role }, memberships: [], isLoading: false }) }))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/x',
  useSearchParams: () => nav.search,
  useParams: () => nav.params,
}))
vi.mock('@/lib/api', () => ({
  adminApi: { updateSpace: vi.fn(),
    getRoom: vi.fn(), getSpace: vi.fn(), getSpaces: vi.fn(), updateRoom: vi.fn(), duplicateRoom: vi.fn(), setAvailability: vi.fn(),
    copyAvailabilityToAllDays: vi.fn(), createBlock: vi.fn(), deleteBlock: vi.fn(), deleteRoom: vi.fn(), getHistory: vi.fn(),
    getBooking: vi.fn(), updateBookingDetails: vi.fn(), markBookingPaid: vi.fn(), deleteBooking: vi.fn(),
    getUser: vi.fn(), getPackages: vi.fn(), setUserRole: vi.fn(), grantHours: vi.fn(), extendPurchase: vi.fn(), updateUser: vi.fn(),
    sendPasswordReset: vi.fn(), setPassword: vi.fn(), removeMembership: vi.fn(), anonymiseUser: vi.fn(), deleteUser: vi.fn(),
    adjustPurchase: vi.fn(), updatePurchase: vi.fn(), createUser: vi.fn(),
    getPurchase: vi.fn(), deletePurchase: vi.fn(),
    getSupportRequest: vi.fn(), updateSupportRequestDetail: vi.fn(), deleteSupportRequest: vi.fn(),
    getAudit: vi.fn(), getUsers: vi.fn(),
    getOrganization: vi.fn(), updateOrganization: vi.fn(),
    uploadPhoto: vi.fn(), deletePhoto: vi.fn(), reorderPhotos: vi.fn(),
  },
}))

function http(status: number, detail: unknown): AxiosError {
  return new AxiosError('x', String(status), undefined, undefined, { status, statusText: 'x', data: { detail }, headers: {}, config: { headers: new AxiosHeaders() } })
}

function renderPage(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><ToastProvider>{ui}</ToastProvider></QueryClientProvider>)
}

const space: Space = { id: 's-1', org_id: 'org-1', name: 'Espaço Calmo', description: '', address: 'Rua', city: 'Lisboa', images: [], amenities: [], is_active: true, created_at: '', timezone: 'Europe/Lisbon', photos: [] }
const room: Room = { id: 'r-1', space_id: 's-1', org_id: 'org-1', name: 'Sala A', description: '', capacity: 4, hourly_rate: 11, images: [], photos: [], amenities: ['wifi'], color: '#A8D5BA', is_active: true }
const rules = [0, 1, 2].map((d) => ({ id: `rule-${d}`, room_id: 'r-1', day_of_week: d, open_time: '09:00:00', close_time: '18:00:00', is_active: true }))
const booking: Booking & { stripe_checkout_session_id: string | null } = {
  id: 'b1b1b1b1-0000-0000-0000-000000000001', org_id: 'org-1', room_id: 'r-1', user_id: 'u-1', start_time: '2030-03-04T10:00:00Z', end_time: '2030-03-04T12:00:00Z',
  duration_hours: 2, total_amount: 22, package_hours_used: 0, status: 'confirmed', payment_method: 'hourly', notes: 'Projetor', admin_note: null,
  access_code: '4321', room, user: { id: 'u-1', email: 'ana@x.pt', name: 'Ana' }, created_at: '2030-01-01T00:00:00Z',
  stripe_checkout_session_id: 'cs_test_abc', package_debits: [],
}
const orgUser: OrgUser = { id: 'u-1', email: 'ana@x.pt', name: 'Ana', role: 'member', joined_at: '2030-01-01T00:00:00Z', bookings_count: 1, created_at: '', disabled_at: null }
const action: AdminAction = { id: 'a-1', org_id: 'org-1', actor: { id: 'admin-1', name: 'Admin', email: 'admin@x.pt' }, entity_type: 'booking', entity_id: booking.id, action: 'price.override', before: { id: booking.id, total_amount: '22.00' }, after: { id: booking.id, total_amount: '20.00' }, reason: 'Desconto', request_id: 'q', created_at: '2030-01-02T10:00:00Z' }

beforeEach(() => {
  vi.clearAllMocks()
  nav.params = { id: 'r-1' }
  nav.search = new URLSearchParams()
  nav.role = 'owner'
  vi.mocked(adminApi.getSpaces).mockResolvedValue([{ ...space, rooms: [room] }])
  vi.mocked(adminApi.getHistory).mockResolvedValue({ actions: [], total: 0, page: 1, page_size: 20 })
  vi.mocked(adminApi.getPackages).mockResolvedValue([])
})

describe('Salas', () => {
  it('lists rooms across spaces with their space, and opens a row', async () => {
    renderPage(<AdminRoomsListPage />)
    const row = (await screen.findByText('Sala A')).closest('tr')!
    expect(within(row).getByText('Espaço Calmo')).toBeInTheDocument()
    await userEvent.setup().click(within(row).getByText('Sala A'))
    expect(nav.push).toHaveBeenCalledWith('/admin/rooms/r-1')
  })

  it('the room page saves the hours with copy-to-all-days and a closed-day toggle, and blocks an hour', async () => {
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room, space, rules, blocks: [], photo_count: 0, bookings: { total: 2, upcoming: 1 } })
    vi.mocked(adminApi.setAvailability).mockResolvedValue(rules)
    vi.mocked(adminApi.copyAvailabilityToAllDays).mockResolvedValue(rules)
    vi.mocked(adminApi.createBlock).mockResolvedValue({ id: 'k', org_id: 'org-1', room_id: 'r-1', start_time: '2030-03-04T09:00:00Z', end_time: '2030-03-04T10:00:00Z', reason: 'Obras', created_by: null, created_at: '' })
    const user = userEvent.setup()
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    expect(screen.getByText(/2 reserva\(s\), 1 por vir/)).toBeInTheDocument()
    // Monday..Wednesday open, the rest closed; close Tuesday, save.
    expect(screen.getByLabelText('Quarta-feira aberto')).toBeChecked()
    expect(screen.getByLabelText('Domingo aberto')).not.toBeChecked()
    await user.click(screen.getByLabelText('Terça-feira aberto'))
    await user.click(screen.getByRole('button', { name: 'Guardar horário' }))
    await waitFor(() => expect(adminApi.setAvailability).toHaveBeenCalledWith('r-1', [
      { day_of_week: 0, open_time: '09:00', close_time: '18:00' },
      { day_of_week: 2, open_time: '09:00', close_time: '18:00' },
    ], expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Copiar Segunda-feira para todos os dias' }))
    await waitFor(() => expect(adminApi.copyAvailabilityToAllDays).toHaveBeenCalledWith('r-1', 0, expect.anything()))
    // A block from the inline form.
    await user.type(screen.getByLabelText('Início'), '2030-03-04T09:00')
    await user.type(screen.getByLabelText('Fim'), '2030-03-04T10:00')
    await user.type(screen.getByLabelText('Motivo'), 'Obras')
    await user.click(screen.getByRole('button', { name: 'Bloquear' }))
    await waitFor(() => expect(adminApi.createBlock).toHaveBeenCalledWith('r-1', expect.objectContaining({ reason: 'Obras' }), expect.anything()))
  })

  it('deactivating a room with future bookings shows them as blockers (A07), and a space id is redirected', async () => {
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room, space, rules, blocks: [], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    vi.mocked(adminApi.updateRoom).mockRejectedValue(http(409, { message: 'Room has future bookings', total: 1, bookings: [{ id: 'b', start_time: '2030-03-04T10:00:00Z', end_time: '2030-03-04T11:00:00Z', status: 'confirmed', customer_email: 'ana@x.pt', customer_name: 'Ana' }] }))
    const user = userEvent.setup()
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ainda há 1 reserva(s)')
    expect(screen.getByRole('alert')).toHaveTextContent('Ana')

    vi.mocked(adminApi.getRoom).mockRejectedValue(http(404, 'Room not found'))
    vi.mocked(adminApi.getSpace).mockResolvedValue({ space, photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    nav.params = { id: 's-1' }
    renderPage(<AdminRoomPage />)
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/admin/spaces/s-1'))
  })
})

describe('Reserva', () => {
  beforeEach(() => {
    nav.params = { id: booking.id }
    vi.mocked(adminApi.getBooking).mockResolvedValue({ booking, history: [action] })
  })

  it('shows customer, payment with the Stripe id, access code, notes and the history diff', async () => {
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1, name: /Reserva #B1B1B1B1/ })
    expect(screen.getByRole('link', { name: 'ana@x.pt' })).toHaveAttribute('href', '/admin/users/u-1')
    expect(screen.getByTestId('booking-amount')).toHaveTextContent('22,00')
    expect(screen.getByText('cs_test_abc')).toBeInTheDocument()
    expect(screen.getByText('4321')).toBeInTheDocument()
    expect(screen.getByLabelText('Nota do cliente')).toHaveValue('Projetor')
    expect(screen.getByText('Valor corrigido')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByText('Valor corrigido').closest('button')!)
    expect(screen.getByText('22.00 → 20.00')).toBeInTheDocument()
  })

  it('"Corrigir valor" needs a reason and sends total_amount + reason', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({ booking: { ...booking, total_amount: 20 }, hours: undefined })
    const user = userEvent.setup()
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Corrigir valor' }))
    const dialog = await screen.findByRole('dialog')
    await user.clear(within(dialog).getByLabelText('Novo valor (€)'))
    await user.type(within(dialog).getByLabelText('Novo valor (€)'), '20')
    expect(within(dialog).getByRole('button', { name: 'Corrigir valor' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Motivo'), 'Desconto de fidelidade')
    await user.click(within(dialog).getByRole('button', { name: 'Corrigir valor' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith(booking.id, { total_amount: 20, reason: 'Desconto de fidelidade' }, expect.anything()))
  })

  it('a paid booking cannot be hard-deleted; cancelling asks for a reason and credits the hours by default (K01)', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({
      booking: { ...booking, status: 'cancelled' }, hours: undefined,
      credit: { id: 'c-1', hours: 2, expires_at: '2031-01-01T00:00:00Z' },
    })
    const user = userEvent.setup()
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('danger-disabled')).toHaveTextContent('cancele-a')
    await user.click(screen.getByRole('button', { name: 'Cancelar reserva' }))
    const dialog = await screen.findByRole('dialog')
    // 22,00 € at 11 €/h: the box names the 2h and starts ticked.
    expect(within(dialog).getByRole('checkbox', { name: /Creditar as horas ao cliente \(2h\)/ })).toBeChecked()
    await user.type(within(dialog).getByLabelText('Motivo'), 'Cliente pediu')
    await user.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith(
      booking.id, { status: 'cancelled', reason: 'Cliente pediu', admin_note: 'Cancelada pelo espaço: Cliente pediu' }, expect.anything(),
    ))
    expect((await screen.findAllByText(/Reserva cancelada\. 2h creditadas ao cliente\./))[0]).toBeInTheDocument()
  })

  it('unticking the credit sends credit_hours: false with the reason (K01)', async () => {
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({ booking: { ...booking, status: 'cancelled' }, hours: undefined })
    const user = userEvent.setup()
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Cancelar reserva' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Creditar as horas/ }))
    await user.type(within(dialog).getByLabelText('Motivo'), 'Não compareceu')
    await user.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith(
      booking.id, { status: 'cancelled', reason: 'Não compareceu', admin_note: 'Cancelada pelo espaço: Não compareceu', credit_hours: false }, expect.anything(),
    ))
  })

  it('a package booking offers no credit box; a cancelled one shows the credit it created (K01)', async () => {
    vi.mocked(adminApi.getBooking).mockResolvedValue({ booking: { ...booking, payment_method: 'package', package_hours_used: 2, stripe_checkout_session_id: null }, history: [] })
    const user = userEvent.setup()
    const { unmount } = renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Cancelar reserva' }))
    expect(within(await screen.findByRole('dialog')).queryByRole('checkbox')).toBeNull()
    unmount()

    vi.mocked(adminApi.getBooking).mockResolvedValue({
      booking: { ...booking, status: 'cancelled', cancellation_credit: { id: 'c-1', hours_total: 2, hours_remaining: 1.5, status: 'active', expires_at: '2031-01-01T00:00:00Z' } },
      history: [],
    })
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    const link = screen.getByTestId('booking-credit')
    expect(link).toHaveAttribute('href', '/admin/purchases/c-1')
    expect(link).toHaveTextContent('2h')
    expect(link.parentElement).toHaveTextContent('1,5h por usar')
  })

  it('an expired hold can be hard-deleted after typing the id', async () => {
    vi.mocked(adminApi.getBooking).mockResolvedValue({ booking: { ...booking, status: 'expired', stripe_checkout_session_id: null }, history: [] })
    vi.mocked(adminApi.deleteBooking).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await user.type(screen.getByLabelText(/para confirmar/), 'b1b1b1b1')
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => expect(adminApi.deleteBooking).toHaveBeenCalledWith(booking.id, 'b1b1b1b1', undefined, expect.anything()))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/bookings'))
  })
})

describe('Cliente', () => {
  beforeEach(() => {
    nav.params = { id: 'u-1' }
    vi.mocked(adminApi.getUser).mockResolvedValue({ user: orgUser, bookings: [booking], purchases: [], balance: { hours_available: 0, hours_expiring_next: null }, support_requests: [] })
  })

  it('shows the last reset sent, sends a new link, sets a password with confirmation and suspends', async () => {
    vi.mocked(adminApi.getHistory).mockResolvedValue({ actions: [{ ...action, action: 'password_reset.send', entity_type: 'user', entity_id: 'u-1', created_at: '2030-01-03T09:30:00Z' }], total: 1, page: 1, page_size: 50 })
    vi.mocked(adminApi.sendPasswordReset).mockResolvedValue({ sent_to: 'ana@x.pt', sent_at: 't' })
    vi.mocked(adminApi.setPassword).mockResolvedValue(orgUser)
    vi.mocked(adminApi.updateUser).mockResolvedValue({ ...orgUser, disabled_at: '2030-01-04T00:00:00Z' })
    const user = userEvent.setup()
    renderPage(<AdminUserPage />)
    await screen.findByRole('heading', { level: 1, name: /Ana/ })
    expect(await screen.findByText(/Última enviada a 3 jan 2030, 09:30/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar ligação de recuperação' }))
    await waitFor(() => expect(adminApi.sendPasswordReset).toHaveBeenCalledWith('u-1', expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Definir password' }))
    await screen.findByRole('dialog')
    const field = (label: string) => document.getElementById(label === 'Nova password' ? 'new-password' : 'confirm-password') as HTMLInputElement
    // No reveal: both fields are password inputs.
    expect(field('Nova password')).toHaveAttribute('type', 'password')
    expect(field('Confirmar')).toHaveAttribute('type', 'password')
    await user.type(field('Nova password'), 'definida123')
    await user.type(field('Confirmar'), 'diferente')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Definir password' }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('não coincidem')
    expect(adminApi.setPassword).not.toHaveBeenCalled()
    await user.clear(field('Confirmar'))
    await user.type(field('Confirmar'), 'definida123')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Definir password' }))
    await waitFor(() => expect(adminApi.setPassword).toHaveBeenCalledWith('u-1', 'definida123', expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Suspender conta' }))
    await waitFor(() => expect(adminApi.updateUser).toHaveBeenCalledWith('u-1', { disabled_at: expect.any(String) }, expect.anything()))
  })

  it('anonymises after typing the email and a reason; a referenced account has no hard delete', async () => {
    vi.mocked(adminApi.anonymiseUser).mockResolvedValue({ id: 'u-1', email: 'utilizador-u1@anon.invalid', name: 'Utilizador removido', disabled_at: 't' })
    const user = userEvent.setup()
    renderPage(<AdminUserPage />)
    await screen.findByRole('heading', { level: 1, name: /Ana/ })
    expect(screen.queryByText('Eliminar a conta definitivamente')).toBeNull()
    await user.type(screen.getByLabelText(/para confirmar/), 'ana@x.pt')
    await user.click(screen.getByRole('button', { name: 'Eliminar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Anonimizar esta conta' })
    await user.type(within(dialog).getByLabelText('Motivo'), 'Pedido RGPD')
    await user.click(within(dialog).getByRole('button', { name: 'Anonimizar' }))
    await waitFor(() => expect(adminApi.anonymiseUser).toHaveBeenCalledWith('u-1', { confirm: 'ana@x.pt', reason: 'Pedido RGPD' }, expect.anything()))
  })

  it('the new-customer page sends the link by default', async () => {
    vi.mocked(adminApi.createUser).mockResolvedValue({ ...orgUser, id: 'u-9' })
    const user = userEvent.setup()
    renderPage(<NewUserPage />)
    await user.type(screen.getByLabelText('Nome'), 'Nova')
    await user.type(screen.getByLabelText('Email'), 'nova@x.pt')
    await user.click(screen.getByRole('button', { name: 'Criar cliente' }))
    await waitFor(() => expect(adminApi.createUser).toHaveBeenCalledWith({ name: 'Nova', email: 'nova@x.pt' }, expect.anything()))
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/admin/users/u-9'))
  })

  it('the new-customer page sends a password when chosen, after a matching confirmation', async () => {
    vi.mocked(adminApi.createUser).mockResolvedValue({ ...orgUser, id: 'u-9' })
    const user = userEvent.setup()
    renderPage(<NewUserPage />)
    await user.click(screen.getByRole('radio', { name: /Definir password agora/ }))
    await user.type(screen.getByLabelText('Nome'), 'Outra')
    await user.type(screen.getByLabelText('Email'), 'outra@x.pt')
    await user.type(screen.getByLabelText('Password', { selector: 'input' }), 'definida123')
    await user.type(screen.getByLabelText('Confirmar', { selector: 'input' }), 'diferente1')
    await user.click(screen.getByRole('button', { name: 'Criar cliente' }))
    expect(await screen.findByText('As passwords não coincidem')).toBeInTheDocument()
    expect(adminApi.createUser).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Confirmar', { selector: 'input' }))
    await user.type(screen.getByLabelText('Confirmar', { selector: 'input' }), 'definida123')
    await user.click(screen.getByRole('button', { name: 'Criar cliente' }))
    await waitFor(() => expect(adminApi.createUser).toHaveBeenCalledWith({ name: 'Outra', email: 'outra@x.pt', password: 'definida123' }, expect.anything()))
  })
})

describe('Banco de horas', () => {
  it('adjusting below the debited hours shows the 409 inline', async () => {
    nav.params = { id: 'p-1' }
    vi.mocked(adminApi.getPurchase).mockResolvedValue({
      purchase: { id: 'p-1', user_id: 'u-1', package_id: 'k', org_id: 'org-1', hours_total: 10, hours_used: 4, hours_remaining: 6, amount_paid: 100, status: 'active', source: 'purchase' as const, source_booking_id: null, purchased_at: '2030-01-01T00:00:00Z', expires_at: '2031-01-01T00:00:00Z', package: { id: 'k', org_id: 'org-1', name: 'Pack 10', hours: 10, price: 100, validity_days: 365, is_active: true }, admin_note: null },
      user: { id: 'u-1', name: 'Ana', email: 'ana@x.pt' },
      debits: [{ booking_id: booking.id, hours: 4, start_time: booking.start_time, end_time: booking.end_time, status: 'confirmed', room_name: 'Sala A' }],
    })
    vi.mocked(adminApi.adjustPurchase).mockRejectedValue(http(409, { message: "The purchase's hours are held by bookings", blockers: [{ booking_id: booking.id, hours: '4.00', room_name: 'Sala A' }] }))
    const user = userEvent.setup()
    renderPage(<AdminPurchasePage />)
    await screen.findByRole('heading', { level: 1, name: /Pack 10/ })
    expect(screen.getByRole('link', { name: /4 mar 2030/ })).toHaveAttribute('href', `/admin/bookings/${booking.id}`)
    await user.click(screen.getByRole('button', { name: 'Ajustar horas' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Horas (±)'), '-8')
    await user.type(within(dialog).getByLabelText('Motivo'), 'Erro no registo')
    await user.click(within(dialog).getByRole('button', { name: 'Ajustar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('held by bookings')
    expect(screen.getByTestId('danger-disabled')).toHaveTextContent('cancele-a')
  })
})

describe('Pedido de ajuda', () => {
  it('shows the message, links, context, a mailto reply and moves the status', async () => {
    nav.params = { id: 'q-1' }
    vi.mocked(adminApi.getSupportRequest).mockResolvedValue({
      id: 'q-1', reference: 'ABCD1234', category: 'payment', status: 'new', contact_email: 'ana@x.pt', user_id: 'u-1', booking_id: booking.id, booking,
      message: 'O pagamento não passou.', context: { page_url: 'http://x/dashboard', viewport: '390x844' }, created_at: '2030-01-05T10:00:00Z', updated_at: '', admin_note: null, user: { id: 'u-1', name: 'Ana', email: 'ana@x.pt' },
    })
    vi.mocked(adminApi.updateSupportRequestDetail).mockResolvedValue({} as never)
    const user = userEvent.setup()
    renderPage(<AdminSupportRequestPage />)
    await screen.findByRole('heading', { level: 1, name: /Pedido #ABCD1234/ })
    expect(screen.getByText('O pagamento não passou.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Responder por email' })).toHaveAttribute('href', expect.stringContaining('mailto:ana@x.pt?subject='))
    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/admin/users/u-1')
    expect(screen.getByText('390x844')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Marcar em curso' }))
    await waitFor(() => expect(adminApi.updateSupportRequestDetail).toHaveBeenCalledWith('q-1', { status: 'in_progress' }, expect.anything()))
    await user.type(screen.getByRole('textbox', { name: 'Nota interna' }), 'Liguei')
    await user.click(screen.getByRole('button', { name: 'Guardar nota' }))
    await waitFor(() => expect(adminApi.updateSupportRequestDetail).toHaveBeenLastCalledWith('q-1', { admin_note: 'Liguei' }, expect.anything()))
  })
})

describe('Histórico', () => {
  it('lists the trail with filters and expands a row to its diff', async () => {
    vi.mocked(adminApi.getAudit).mockResolvedValue({ actions: [action], total: 1, page: 1, page_size: 25 })
    vi.mocked(adminApi.getUsers).mockResolvedValue({ users: [orgUser], total: 1, page: 1, page_size: 100 })
    const user = userEvent.setup()
    renderPage(<AdminAuditPage />)
    const row = (await screen.findByText('Admin')).closest('tr')!
    expect(within(row).getAllByText('Valor corrigido').length).toBeGreaterThan(0)
    await user.click(within(row).getByRole('button', { expanded: false }))
    expect(within(row).getByText('22.00 → 20.00')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'booking')
    expect(nav.replace).toHaveBeenCalledWith('/admin/x?entity_type=booking', { scroll: false })
  })
})

describe('Definições', () => {
  const org = { id: 'org-1', name: 'FlowSpace', slug: 'flowspace', plan: 'starter', contact_email: null, contact_phone: null, timezone: 'Europe/Lisbon', created_at: '', updated_at: '' }

  it('the owner saves the contact; an admin reads with a note and cannot save', async () => {
    vi.mocked(adminApi.getOrganization).mockResolvedValue(org)
    vi.mocked(adminApi.updateOrganization).mockResolvedValue({ ...org, contact_email: 'ola@flowspace.pt' })
    const user = userEvent.setup()
    const first = renderPage(<AdminSettingsPage />)
    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('FlowSpace'))
    expect(screen.queryByRole('status')).toBeNull()
    await user.type(screen.getByLabelText('Email de contacto'), 'ola@flowspace.pt')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(adminApi.updateOrganization).toHaveBeenCalledWith({ name: 'FlowSpace', contact_email: 'ola@flowspace.pt', contact_phone: null, timezone: 'Europe/Lisbon' }, expect.anything()))

    // A second mount would duplicate the field ids; the first goes first.
    first.unmount()
    nav.role = 'admin'
    const second = renderPage(<AdminSettingsPage />)
    expect(await within(second.container).findByText(/Só o proprietário/)).toBeInTheDocument()
    await waitFor(() => expect(within(second.container).getByLabelText('Nome')).toBeDisabled())
    expect(within(second.container).getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})

// Review on #65: blank clears a stored value; forms speak the space's clock.
describe('Review on #65 — clearing fields and the space clock', () => {
  it('a blank room description is sent as null, not omitted', async () => {
    nav.params = { id: 'r-1' }
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room: { ...room, description: 'Antiga' }, space, rules: [], blocks: [], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    vi.mocked(adminApi.updateRoom).mockResolvedValue({ ...room, description: null })
    const user = userEvent.setup()
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    // The form resets to the loaded values once they arrive; edit after that.
    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveValue('Antiga'))
    await user.clear(screen.getByLabelText('Descrição'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(adminApi.updateRoom).toHaveBeenCalledWith('r-1', expect.objectContaining({ description: null }), expect.anything()))
  })

  it('a blank space description, address or city is sent as null', async () => {
    nav.params = { id: 's-1' }
    vi.mocked(adminApi.getSpace).mockResolvedValue({ space: { ...space, description: 'Velha', address: 'Rua', city: 'Lisboa', rooms: [] }, photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    vi.mocked(adminApi.updateSpace).mockResolvedValue(space)
    const user = userEvent.setup()
    renderPage(<AdminSpacePage />)
    await screen.findByRole('heading', { level: 1, name: /Espaço Calmo/ })
    await waitFor(() => expect(screen.getByLabelText('Descrição')).toHaveValue('Velha'))
    await user.clear(screen.getByLabelText('Descrição'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(adminApi.updateSpace).toHaveBeenCalledWith('s-1', expect.objectContaining({ description: null, address: 'Rua', city: 'Lisboa' }), expect.anything()))
  })

  it('a customer without a name can still be saved; a blank name is null', async () => {
    nav.params = { id: 'u-1' }
    vi.mocked(adminApi.getUser).mockResolvedValue({ user: { ...orgUser, name: null }, bookings: [], purchases: [], balance: { hours_available: 0, hours_expiring_next: null }, support_requests: [] })
    vi.mocked(adminApi.updateUser).mockResolvedValue({ ...orgUser, name: null, email: 'nova@x.pt' })
    const user = userEvent.setup()
    renderPage(<AdminUserPage />)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('ana@x.pt'))
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'nova@x.pt')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(adminApi.updateUser).toHaveBeenCalledWith('u-1', { name: null, email: 'nova@x.pt' }, expect.anything()))
  })

  it('the move form shows and sends the room\'s space clock, not the browser\'s', async () => {
    nav.params = { id: booking.id }
    const tokyo = { ...space, id: 's-jp', timezone: 'Asia/Tokyo' }
    const roomJp = { ...room, id: 'r-jp', space_id: 's-jp', name: 'Sala Tóquio' }
    vi.mocked(adminApi.getSpaces).mockResolvedValue([{ ...tokyo, rooms: [roomJp] }])
    // 09:00Z is 18:00 in Tokyo.
    vi.mocked(adminApi.getBooking).mockResolvedValue({ booking: { ...booking, room_id: 'r-jp', room: roomJp, start_time: '2030-03-04T09:00:00Z', end_time: '2030-03-04T11:00:00Z', stripe_checkout_session_id: null }, history: [] })
    vi.mocked(adminApi.updateBookingDetails).mockResolvedValue({ booking, hours: undefined })
    const user = userEvent.setup()
    renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: 'Alterar horário' }))
    await waitFor(() => expect(screen.getByLabelText('Início')).toHaveValue('18:00'))
    expect(screen.getByLabelText('Fim')).toHaveValue('20:00')
    await user.clear(screen.getByLabelText('Fim'))
    await user.type(screen.getByLabelText('Fim'), '21:00')
    await user.click(screen.getByRole('button', { name: 'Guardar horário' }))
    await waitFor(() => expect(adminApi.updateBookingDetails).toHaveBeenCalledWith(booking.id, { start_time: '2030-03-04T09:00:00.000Z', end_time: '2030-03-04T12:00:00.000Z' }, expect.anything()))
  })

  it('a block typed on the room page is the space\'s wall clock', async () => {
    nav.params = { id: 'r-1' }
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room, space: { ...space, timezone: 'Asia/Tokyo' }, rules: [], blocks: [], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    vi.mocked(adminApi.createBlock).mockResolvedValue({ id: 'k', org_id: 'org-1', room_id: 'r-1', start_time: '2030-03-04T00:00:00Z', end_time: '2030-03-04T01:00:00Z', reason: 'Obras', created_by: null, created_at: '' })
    const user = userEvent.setup()
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    await user.type(screen.getByLabelText('Início'), '2030-03-04T09:00')
    await user.type(screen.getByLabelText('Fim'), '2030-03-04T10:00')
    await user.type(screen.getByLabelText('Motivo'), 'Obras')
    await user.click(screen.getByRole('button', { name: 'Bloquear' }))
    await waitFor(() => expect(adminApi.createBlock).toHaveBeenCalledWith('r-1', { start_time: '2030-03-04T00:00:00.000Z', end_time: '2030-03-04T01:00:00.000Z', reason: 'Obras' }, expect.anything()))
  })
})

// Review on #65, round 4.
describe('Review on #65 — round 4', () => {
  it('a day with two windows keeps both through the editor; a window can be added and removed', async () => {
    nav.params = { id: 'r-1' }
    const twoWindows = [
      { id: 'a', room_id: 'r-1', day_of_week: 0, open_time: '09:00:00', close_time: '12:00:00', is_active: true },
      { id: 'b', room_id: 'r-1', day_of_week: 0, open_time: '14:00:00', close_time: '18:00:00', is_active: true },
    ] as typeof rules
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room, space, rules: twoWindows, blocks: [], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    vi.mocked(adminApi.setAvailability).mockResolvedValue(twoWindows)
    const user = userEvent.setup()
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    // The editor fills in once the rules have landed, a tick after the heading.
    expect(await screen.findByLabelText('Segunda-feira abre')).toHaveValue('09:00')
    expect(screen.getByLabelText('Segunda-feira abre (2)')).toHaveValue('14:00')
    await user.click(screen.getByRole('button', { name: 'Guardar horário' }))
    await waitFor(() => expect(adminApi.setAvailability).toHaveBeenCalledWith('r-1', [
      { day_of_week: 0, open_time: '09:00', close_time: '12:00' },
      { day_of_week: 0, open_time: '14:00', close_time: '18:00' },
    ], expect.anything()))
    await user.click(screen.getByRole('button', { name: 'Remover período 2 de Segunda-feira' }))
    expect(screen.queryByLabelText('Segunda-feira abre (2)')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Adicionar período a Segunda-feira' }))
    expect(await screen.findByLabelText('Segunda-feira abre (2)')).toHaveValue('12:00')
  })

  it('the booking summary and the block list read on the space clock, like the forms', async () => {
    nav.params = { id: booking.id }
    const tokyo = { ...space, id: 's-jp', timezone: 'Asia/Tokyo' }
    const roomJp = { ...room, id: 'r-jp', space_id: 's-jp', name: 'Sala Tóquio' }
    vi.mocked(adminApi.getSpaces).mockResolvedValue([{ ...tokyo, rooms: [roomJp] }])
    vi.mocked(adminApi.getBooking).mockResolvedValue({ booking: { ...booking, room_id: 'r-jp', room: roomJp, start_time: '2030-03-04T09:00:00Z', end_time: '2030-03-04T11:00:00Z', stripe_checkout_session_id: null }, history: [] })
    const { unmount } = renderPage(<AdminBookingPage />)
    await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(screen.getByText(/^18:00–20:00/)).toBeInTheDocument())
    unmount()

    nav.params = { id: 'r-1' }
    vi.mocked(adminApi.getRoom).mockResolvedValue({ room, space: tokyo, rules: [], blocks: [{ id: 'k', org_id: 'org-1', room_id: 'r-1', start_time: '2030-03-04T00:00:00Z', end_time: '2030-03-04T01:00:00Z', reason: 'Obras', created_by: null, created_at: '' }], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    renderPage(<AdminRoomPage />)
    await screen.findByRole('heading', { level: 1, name: /Sala A/ })
    expect(screen.getByText(/09:00 – 10:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remover bloqueio 2030-03-04T09:00' })).toBeInTheDocument()
  })

  it('a new space starts on the organisation\'s timezone and sends it', async () => {
    vi.mocked(adminApi.getOrganization).mockResolvedValue({ id: 'org-1', name: 'Org', slug: 'org', plan: 'starter', contact_email: null, contact_phone: null, timezone: 'Asia/Tokyo', created_at: '', updated_at: '' })
    renderPage(<NewSpacePage />)
    await waitFor(() => expect(screen.getByLabelText('Fuso horário *')).toHaveValue('Asia/Tokyo'))
  })
})

// Review on #65, round 6: a pending checkout carries the price but nothing was paid.
describe('Review on #65 — round 6', () => {
  it('a pending purchase can be hard-deleted; a paid one cannot', async () => {
    nav.params = { id: 'p-1' }
    const base = { id: 'p-1', user_id: 'u-1', package_id: 'k', org_id: 'org-1', hours_total: 10, hours_used: 0, hours_remaining: 10, amount_paid: 100, source: 'purchase' as const, source_booking_id: null, purchased_at: '2030-01-01T00:00:00Z', expires_at: '2031-01-01T00:00:00Z', package: { id: 'k', org_id: 'org-1', name: 'Pack 10', hours: 10, price: 100, validity_days: 365, is_active: true }, admin_note: null }
    const user = { id: 'u-1', name: 'Ana', email: 'ana@x.pt' }
    vi.mocked(adminApi.getPurchase).mockResolvedValue({ purchase: { ...base, status: 'pending' }, user, debits: [] })
    const { unmount } = renderPage(<AdminPurchasePage />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByTestId('danger-disabled')).toBeNull()
    unmount()
    vi.mocked(adminApi.getPurchase).mockResolvedValue({ purchase: { ...base, status: 'active' }, user, debits: [] })
    renderPage(<AdminPurchasePage />)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByTestId('danger-disabled')).toHaveTextContent('cancele-a')
  })
})
