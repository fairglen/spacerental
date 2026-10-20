import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import ForgotPasswordPage from '@/app/(auth)/forgot-password/page'
import ResetPasswordPage from '@/app/(auth)/reset-password/[token]/page'
import SignInPage from '@/app/(auth)/sign-in/[[...sign-in]]/page'
import { generateMetadata as forgotPasswordMetadata } from '@/app/(auth)/forgot-password/layout'
import { generateMetadata as resetPasswordMetadata } from '@/app/(auth)/reset-password/[token]/layout'
import { generateMetadata as signInMetadata } from '@/app/(auth)/sign-in/layout'
import { generateMetadata as signUpMetadata } from '@/app/(auth)/sign-up/layout'
import { authApi } from '@/lib/api'
import { LOCALE_COOKIE, resetLocaleForTests, setLocale } from '@/lib/i18n'

const push = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/forgot-password',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

// The layouts' titles read the request's locale cookie on the server (B65).
const requestCookies = vi.hoisted(() => ({ locale: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => (name === LOCALE_COOKIE && requestCookies.locale ? { name, value: requestCookies.locale } : undefined),
  }),
}))

const NEUTRAL = 'Se existir uma conta com este email, vai receber uma ligação para repor a password.'

function axios400(): AxiosError {
  const err = new AxiosError('Bad Request', '400', undefined, undefined, {
    status: 400,
    statusText: 'Bad Request',
    data: { detail: 'A ligação é inválida ou já expirou.' },
    headers: {},
    config: { headers: new AxiosHeaders() },
  })
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
  requestCookies.locale = undefined
})

describe('Sign-in page and the reset flow (G03)', () => {
  it('links to the forgot-password page', () => {
    render(<SignInPage />)
    expect(screen.getByRole('link', { name: 'Esqueceu-se da password?' })).toHaveAttribute('href', '/forgot-password')
  })

  it('shows the success notice after a reset', () => {
    searchParams = new URLSearchParams('password=reset')
    render(<SignInPage />)
    expect(screen.getByRole('status')).toHaveTextContent('A sua password foi alterada')
  })

  it('says why after the app signed a stale session out (review on #65)', () => {
    searchParams = new URLSearchParams('session=expired')
    render(<SignInPage />)
    expect(screen.getByRole('status')).toHaveTextContent('A sua sessão terminou')
  })
})

describe('Forgot password page', () => {
  it('sends the email and shows the neutral notice the API answered, whatever the address', async () => {
    const request = vi.spyOn(authApi, 'requestPasswordReset').mockResolvedValue(NEUTRAL)
    const user = userEvent.setup()
    render(<ForgotPasswordPage />)
    await user.type(screen.getByLabelText('Email'), 'nobody@test.com')
    await user.click(screen.getByRole('button', { name: 'Enviar ligação' }))
    expect(await screen.findByRole('status')).toHaveTextContent(NEUTRAL)
    expect(request).toHaveBeenCalledWith('nobody@test.com')
    // The form is gone; the person can ask again.
    expect(screen.queryByLabelText('Email')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Pedir outra ligação' }))
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('refuses an invalid email without calling the API and reports a failed send', async () => {
    const request = vi.spyOn(authApi, 'requestPasswordReset').mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<ForgotPasswordPage />)
    // `a@b` passes the input's own type=email check (so jsdom submits the
    // form) and fails the schema's, which is the one the page reports.
    await user.type(screen.getByLabelText('Email'), 'a@b')
    await user.click(screen.getByRole('button', { name: 'Enviar ligação' }))
    expect(await screen.findByText('Email inválido')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'me@test.com')
    await user.click(screen.getByRole('button', { name: 'Enviar ligação' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar o pedido')
  })
})

describe('Reset password page', () => {
  it('requires a matching pair of at least 10 characters (B66), then confirms and goes to sign-in', async () => {
    const confirm = vi.spyOn(authApi, 'confirmPasswordReset').mockResolvedValue('Password alterada.')
    const user = userEvent.setup()
    render(<ResetPasswordPage params={{ token: 'tok-123' }} />)
    await user.type(screen.getByLabelText('Nova password'), 'curta1234')
    await user.type(screen.getByLabelText('Confirmar a nova password'), 'curta1234')
    await user.click(screen.getByRole('button', { name: 'Guardar a nova password' }))
    expect(await screen.findByText('A password tem de ter entre 10 e 128 caracteres.')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Nova password'))
    await user.type(screen.getByLabelText('Nova password'), 'novapass123')
    await user.clear(screen.getByLabelText('Confirmar a nova password'))
    await user.type(screen.getByLabelText('Confirmar a nova password'), 'diferente123')
    await user.click(screen.getByRole('button', { name: 'Guardar a nova password' }))
    expect(await screen.findByText('As passwords não coincidem')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Confirmar a nova password'))
    await user.type(screen.getByLabelText('Confirmar a nova password'), 'novapass123')
    await user.click(screen.getByRole('button', { name: 'Guardar a nova password' }))
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith('tok-123', 'novapass123'))
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/sign-in?password=reset'))
  })

  it('an invalid or expired link says so and offers a new request', async () => {
    vi.spyOn(authApi, 'confirmPasswordReset').mockRejectedValue(axios400())
    const user = userEvent.setup()
    render(<ResetPasswordPage params={{ token: 'stale' }} />)
    await user.type(screen.getByLabelText('Nova password'), 'novapass123')
    await user.type(screen.getByLabelText('Confirmar a nova password'), 'novapass123')
    await user.click(screen.getByRole('button', { name: 'Guardar a nova password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('A ligação é inválida ou já expirou')
    expect(screen.getByRole('link', { name: 'Pedir nova ligação' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('Nova password')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('any other failure keeps the form and reports it', async () => {
    vi.spyOn(authApi, 'confirmPasswordReset').mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<ResetPasswordPage params={{ token: 'tok' }} />)
    await user.type(screen.getByLabelText('Nova password'), 'novapass123')
    await user.type(screen.getByLabelText('Confirmar a nova password'), 'novapass123')
    await user.click(screen.getByRole('button', { name: 'Guardar a nova password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível alterar a password')
    expect(screen.getByLabelText('Nova password')).toBeInTheDocument()
  })
})

describe('Password pages in English (B65)', () => {
  afterEach(() => resetLocaleForTests())

  it('sign-in explains a signed-out stale session in English', () => {
    setLocale('en')
    searchParams = new URLSearchParams('session=expired')
    render(<SignInPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Your session has ended')
    expect(screen.getByRole('status')).not.toHaveTextContent(/sessão/)
  })

  it('forgot-password: English copy, and the neutral notice when the API answers without text', async () => {
    setLocale('en')
    const request = vi.spyOn(authApi, 'requestPasswordReset').mockResolvedValue('')
    const user = userEvent.setup()
    render(<ForgotPasswordPage />)
    expect(screen.getByText('Recover your password')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'a@b')
    await user.click(screen.getByRole('button', { name: 'Send link' }))
    expect(await screen.findByText('Invalid email')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'nobody@test.com')
    await user.click(screen.getByRole('button', { name: 'Send link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists for this email, you will receive a link to reset your password.')
    expect(screen.getByText(/valid for 60 minutes/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Request another link' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/sign-in')
    expect(document.body.textContent).not.toMatch(/ligação|Entrar|Voltar|inválido/)
  })

  it('reset-password: English rules, mismatch and the invalid-link notice', async () => {
    setLocale('en')
    const confirm = vi.spyOn(authApi, 'confirmPasswordReset').mockRejectedValue(axios400())
    const user = userEvent.setup()
    render(<ResetPasswordPage params={{ token: 'stale' }} />)
    expect(screen.getByText('Choose a new password')).toBeInTheDocument()
    expect(screen.getByText(/^Between 10 and 128 characters; a phrase only you know/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('New password'), 'short'.repeat(1))
    await user.type(screen.getByLabelText('Confirm the new password'), 'different')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))
    expect(await screen.findByText('The password must be between 10 and 128 characters.')).toBeInTheDocument()
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('New password'))
    await user.type(screen.getByLabelText('New password'), 'novapass123')
    await user.clear(screen.getByLabelText('Confirm the new password'))
    await user.type(screen.getByLabelText('Confirm the new password'), 'novapass123')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid or has expired')
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
    expect(document.body.textContent).not.toMatch(/ligação|Entrar|Guardar|caracteres/)
  })

  it('reset-password: the reasons a 422 carries are shown as the API wrote them, whatever the locale', async () => {
    setLocale('en')
    vi.spyOn(authApi, 'confirmPasswordReset').mockRejectedValue({ response: { status: 422, data: { detail: ['Esta password é demasiado comum.'] } } })
    const user = userEvent.setup()
    render(<ResetPasswordPage params={{ token: 'tok' }} />)
    await user.type(screen.getByLabelText('New password'), 'novapass123')
    await user.type(screen.getByLabelText('Confirm the new password'), 'novapass123')
    await user.click(screen.getByRole('button', { name: 'Save the new password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta password é demasiado comum.')
  })
})

describe('Auth tab titles follow the locale cookie (B65)', () => {
  it.each([
    [undefined, ['Entrar', 'Criar conta', 'Recuperar password', 'Nova password']],
    ['en', ['Sign in', 'Create account', 'Recover password', 'New password']],
  ])('cookie %s', (cookie, titles) => {
    requestCookies.locale = cookie
    expect([signInMetadata(), signUpMetadata(), forgotPasswordMetadata(), resetPasswordMetadata()].map((m) => m.title)).toEqual(titles)
    // The private pages stay out of search results in both languages.
    expect(signInMetadata().robots).toBeDefined()
    expect(resetPasswordMetadata().robots).toBeDefined()
  })
})
