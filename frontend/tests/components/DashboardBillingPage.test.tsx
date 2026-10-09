import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillingPage from '@/app/dashboard/billing/page'
import { authApi, invoicesApi } from '@/lib/api'
import { saveBlob } from '@/lib/download'
import type { MyInvoice } from '@/types'

// I07: the customer's billing details with inline NIF validation, and their
// invoices with the PDF download.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/billing',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 'jwt-token', user: { name: 'Ana' } }, status: 'authenticated' }),
}))
vi.mock('@/lib/hooks/useApi', () => ({ useApi: () => ({}) }))
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => null }))
vi.mock('@/components/layout/Footer', () => ({ Footer: () => null }))
vi.mock('@/lib/download', () => ({ saveBlob: vi.fn() }))
vi.mock('@/lib/api', () => ({
  authApi: { getBilling: vi.fn(), updateBilling: vi.fn() },
  invoicesApi: { listMine: vi.fn(), downloadPdf: vi.fn() },
}))

const invoice: MyInvoice = {
  id: 'inv-1', number: 'FT 2026/12', issued_at: '2026-10-02', period_from: '2026-09-01', period_to: '2026-09-30',
  amount: '88.00', hours: '8.00', currency: 'EUR', has_pdf: true,
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <BillingPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authApi.getBilling).mockResolvedValue({ tax_id: null, billing_name: 'Ana Silva, Lda.', billing_address: null })
  vi.mocked(invoicesApi.listMine).mockResolvedValue([invoice])
})

describe('customer billing (I07)', () => {
  it('prefills the details, refuses a bad NIF inline and saves a good one without spaces', async () => {
    vi.mocked(authApi.updateBilling).mockResolvedValue({ tax_id: '123456789', billing_name: 'Ana Silva, Lda.', billing_address: 'Rua 1' })
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Nome de faturação')).toHaveValue('Ana Silva, Lda.'))
    await user.type(screen.getByLabelText('NIF'), '123 456 780')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('NIF inválido')
    expect(authApi.updateBilling).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('NIF'))
    await user.type(screen.getByLabelText('NIF'), '123 456 789')
    await user.type(screen.getByLabelText('Morada de faturação'), 'Rua 1')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(authApi.updateBilling).toHaveBeenCalledWith({ tax_id: '123456789', billing_name: 'Ana Silva, Lda.', billing_address: 'Rua 1' }, expect.anything()),
    )
    // Inline, not a toast: the customer pages mount no toast region.
    expect(await screen.findByRole('status')).toHaveTextContent('Dados de faturação guardados.')
  })

  it('lists the invoices and downloads a PDF', async () => {
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
    vi.mocked(invoicesApi.downloadPdf).mockResolvedValue(blob)
    const user = userEvent.setup()
    renderPage()
    const row = await screen.findByTestId('my-invoice')
    expect(row).toHaveTextContent('FT 2026/12')
    expect(row).toHaveTextContent(/88,00\s?€/)
    expect(row).toHaveTextContent('8h')
    await user.click(within(row).getByRole('button', { name: 'Transferir PDF FT 2026/12' }))
    await waitFor(() => expect(saveBlob).toHaveBeenCalledWith(blob, 'fatura-FT-2026-12.pdf'))
  })

  it('says so when there is nothing yet, and a record without a PDF has no download', async () => {
    vi.mocked(invoicesApi.listMine).mockResolvedValueOnce([])
    const { unmount } = renderPage()
    expect(await screen.findByText('Ainda não tem faturas registadas.')).toBeInTheDocument()
    unmount()
    vi.mocked(invoicesApi.listMine).mockResolvedValueOnce([{ ...invoice, has_pdf: false }])
    renderPage()
    const row = await screen.findByTestId('my-invoice')
    expect(row).toHaveTextContent('Sem PDF')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  })
})
