import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import NewSpacePage from '@/app/admin/spaces/new/page'
import AdminSpacesPage from '@/app/admin/spaces/page'
import { adminApi } from '@/lib/api'
import type { Space } from '@/types'

// C10: operators give a space a real location, in the new-space form and the
// edit dialog, with the same inline validation in both.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))
vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/lib/api', () => ({
  adminApi: { getSpaces: vi.fn(), createSpace: vi.fn(), updateSpace: vi.fn() },
}))

const space: Space = {
  id: 's-1', org_id: 'org-1', name: 'Espaço Calmo', description: '', address: 'R. 12 de Julho de 1997 5, Loja 1',
  city: 'Queluz', postal_code: '2745-841', latitude: 38.755723, longitude: -9.279799,
  images: [], amenities: [], is_active: true, created_at: '',
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/Nome do espaço/), 'Espaço Calmo')
  await user.type(screen.getByLabelText(/^Morada/), 'R. 12 de Julho de 1997 5, Loja 1')
  await user.type(screen.getByLabelText(/^Cidade/), 'Queluz')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getSpaces).mockResolvedValue([{ ...space, rooms: [] }])
  vi.mocked(adminApi.createSpace).mockResolvedValue(space)
  vi.mocked(adminApi.updateSpace).mockResolvedValue(space)
})

describe('new space form — location', () => {
  it('sends the postcode and both coordinates as numbers', async () => {
    const user = userEvent.setup()
    renderWithClient(<NewSpacePage />)
    await fillRequired(user)
    await user.type(screen.getByLabelText(/Código postal/), '2745-841')
    await user.type(screen.getByLabelText(/Latitude/), '38.755723')
    await user.type(screen.getByLabelText(/Longitude/), '-9.279799')
    await user.click(screen.getByRole('button', { name: 'Criar Espaço' }))

    await waitFor(() => expect(adminApi.createSpace).toHaveBeenCalled())
    expect(vi.mocked(adminApi.createSpace).mock.calls[0][0]).toMatchObject({
      postal_code: '2745-841', latitude: 38.755723, longitude: -9.279799,
    })
  })

  it('leaves the location out entirely when nothing is typed', async () => {
    const user = userEvent.setup()
    renderWithClient(<NewSpacePage />)
    await fillRequired(user)
    await user.click(screen.getByRole('button', { name: 'Criar Espaço' }))

    await waitFor(() => expect(adminApi.createSpace).toHaveBeenCalled())
    expect(vi.mocked(adminApi.createSpace).mock.calls[0][0]).toMatchObject({
      postal_code: null, latitude: null, longitude: null,
    })
  })

  it.each([
    ['a latitude past the pole', { lat: '91', lng: '0' }],
    ['a longitude past the antimeridian', { lat: '0', lng: '-180.5' }],
    ['text for a number', { lat: 'norte', lng: '0' }],
    ['one coordinate without the other', { lat: '38.755723', lng: '' }],
    ['the other coordinate without the one', { lat: '', lng: '-9.279799' }],
  ])('refuses %s inline, without calling the API', async (_label, { lat, lng }) => {
    const user = userEvent.setup()
    renderWithClient(<NewSpacePage />)
    await fillRequired(user)
    if (lat) await user.type(screen.getByLabelText(/Latitude/), lat)
    if (lng) await user.type(screen.getByLabelText(/Longitude/), lng)
    await user.click(screen.getByRole('button', { name: 'Criar Espaço' }))

    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0)
    expect(adminApi.createSpace).not.toHaveBeenCalled()
  })

  it('refuses a malformed postcode inline', async () => {
    const user = userEvent.setup()
    renderWithClient(<NewSpacePage />)
    await fillRequired(user)
    await user.type(screen.getByLabelText(/Código postal/), '27458')
    await user.click(screen.getByRole('button', { name: 'Criar Espaço' }))

    expect(await screen.findByRole('alert')).toBeVisible()
    expect(adminApi.createSpace).not.toHaveBeenCalled()
  })

  it('accepts a decimal comma', async () => {
    const user = userEvent.setup()
    renderWithClient(<NewSpacePage />)
    await fillRequired(user)
    await user.type(screen.getByLabelText(/Latitude/), '38,755723')
    await user.type(screen.getByLabelText(/Longitude/), '-9,279799')
    await user.click(screen.getByRole('button', { name: 'Criar Espaço' }))

    await waitFor(() => expect(adminApi.createSpace).toHaveBeenCalled())
    expect(vi.mocked(adminApi.createSpace).mock.calls[0][0]).toMatchObject({ latitude: 38.755723, longitude: -9.279799 })
  })

  it('splits a pair pasted from a maps app across both fields', async () => {
    renderWithClient(<NewSpacePage />)
    fireEvent.paste(screen.getByLabelText(/Latitude/), {
      clipboardData: { getData: () => '38.755723, -9.279799' },
    })
    await waitFor(() => expect(screen.getByLabelText(/Latitude/)).toHaveValue('38.755723'))
    expect(screen.getByLabelText(/Longitude/)).toHaveValue('-9.279799')
  })

  it('tells the operator where coordinates come from', () => {
    renderWithClient(<NewSpacePage />)
    expect(screen.getByText(/app de mapas/i)).toBeVisible()
  })
})

describe('edit space dialog — location', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    renderWithClient(<AdminSpacesPage />)
    await user.click(await screen.findByRole('button', { name: /Editar/ }))
    return screen.findByRole('dialog')
  }

  it('opens pre-filled with the stored location', async () => {
    const dialog = await openDialog(userEvent.setup())
    expect(within(dialog).getByLabelText(/Código postal/)).toHaveValue('2745-841')
    expect(within(dialog).getByLabelText(/Latitude/)).toHaveValue('38.755723')
    expect(within(dialog).getByLabelText(/Longitude/)).toHaveValue('-9.279799')
  })

  it('always sends the coordinates together', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.clear(within(dialog).getByLabelText(/Latitude/))
    await user.type(within(dialog).getByLabelText(/Latitude/), '38.76')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(adminApi.updateSpace).toHaveBeenCalled())
    expect(vi.mocked(adminApi.updateSpace).mock.calls[0][1]).toMatchObject({ latitude: 38.76, longitude: -9.279799 })
  })

  it('clears the location with explicit nulls', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    for (const label of [/Código postal/, /Latitude/, /Longitude/]) {
      await user.clear(within(dialog).getByLabelText(label))
    }
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(adminApi.updateSpace).toHaveBeenCalled())
    expect(vi.mocked(adminApi.updateSpace).mock.calls[0][1]).toMatchObject({
      postal_code: null, latitude: null, longitude: null,
    })
  })

  it('refuses half a coordinate inline', async () => {
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.clear(within(dialog).getByLabelText(/Longitude/))
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))

    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(adminApi.updateSpace).not.toHaveBeenCalled()
  })
})
