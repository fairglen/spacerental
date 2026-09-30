import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { EntityList, type Column } from '@/components/admin/crud/EntityList'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { ReasonDialog } from '@/components/admin/crud/ReasonDialog'
import { HistoryRow, changedKeys, actionLabel } from '@/components/admin/crud/HistoryPanel'
import { Breadcrumbs, PageHeader } from '@/components/admin/crud/PageHeader'
import { parseApiError, blockerLines } from '@/components/admin/crud/apiErrors'
import { ToastProvider } from '@/components/ui/toast'
import { Input } from '@/components/ui/input'
import type { AdminAction } from '@/types'

const push = vi.fn()
const replace = vi.fn()
let params = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/things',
  useSearchParams: () => params,
}))

beforeEach(() => {
  vi.clearAllMocks()
  params = new URLSearchParams()
})

function http(status: number, detail: unknown): AxiosError {
  return new AxiosError('x', String(status), undefined, undefined, {
    status, statusText: 'x', data: { detail }, headers: {}, config: { headers: new AxiosHeaders() },
  })
}

type Thing = { id: string; name: string; n: number }
const columns: Column<Thing>[] = [
  { key: 'name', header: 'Nome', render: (t) => t.name, sortKey: 'name' },
  { key: 'n', header: 'N', render: (t) => String(t.n) },
]
const rows: Thing[] = [
  { id: 'aaaaaaaa-1', name: 'Alfa', n: 1 },
  { id: 'bbbbbbbb-2', name: 'Beta', n: 2 },
  { id: 'cccccccc-3', name: 'Gama', n: 3 },
]

describe('EntityList', () => {
  it('renders a captioned table with 44px rows, opens a row on click and on Enter, and moves with the arrows', async () => {
    const user = userEvent.setup()
    render(
      <EntityList caption="Coisas" columns={columns} rows={rows} rowKey={(t) => t.id} rowHref={(t) => `/admin/things/${t.id}`}
        page={1} pageSize={20} total={3} onPageChange={vi.fn()} empty={{ title: 'Nada' }} />,
    )
    expect(screen.getByRole('table', { name: 'Coisas' })).toBeInTheDocument()
    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(bodyRows).toHaveLength(3)
    expect(bodyRows[0].className).toContain('h-11')
    await user.click(within(bodyRows[1]).getByText('Beta'))
    expect(push).toHaveBeenCalledWith('/admin/things/bbbbbbbb-2')
    bodyRows[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(bodyRows[1])
    await user.keyboard('{ArrowDown}{ArrowUp}')
    expect(document.activeElement).toBe(bodyRows[1])
    await user.keyboard('{Enter}')
    expect(push).toHaveBeenLastCalledWith('/admin/things/bbbbbbbb-2')
  })

  it('debounces the search by 300ms and emits filter, sort and page changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onSearch = vi.fn()
    const onFilter = vi.fn()
    const onSort = vi.fn()
    const onPage = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(
      <EntityList caption="Coisas" columns={columns} rows={rows} rowKey={(t) => t.id}
        page={1} pageSize={2} total={3} onPageChange={onPage}
        search={{ value: '', onChange: onSearch }}
        filters={{ chips: [{ key: 'estado', label: 'Estado', options: [{ value: 'on', label: 'Ligado' }] }], values: {}, onChange: onFilter }}
        sort={{ options: [{ value: 'name', label: 'Nome' }, { value: '-name', label: 'Nome ↓' }], value: 'name', onChange: onSort }}
        empty={{ title: 'Nada' }} />,
    )
    await user.type(screen.getByRole('textbox', { name: 'Pesquisar' }), 'al')
    expect(onSearch).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(350) })
    expect(onSearch).toHaveBeenCalledWith('al')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'on')
    expect(onFilter).toHaveBeenCalledWith('estado', 'on')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ordenar' }), '-name')
    expect(onSort).toHaveBeenCalledWith('-name')
    await user.click(screen.getByRole('button', { name: 'Ordenar por Nome' }))
    expect(onSort).toHaveBeenLastCalledWith('-name')
    await user.click(screen.getByRole('button', { name: 'Seguinte' }))
    expect(onPage).toHaveBeenCalledWith(2)
    vi.useRealTimers()
  })

  it('shows skeletons while loading, an error with retry, and the empty state with its action', () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <EntityList caption="Coisas" columns={columns} rows={undefined} rowKey={(t) => t.id} page={1} pageSize={20} onPageChange={vi.fn()} isLoading empty={{ title: 'Nada' }} />,
    )
    expect(screen.getAllByRole('row', { hidden: true }).length).toBeGreaterThan(1)
    rerender(
      <EntityList caption="Coisas" columns={columns} rows={undefined} rowKey={(t) => t.id} page={1} pageSize={20} onPageChange={vi.fn()} isError onRetry={onRetry} empty={{ title: 'Nada' }} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar')
    screen.getByRole('button', { name: 'Tentar novamente' }).click()
    expect(onRetry).toHaveBeenCalled()
    rerender(
      <EntityList caption="Coisas" columns={columns} rows={[]} rowKey={(t) => t.id} page={1} pageSize={20} onPageChange={vi.fn()} empty={{ title: 'Nada por aqui', action: <button>Criar</button> }} />,
    )
    expect(screen.getByText('Nada por aqui')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Criar' })).toBeVisible()
  })

  it('offers a per-row menu whose items act on that row', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(
      <EntityList caption="Coisas" columns={columns} rows={rows} rowKey={(t) => t.id} page={1} pageSize={20} onPageChange={vi.fn()} empty={{ title: 'Nada' }}
        rowActions={[{ label: 'Duplicar', onSelect }, { label: 'Só Beta', onSelect, hidden: (t) => t.name !== 'Beta' }]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Ações para aaaaaaaa' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).queryByRole('menuitem', { name: 'Só Beta' })).toBeNull()
    await user.click(within(menu).getByRole('menuitem', { name: 'Duplicar' }))
    expect(onSelect).toHaveBeenCalledWith(rows[0])
    expect(push).not.toHaveBeenCalled()
  })
})

type FormValues = { name: string; capacity: number }
function Harness({ onSubmit, onSaved }: { onSubmit: (v: FormValues) => Promise<unknown>; onSaved?: () => void }) {
  const form = useForm<FormValues>({ defaultValues: { name: 'Sala', capacity: 2 } })
  return (
    <ToastProvider>
      <EntityForm form={form} onSubmit={onSubmit} onSaved={onSaved} successMessage="Sala guardada.">
        <FormSection title="Detalhes">
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}>
            <Input id="name" {...form.register('name')} />
          </FormField>
          <FormField id="capacity" label="Lotação" error={form.formState.errors.capacity?.message}>
            <Input id="capacity" type="number" {...form.register('capacity', { valueAsNumber: true })} />
          </FormField>
        </FormSection>
      </EntityForm>
    </ToastProvider>
  )
}

describe('EntityForm', () => {
  it('keeps "Guardar" disabled until dirty, saves, toasts and refetches', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSubmit={onSubmit} onSaved={onSaved} />)
    const save = screen.getByRole('button', { name: 'Guardar' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Nome'), ' B')
    expect(save).toBeEnabled()
    await user.click(save)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sala B' })))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(await screen.findByText('Sala guardada.')).toBeInTheDocument()
    // Clean again after the save.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled())
  })

  it('maps a 422 to the field and a 409 to a banner with the blockers', async () => {
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(http(422, [{ loc: ['body', 'capacity'], msg: 'Input should be greater than 0' }]))
      .mockRejectedValueOnce(http(409, { message: 'Room has future bookings', blockers: { bookings: 2, blocks: 0 } }))
    const user = userEvent.setup()
    render(<Harness onSubmit={onSubmit} />)
    await user.clear(screen.getByLabelText('Lotação'))
    await user.type(screen.getByLabelText('Lotação'), '0')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Input should be greater than 0')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Lotação'), '1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    const banner = await screen.findByText('Room has future bookings')
    expect(banner.closest('[role=alert]')).toHaveTextContent('reservas: 2')
  })

  it('guards against leaving with unsaved changes', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <>
        <a href="/admin/elsewhere">Sair</a>
        <Harness onSubmit={vi.fn()} />
      </>,
    )
    await user.type(screen.getByLabelText('Nome'), 'X')
    await user.click(screen.getByRole('link', { name: 'Sair' }))
    expect(confirm).toHaveBeenCalled()
    const beforeunload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeunload)
    expect(beforeunload.defaultPrevented).toBe(true)
    confirm.mockRestore()
  })
})

describe('DangerZone', () => {
  it('enables the hard delete only when the name or the short id is typed, and lists blockers on a 409', async () => {
    const onDelete = vi.fn().mockRejectedValueOnce(http(409, { message: 'Rooms of this space have bookings', blockers: [{ room_id: 'r', name: 'Sala A', bookings: 2 }] })).mockResolvedValue(undefined)
    const onToggle = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <DangerZone entityLabel="espaço" name="Espaço Um" shortId="abcd1234" keeps="As reservas ficam."
        soft={{ active: true, onToggle }} hard={{ onDelete }} />,
    )
    const del = screen.getByRole('button', { name: 'Eliminar' })
    expect(del).toBeDisabled()
    await user.type(screen.getByLabelText(/para confirmar/), 'errado')
    expect(del).toBeDisabled()
    await user.clear(screen.getByLabelText(/para confirmar/))
    await user.type(screen.getByLabelText(/para confirmar/), 'abcd1234')
    expect(del).toBeEnabled()
    await user.click(del)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sala A: 2 reserva(s)')
    expect(onDelete).toHaveBeenCalledWith('abcd1234')
    await user.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(onToggle).toHaveBeenCalled())
  })

  it('explains when the hard delete is not available', () => {
    render(<DangerZone entityLabel="reserva" name="x" shortId="abcd1234" keeps="k" hard={{ onDelete: vi.fn(), disabledReason: 'Esta reserva movimentou dinheiro: cancele-a em vez de a eliminar.' }} />)
    expect(screen.getByTestId('danger-disabled')).toHaveTextContent('cancele-a')
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull()
  })
})

describe('ReasonDialog', () => {
  it('needs at least five characters, confirms with the reason and shows the API refusal', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(http(409, 'Nope')).mockResolvedValue(undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<ReasonDialog open title="Corrigir valor" onConfirm={onConfirm} onClose={onClose} confirmLabel="Corrigir" />)
    const ok = screen.getByRole('button', { name: 'Corrigir' })
    expect(ok).toBeDisabled()
    await user.type(screen.getByLabelText('Motivo'), 'abcd')
    expect(ok).toBeDisabled()
    await user.type(screen.getByLabelText('Motivo'), 'e')
    expect(ok).toBeEnabled()
    await user.click(ok)
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope')
    expect(onClose).not.toHaveBeenCalled()
    await user.click(ok)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenLastCalledWith('abcde')
  })
})

describe('HistoryRow and helpers', () => {
  const action: AdminAction = {
    id: 'a1', org_id: 'o', actor: { id: 'u', name: 'Ana', email: 'ana@x.pt' }, entity_type: 'room', entity_id: 'r',
    action: 'update', before: { id: 'r', capacity: 4 }, after: { id: 'r', capacity: 6 }, reason: null, request_id: 'q',
    created_at: '2026-09-30T10:00:00Z',
  }
  it('lists the actor, the label, the changed keys and expands to the diff', async () => {
    const user = userEvent.setup()
    render(<ul><HistoryRow action={action} /></ul>)
    expect(screen.getByText('Editado')).toBeInTheDocument()
    expect(screen.getByText(/Ana/)).toBeInTheDocument()
    expect(screen.getByText(/capacity/)).toBeInTheDocument()
    await user.click(screen.getByRole('button'))
    expect(screen.getByText('4 → 6')).toBeInTheDocument()
    expect(changedKeys(action)).toEqual(['capacity'])
    expect(actionLabel('price.override')).toBe('Valor corrigido')
    expect(actionLabel('something.new')).toBe('something.new')
  })
})

describe('PageHeader and Breadcrumbs', () => {
  it('marks the current crumb and renders the actions', () => {
    render(<PageHeader title="Sala A" crumbs={[{ label: 'Salas', href: '/admin/rooms' }, { label: 'Sala A' }]} actions={<button>Duplicar</button>} />)
    expect(screen.getByRole('link', { name: 'Salas' })).toHaveAttribute('href', '/admin/rooms')
    expect(screen.getByText('Sala A', { selector: '[aria-current=page]' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sala A')
    expect(screen.getByRole('button', { name: 'Duplicar' })).toBeInTheDocument()
    render(<Breadcrumbs items={[{ label: 'Só' }]} />)
  })
})

describe('apiErrors', () => {
  it('parses 422 field lists, 409 blockers, strings and network failures', () => {
    expect(parseApiError(http(422, [{ loc: ['body', 'email'], msg: 'Value error, invalid' }])).fields).toEqual({ email: 'invalid' })
    const conflict = parseApiError(http(409, { message: 'm', blockers: { purchases: 1 } }))
    expect(conflict.message).toBe('m')
    expect(blockerLines(conflict.blockers)).toEqual(['compras: 1'])
    expect(parseApiError(http(400, 'Plain')).message).toBe('Plain')
    expect(parseApiError(new Error('net')).message).toContain('Sem ligação')
    expect(blockerLines([{ booking_id: 'abcdef12-x', hours: '4.00', room_name: 'Sala' }])).toEqual(['Reserva abcdef12: 4.00 h · Sala'])
  })
})
