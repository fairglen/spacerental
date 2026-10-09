import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders } from 'axios'
import { adminApi, createAuthenticatedApi } from '@/lib/api'
import { EmailStatusCard } from '@/components/admin/EmailStatusCard'
import type { EmailStatus } from '@/types'

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  return { ...actual, adminApi: { ...actual.adminApi, getEmailStatus: vi.fn(), sendTestEmail: vi.fn() } }
})

const stub: EmailStatus = {
  mode: 'stub',
  from_address: 'FlowSpace <no-reply@flowspace.pt>',
  support_inbox: 'geral+support@flowspace.pt',
  test_hooks_enabled: true,
  recent_failures: [],
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const api = createAuthenticatedApi('token')
  return render(
    <QueryClientProvider client={client}>
      <EmailStatusCard api={api} enabled orgId="org-1" />
    </QueryClientProvider>,
  )
}

function apiError(status: number, detail: string) {
  const headers = new AxiosHeaders()
  return new AxiosError('refused', String(status), undefined, undefined, {
    status, statusText: '', headers, config: { headers }, data: { detail },
  })
}

// B61: the card answers "the reset email never arrives" on the settings page.
describe('EmailStatusCard', () => {
  beforeEach(() => {
    vi.mocked(adminApi.getEmailStatus).mockReset()
    vi.mocked(adminApi.sendTestEmail).mockReset()
  })

  it('in stub mode says the emails stay on this machine and names the two places to read them', async () => {
    vi.mocked(adminApi.getEmailStatus).mockResolvedValue(stub)
    renderCard()
    expect(await screen.findByTestId('email-mode')).toHaveTextContent('Modo de teste')
    expect(screen.getByText('Modo de teste: os emails não saem desta máquina.')).toBeInTheDocument()
    expect(screen.getByText('docker compose logs backend')).toBeInTheDocument()
    expect(screen.getByText('GET /__test__/emails')).toBeInTheDocument()
    expect(screen.getByText(/geral\+support@flowspace\.pt/)).toBeInTheDocument()
    expect(screen.getByText('Sem falhas de envio registadas desde o arranque.')).toBeInTheDocument()
    // Formal register throughout.
    expect(document.body.textContent).not.toMatch(/você/i)
  })

  it('in live mode shows the sender and does not point at the stub mailbox', async () => {
    vi.mocked(adminApi.getEmailStatus).mockResolvedValue({ ...stub, mode: 'live', test_hooks_enabled: false })
    renderCard()
    expect(await screen.findByTestId('email-mode')).toHaveTextContent('Envio real')
    expect(screen.getByText('FlowSpace <no-reply@flowspace.pt>')).toBeInTheDocument()
    expect(screen.queryByText('GET /__test__/emails')).toBeNull()
  })

  it('"Enviar email de teste" sends to the admin only and reports the address it went to', async () => {
    vi.mocked(adminApi.getEmailStatus).mockResolvedValue(stub)
    vi.mocked(adminApi.sendTestEmail).mockResolvedValue({ delivered: true, to: 'admin@demo.com' })
    const user = userEvent.setup()
    renderCard()
    await screen.findByTestId('email-mode')
    await user.click(screen.getByRole('button', { name: 'Enviar email de teste' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Email de teste enviado para admin@demo.com.')
    // No recipient is ever passed: the API sends to the caller.
    expect(adminApi.sendTestEmail).toHaveBeenCalledTimes(1)
    expect(vi.mocked(adminApi.sendTestEmail).mock.calls[0]).toHaveLength(1)
  })

  it('a provider refusal (502) is shown as the API said it, and the failures list refreshes', async () => {
    const failed: EmailStatus = {
      ...stub,
      mode: 'live',
      recent_failures: [{ at: '2026-10-07T10:00:00Z', to: 'admin@demo.com', subject: 'Email de teste — FlowSpace', error: "Client error '403 Forbidden' for url 'https://api.resend.com/emails'" }],
    }
    vi.mocked(adminApi.getEmailStatus).mockResolvedValueOnce({ ...stub, mode: 'live' }).mockResolvedValue(failed)
    vi.mocked(adminApi.sendTestEmail).mockRejectedValue(apiError(502, 'O fornecedor de email recusou o envio: 403 Forbidden'))
    const user = userEvent.setup()
    renderCard()
    await screen.findByTestId('email-mode')
    await user.click(screen.getByRole('button', { name: 'Enviar email de teste' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('O fornecedor de email recusou o envio: 403 Forbidden')
    await waitFor(() => expect(screen.getByTestId('email-failures')).toBeInTheDocument())
    const list = within(screen.getByTestId('email-failures'))
    expect(list.getByText(/admin@demo\.com · Email de teste — FlowSpace/)).toBeInTheDocument()
    expect(list.getByText(/403 Forbidden/)).toBeInTheDocument()
  })

  it('an unreachable status is reported, not hidden', async () => {
    vi.mocked(adminApi.getEmailStatus).mockRejectedValue(apiError(500, 'boom'))
    renderCard()
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível obter o estado do email.')
  })
})
