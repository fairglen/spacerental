import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminBillingPage from '@/app/admin/billing/page'
import { sums } from '@/components/admin/billing/RegisterInvoiceDialog'
import { adminApi } from '@/lib/api'
import type { BillingStatement, BillingSummary, Invoice, StatementLine } from '@/types'

// I06: the operator's billing page — the statement per customer for a
// period, "Registar fatura emitida" from a line's pending transactions, and
// the registered invoices.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token' }, status: 'authenticated' }),
}))

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({ currentOrgId: 'org-1', memberships: [], currentMembership: null, setCurrentOrgId: vi.fn(), isLoading: false }),
}))

vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/admin/billing',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/lib/download', () => ({ saveBlob: vi.fn() }))

vi.mock('@/lib/api', () => ({
  adminApi: {
    getBillingSummary: vi.fn(),
    getBillingStatement: vi.fn(),
    downloadBillingCsv: vi.fn(),
    getInvoices: vi.fn(),
    createInvoice: vi.fn(),
    updateInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    downloadInvoicePdf: vi.fn(),
  },
}))

const ana: StatementLine = {
  user: { id: 'ana', name: 'Test User', email: 'user@test.com', tax_id: '123456789', billing_name: null, billing_address: null },
  amount: '88.00',
  hours: '8.00',
  transactions_count: 4,
  breakdown: { packs: [{ name: 'Pack 5h', count: 1 }], hourly_hours: '2.00', mixed_hours: '1.00', manual_hours: '0.00' },
  invoiced_amount: '0.00',
  pending_amount: '88.00',
  transactions: [
    { kind: 'hourly', id: 'b1', paid_at: '2026-08-31T23:30:00Z', label: 'Sala Calma · 07/10/2026 10:00–11:00', amount: '11.00', hours: '1.00', channel: 'online', invoice_id: null },
    { kind: 'hourly', id: 'b2', paid_at: '2026-09-05T10:00:00Z', label: 'Sala Calma · 01/10/2026 10:00–11:00', amount: '11.00', hours: '1.00', channel: 'online', invoice_id: null },
    { kind: 'mixed', id: 'b3', paid_at: '2026-09-10T10:00:00Z', label: 'Sala Calma · 02/10/2026 10:00–12:00', amount: '11.00', hours: '1.00', channel: 'online', invoice_id: null },
    { kind: 'pack', id: 'p1', paid_at: '2026-09-20T10:00:00Z', label: 'Pack 5h', amount: '55.00', hours: '5.00', channel: 'online', invoice_id: null },
  ],
}
const bruno: StatementLine = {
  user: { id: 'bruno', name: 'Bruno Costa', email: 'bruno@test.com', tax_id: null, billing_name: 'Clínica B, Lda.', billing_address: null },
  amount: '133.00',
  hours: '13.00',
  transactions_count: 3,
  breakdown: { packs: [{ name: 'Pack 10h', count: 1 }], hourly_hours: '1.00', mixed_hours: '0.00', manual_hours: '2.00' },
  invoiced_amount: '133.00',
  pending_amount: '0.00',
  transactions: [
    { kind: 'manual', id: 'b4', paid_at: '2026-09-12T10:00:00Z', label: 'Sala Calma · 03/10/2026 09:00–11:00', amount: '22.00', hours: '2.00', channel: 'manual', invoice_id: 'inv-1' },
    { kind: 'pack', id: 'p2', paid_at: '2026-09-15T10:00:00Z', label: 'Pack 10h', amount: '100.00', hours: '10.00', channel: 'online', invoice_id: 'inv-1' },
    { kind: 'hourly', id: 'b5', paid_at: '2026-09-22T10:00:00Z', label: 'Sala Calma · 04/10/2026 10:00–11:00', amount: '11.00', hours: '1.00', channel: 'online', invoice_id: 'inv-1' },
  ],
}
const statement: BillingStatement = { from: '2026-09-01', to: '2026-09-30', invoiced: 'all', lines: [bruno, ana] }
const summary: BillingSummary = {
  from: '2026-09-01', to: '2026-09-30', received_total: '221.00', by_channel: { online: '199.00', manual: '22.00' },
  pack_sales: [{ package_id: 'p10', name: 'Pack 10h', count: 1, amount: '100.00', hours: '10.00' }, { package_id: 'p5', name: 'Pack 5h', count: 1, amount: '55.00', hours: '5.00' }],
  hourly: { count: 3, amount: '33.00', hours: '3.00' }, mixed: { count: 1, amount: '11.00', hours: '1.00' }, manual: { count: 1, amount: '22.00', hours: '2.00' },
  transactions_count: 7, invoiced_amount: '133.00', pending_amount: '88.00',
}
const invoice: Invoice = {
  id: 'inv-1', org_id: 'org-1', user_id: 'bruno', number: 'FT 2026/11', issued_at: '2026-10-01', period_from: '2026-09-01', period_to: '2026-09-30',
  amount: '133.00', hours: '13.00', currency: 'EUR', note: null, has_pdf: true, created_by_admin_id: 'admin', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  user: { id: 'bruno', name: 'Bruno Costa', email: 'bruno@test.com', tax_id: null, billing_name: 'Clínica B, Lda.' },
  items: [{ kind: 'booking', id: 'b4' }, { kind: 'purchase', id: 'p2' }, { kind: 'booking', id: 'b5' }],
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminBillingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(adminApi.getBillingSummary).mockResolvedValue(summary)
  vi.mocked(adminApi.getBillingStatement).mockResolvedValue(statement)
  vi.mocked(adminApi.getInvoices).mockResolvedValue([invoice])
})

describe('admin billing (I06)', () => {
  it('lists the period per customer and registers an invoice from the pending transactions', async () => {
    vi.mocked(adminApi.createInvoice).mockResolvedValue({ ...invoice, id: 'inv-2', number: 'FT 2026/12', user_id: 'ana' })
    const user = userEvent.setup()
    renderPage()
    const rows = await screen.findAllByTestId('statement-line')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Clínica B, Lda.')
    expect(rows[0]).toHaveTextContent('Faturada')
    expect(within(rows[0]).getByRole('button', { name: 'Registar fatura emitida' })).toBeDisabled()
    expect(rows[1]).toHaveTextContent('NIF 123456789')
    expect(rows[1]).toHaveTextContent(/88,00\s?€/)
    expect(within(screen.getByTestId('billing-summary')).getByText('Resumo do período')).toBeInTheDocument()

    await user.click(within(rows[1]).getByRole('button', { name: 'Ver transações' }))
    expect(screen.getByRole('table', { name: 'Transações de user@test.com' })).toHaveTextContent('Pack 5h')

    await user.click(within(rows[1]).getByRole('button', { name: 'Registar fatura emitida' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByTestId('invoice-amount')).toHaveTextContent(/88,00\s?€/)
    expect(within(dialog).getByTestId('invoice-hours')).toHaveTextContent('8h')
    await user.click(within(dialog).getByLabelText('Pack · Pack 5h'))
    expect(within(dialog).getByTestId('invoice-amount')).toHaveTextContent(/33,00\s?€/)
    expect(within(dialog).getByTestId('invoice-hours')).toHaveTextContent('3h')

    await user.click(within(dialog).getByRole('button', { name: 'Registar fatura' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Indique o número da fatura.')
    expect(adminApi.createInvoice).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Nº da fatura'), 'FT 2026/12')
    await user.click(within(dialog).getByRole('button', { name: 'Registar fatura' }))
    await waitFor(() => expect(adminApi.createInvoice).toHaveBeenCalledTimes(1))
    const body = vi.mocked(adminApi.createInvoice).mock.calls[0][0]
    expect(body).toMatchObject({
      user_id: 'ana',
      number: 'FT 2026/12',
      amount: '33.00',
      hours: '3.00',
      transaction_ids: ['hourly:b1', 'hourly:b2', 'mixed:b3'],
      notify: true,
      pdf: null,
    })
    expect(body.period_from).toMatch(/^\d{4}-\d{2}-01$/)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('the invoiced filter and a custom period reach the API', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('statement-line')
    await user.selectOptions(screen.getByLabelText('Estado da faturação'), 'pending')
    await waitFor(() => expect(adminApi.getBillingStatement).toHaveBeenLastCalledWith(expect.objectContaining({ invoiced: 'pending' }), expect.anything()))

    await user.selectOptions(screen.getByLabelText('Período'), 'custom')
    await user.clear(screen.getByLabelText('De'))
    await user.type(screen.getByLabelText('De'), '2026-09-30')
    await user.clear(screen.getByLabelText('Até'))
    await user.type(screen.getByLabelText('Até'), '2026-09-01')
    expect(screen.getByRole('alert')).toHaveTextContent('Indique duas datas por ordem')
  })

  it('the registered invoices tab lists them and deletes after a confirmation', async () => {
    vi.mocked(adminApi.deleteInvoice).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage()
    await screen.findAllByTestId('statement-line')
    await user.click(screen.getByRole('tab', { name: /Faturas registadas \(1\)/ }))
    const row = screen.getByTestId('invoice-row')
    expect(row).toHaveTextContent('FT 2026/11')
    expect(row).toHaveTextContent(/133,00\s?€/)
    expect(within(row).getByRole('button', { name: 'Transferir PDF FT 2026/11' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Eliminar FT 2026/11' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('voltam a estar por faturar')
    await user.click(within(dialog).getByRole('button', { name: 'Eliminar registo' }))
    await waitFor(() => expect(adminApi.deleteInvoice).toHaveBeenCalledWith('inv-1', expect.anything()))
  })

  it('an empty period says so', async () => {
    vi.mocked(adminApi.getBillingStatement).mockResolvedValue({ ...statement, lines: [] })
    renderPage()
    expect(await screen.findByText('Sem movimentos neste período.')).toBeInTheDocument()
  })
})

describe('the dialog sums in cents', () => {
  it('adds Decimal strings without float drift', () => {
    expect(sums(ana.transactions)).toEqual({ amount: '88.00', hours: '8.00' })
    expect(sums([{ ...ana.transactions[0], amount: '0.10', hours: '0.10' }, { ...ana.transactions[1], amount: '0.20', hours: '0.20' }])).toEqual({ amount: '0.30', hours: '0.30' })
    expect(sums([])).toEqual({ amount: '0.00', hours: '0.00' })
  })
})
