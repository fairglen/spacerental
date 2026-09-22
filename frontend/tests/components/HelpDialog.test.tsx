import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSession } from 'next-auth/react'
import { HelpDialog } from '@/components/help/HelpDialog'
import { HelpProvider, useHelp } from '@/components/help/HelpProvider'
import { bookingsApi, supportApi } from '@/lib/api'
import type { Booking } from '@/types'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
// tests/setup.ts stubs useHelp for everyone else; this file tests the real provider.
vi.unmock('@/components/help/HelpProvider')
vi.mock('@/lib/api', () => ({
  supportApi: { create: vi.fn() },
  bookingsApi: { listMine: vi.fn() },
  createAuthenticatedApi: vi.fn(() => ({})),
}))

const signedOut = () => vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: vi.fn() })
const signedIn = () =>
  vi.mocked(useSession).mockReturnValue({
    data: { accessToken: 'jwt', user: { name: 'Ana', email: 'ana@example.com', id: 'user-1' } } as never,
    status: 'authenticated',
    update: vi.fn(),
  })

const upcoming = (id: string, room: string, daysAhead: number): Booking => {
  const start = new Date(Date.now() + daysAhead * 86_400_000)
  return {
    id, org_id: 'org-1', room_id: 'r', user_id: 'user-1', start_time: start.toISOString(),
    end_time: new Date(start.getTime() + 3_600_000).toISOString(), duration_hours: 1, total_amount: 11,
    status: 'confirmed', payment_method: 'hourly', created_at: '', room: { id: 'r', space_id: 's', org_id: 'org-1', name: room, description: '', capacity: 1, hourly_rate: 11, images: [], amenities: [], color: '#fff', is_active: true },
  }
}

function renderDialog(props: Partial<React.ComponentProps<typeof HelpDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <HelpDialog open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

const dialog = () => screen.getByRole('dialog', { name: /ajuda/i })
const MESSAGE = 'O botão de pagamento não faz nada quando clico, já tentei duas vezes.'

beforeEach(() => {
  vi.clearAllMocks()
  signedOut()
  vi.mocked(bookingsApi.listMine).mockResolvedValue([])
  vi.mocked(supportApi.create).mockResolvedValue({ id: '3f9a12bc-0000-0000-0000-000000000000', reference: '3F9A12BC', status: 'new', created_at: '' })
})

describe('HelpDialog — signed out', () => {
  it('asks for an email, validates the message length, and never sends a bad form', async () => {
    const user = userEvent.setup()
    renderDialog()
    expect(within(dialog()).getByLabelText(/^Email/)).toBeEnabled()
    await user.type(within(dialog()).getByLabelText(/Mensagem/), 'curto')
    await user.click(within(dialog()).getByRole('button', { name: /^Enviar$/ }))
    expect(await within(dialog()).findAllByRole('alert')).not.toHaveLength(0)
    expect(within(dialog()).getByText(/pelo menos 20/i)).toBeVisible()
    expect(within(dialog()).getByText(/email/i, { selector: '[role=alert]' })).toBeVisible()
    expect(supportApi.create).not.toHaveBeenCalled()
  })

  it('sends the form with the captured context and shows the reference', async () => {
    const user = userEvent.setup()
    renderDialog()
    await user.selectOptions(within(dialog()).getByLabelText(/Assunto/), 'payment')
    await user.type(within(dialog()).getByLabelText(/^Email/), 'visitante@example.com')
    await user.type(within(dialog()).getByLabelText(/Mensagem/), MESSAGE)
    await user.click(within(dialog()).getByRole('button', { name: /^Enviar$/ }))

    await waitFor(() => expect(supportApi.create).toHaveBeenCalledTimes(1))
    const [body] = vi.mocked(supportApi.create).mock.calls[0]
    expect(body).toMatchObject({ category: 'payment', message: MESSAGE, contact_email: 'visitante@example.com', website: '' })
    expect(body.booking_id).toBeUndefined()
    expect(body.context).toMatchObject({ page_url: expect.stringContaining('http'), user_agent: expect.any(String), timestamp: expect.any(String) })
    expect(body.context.viewport).toMatch(/^\d+x\d+$/)

    expect(await within(dialog()).findByText(/#3F9A12BC/)).toBeVisible()
    expect(within(dialog()).getByText(/Respondemos por email/)).toBeVisible()
    expect(within(dialog()).queryByLabelText(/Mensagem/)).toBeNull()
  })

  it('lists what it sends, collapsed, and shows it on request', async () => {
    const user = userEvent.setup()
    renderDialog()
    const details = within(dialog()).getByText(/O que enviamos/).closest('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    await user.click(within(dialog()).getByText(/O que enviamos/))
    expect(details).toHaveTextContent(/endereço da página/i)
    expect(details).toHaveTextContent(/browser/i)
    expect(details).toHaveTextContent(/versão/i)
    expect(details).not.toHaveTextContent(/utilizador/i)
  })

  it('keeps the message and explains a failure inline', async () => {
    vi.mocked(supportApi.create).mockRejectedValueOnce({ response: { status: 429 } })
    const user = userEvent.setup()
    renderDialog()
    await user.type(within(dialog()).getByLabelText(/^Email/), 'visitante@example.com')
    await user.type(within(dialog()).getByLabelText(/Mensagem/), MESSAGE)
    await user.click(within(dialog()).getByRole('button', { name: /^Enviar$/ }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/aguarde/i)
    expect(within(dialog()).getByLabelText(/Mensagem/)).toHaveValue(MESSAGE)
    expect(within(dialog()).getByRole('button', { name: /^Enviar$/ })).toBeEnabled()
  })

  it('has a honeypot that people never see and bots fill', () => {
    renderDialog()
    const trap = dialog().querySelector('input[name="website"]') as HTMLInputElement
    expect(trap).not.toBeNull()
    expect(trap).toHaveAttribute('tabindex', '-1')
    expect(trap).toHaveAttribute('autocomplete', 'off')
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull()
  })
})

describe('HelpDialog — signed in', () => {
  beforeEach(signedIn)

  it('prefills the email read-only and mentions the user in what it sends', async () => {
    const user = userEvent.setup()
    renderDialog()
    const email = within(dialog()).getByLabelText(/^Email/)
    expect(email).toHaveValue('ana@example.com')
    expect(email).toHaveAttribute('readonly')
    await user.click(within(dialog()).getByText(/O que enviamos/))
    expect(within(dialog()).getByText(/O que enviamos/).closest('details')).toHaveTextContent(/utilizador/i)
  })

  it('offers the upcoming bookings, not past ones, and sends the chosen id', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([
      upcoming('b-next', 'Sala Calma', 3),
      upcoming('b-past', 'Sala Brisa', -3),
      { ...upcoming('b-cancelled', 'Sala Névoa', 5), status: 'cancelled' },
    ])
    const user = userEvent.setup()
    renderDialog()
    const select = await within(dialog()).findByLabelText(/Reserva/)
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options.join(' ')).toMatch(/Sala Calma/)
    expect(options.join(' ')).not.toMatch(/Sala Brisa|Sala Névoa/)
    await user.selectOptions(select, 'b-next')
    await user.type(within(dialog()).getByLabelText(/Mensagem/), MESSAGE)
    await user.click(within(dialog()).getByRole('button', { name: /^Enviar$/ }))
    await waitFor(() => expect(supportApi.create).toHaveBeenCalled())
    expect(vi.mocked(supportApi.create).mock.calls[0][0]).toMatchObject({ booking_id: 'b-next' })
    expect(vi.mocked(supportApi.create).mock.calls[0][0].contact_email).toBeUndefined()
  })

  it('opens pre-filled from props: a category and a booking', async () => {
    vi.mocked(bookingsApi.listMine).mockResolvedValue([upcoming('b-next', 'Sala Calma', 3)])
    renderDialog({ initialCategory: 'booking', initialBookingId: 'b-next' })
    expect(within(dialog()).getByLabelText(/Assunto/)).toHaveValue('booking')
    await waitFor(() => expect(within(dialog()).getByLabelText(/Reserva/)).toHaveValue('b-next'))
  })
})

describe('HelpProvider', () => {
  function Opener() {
    const { openHelp } = useHelp()
    return <button onClick={() => openHelp({ category: 'payment', bookingId: 'b-1' })}>abrir</button>
  }

  it('opens the one shared dialog from anywhere, with the caller\'s presets', async () => {
    signedIn()
    vi.mocked(bookingsApi.listMine).mockResolvedValue([upcoming('b-1', 'Sala Calma', 3)])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <HelpProvider><Opener /></HelpProvider>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(within(dialog()).getByLabelText(/Assunto/)).toHaveValue('payment')
    await waitFor(() => expect(within(dialog()).getByLabelText(/Reserva/)).toHaveValue('b-1'))
  })
})
