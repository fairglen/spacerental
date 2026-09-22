import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminRoomsPage from '@/app/admin/rooms/[id]/page'
import { adminApi, spacesApi } from '@/lib/api'
import type { Room, Space, AvailabilityRule } from '@/types'

// B8: rooms can be edited from the admin UI.
// B11: room availability rules have an admin UI that shows current rules and
// resubmits the full set (the backend endpoint replaces all rules on POST).

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))

vi.mock('@/lib/hooks/useApi', () => ({
  useApi: () => ({}),
}))

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))

vi.mock('@/lib/api', () => ({
  spacesApi: { get: vi.fn() },
  adminApi: {
    getSpaces: vi.fn(),
    uploadPhoto: vi.fn(),
    deletePhoto: vi.fn(),
    reorderPhotos: vi.fn(),
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    getAvailability: vi.fn(),
    setAvailability: vi.fn(),
  },
}))

const space: Space = {
  id: 'space-1',
  org_id: 'org-1',
  name: 'Espaço Calmo',
  description: '',
  address: '',
  city: 'Lisboa',
  images: [],
  amenities: [],
  is_active: true,
  created_at: new Date().toISOString(),
}

const room: Room = {
  id: 'room-1',
  space_id: 'space-1',
  org_id: 'org-1',
  name: 'Sala Calma',
  description: '',
  capacity: 4,
  hourly_rate: 11,
  images: [],
  amenities: [],
  color: '#A8D5BA',
  is_active: true,
}

const closedRoom: Room = { ...room, id: 'room-2', name: 'Sala Fechada', is_active: false }

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminRoomsPage params={{ id: 'space-1' }} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(spacesApi.get).mockResolvedValue({ space, rooms: [room] })
  // The operator's own listing: unlike the public one it includes rooms that
  // are switched off, which is the only way to switch one back on (C15).
  vi.mocked(adminApi.getSpaces).mockResolvedValue([{ ...space, rooms: [room, closedRoom] }])
})

describe('AdminRoomsPage edit room (B8)', () => {
  it('opens an edit dialog pre-filled and submits an update', async () => {
    vi.mocked(adminApi.updateRoom).mockResolvedValue({ ...room, hourly_rate: 15 })
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: /Editar/i }))[0])
    const dialog = await screen.findByRole('dialog')
    const rateInput = within(dialog).getByDisplayValue('11')
    await user.clear(rateInput)
    await user.type(rateInput, '15')
    await user.click(within(dialog).getByRole('button', { name: /Guardar/i }))

    await waitFor(() => {
      expect(adminApi.updateRoom).toHaveBeenCalledWith(
        'room-1',
        expect.objectContaining({ hourly_rate: 15, name: 'Sala Calma', capacity: 4 }),
        expect.anything(),
      )
    })
  })
})

describe('AdminRoomsPage availability rules (B11)', () => {
  const rules: AvailabilityRule[] = [
    { id: 'r1', room_id: 'room-1', day_of_week: 0, open_time: '08:00:00', close_time: '20:00:00', is_active: true },
  ]

  it('shows the current rules and resubmits the full replacement set on save', async () => {
    vi.mocked(adminApi.getAvailability).mockResolvedValue(rules)
    vi.mocked(adminApi.setAvailability).mockResolvedValue([])
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: /Horários/i }))[0])
    const dialog = await screen.findByRole('dialog')

    const mondayCheckbox = await within(dialog).findByRole('checkbox', { name: /Segunda-feira/i })
    await waitFor(() => expect(mondayCheckbox).toBeChecked())
    expect(within(dialog).getByRole('checkbox', { name: /Domingo/i })).not.toBeChecked()

    const tuesdayCheckbox = within(dialog).getByRole('checkbox', { name: /Terça-feira/i })
    await user.click(tuesdayCheckbox)

    await user.click(within(dialog).getByRole('button', { name: /Guardar Horários/i }))

    await waitFor(() => expect(adminApi.setAvailability).toHaveBeenCalled())
    const [roomIdArg, submittedRules] = vi.mocked(adminApi.setAvailability).mock.calls[0]
    expect(roomIdArg).toBe('room-1')
    expect(submittedRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ day_of_week: 0, open_time: '08:00', close_time: '20:00' }),
        expect.objectContaining({ day_of_week: 1 }),
      ]),
    )
    expect(submittedRules).toHaveLength(2)
  })
})

// C15: everything a customer sees about a room is editable here.
describe('AdminRoomsPage — every customer-visible field, and photos (C15)', () => {
  it('edits description, amenities and whether the room is active', async () => {
    vi.mocked(adminApi.updateRoom).mockResolvedValue(room)
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: /Editar/i }))[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Descrição/), 'Luz natural')
    await user.type(within(dialog).getByLabelText(/Comodidades/), 'WiFi, Marquesa')
    await user.click(within(dialog).getByRole('checkbox', { name: /Sala ativa/ }))
    await user.click(within(dialog).getByRole('button', { name: /Guardar/i }))

    await waitFor(() => expect(adminApi.updateRoom).toHaveBeenCalled())
    expect(vi.mocked(adminApi.updateRoom).mock.calls[0][1]).toMatchObject({
      description: 'Luz natural', amenities: ['WiFi', 'Marquesa'], is_active: false,
    })
  })

  it('lists a room that is switched off, marked, so it can be switched back on', async () => {
    vi.mocked(adminApi.updateRoom).mockResolvedValue({ ...closedRoom, is_active: true })
    const user = userEvent.setup()
    renderPage()

    const card = (await screen.findByText('Sala Fechada')).closest('[data-testid="admin-room-card"]') as HTMLElement
    expect(within(card).getByText('Inativa')).toBeVisible()
    await user.click(within(card).getByRole('button', { name: /Editar/i }))
    const dialog = await screen.findByRole('dialog')
    const active = within(dialog).getByRole('checkbox', { name: /Sala ativa/ })
    expect(active).not.toBeChecked()
    await user.click(active)
    await user.click(within(dialog).getByRole('button', { name: /Guardar/i }))
    await waitFor(() => expect(vi.mocked(adminApi.updateRoom).mock.calls[0][1]).toMatchObject({ is_active: true }))
  })

  it('has a Fotografias section for the room being edited', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click((await screen.findAllByRole('button', { name: /Editar/i }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Fotografias' })).toBeVisible()
    expect(within(dialog).getByLabelText(/adicionar fotografias/i)).toBeEnabled()
  })
})
