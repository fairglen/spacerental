import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { signIn } from 'next-auth/react'
import SignUpPage from '@/app/(auth)/sign-up/[[...sign-up]]/page'
import { authApi } from '@/lib/api'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'

const push = vi.fn()
const refresh = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh, back: vi.fn() }),
  usePathname: () => '/sign-up',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  authApi: { register: vi.fn() },
}))

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome'), 'Test User')
  await user.type(screen.getByLabelText('Email'), 'test@example.com')
  await user.type(screen.getByLabelText('Password', { exact: true }), 'password123')
  await user.type(screen.getByLabelText('Confirmar password'), 'password123')
  await user.click(screen.getByRole('button', { name: /Criar Conta/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
  vi.mocked(authApi.register).mockResolvedValue({} as any)
  vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined } as any)
})

describe('Sign-up resumes an interrupted package purchase (B12)', () => {
  it('lands on the generic dashboard when no package was chosen', async () => {
    const user = userEvent.setup()
    render(<SignUpPage />)
    await fillAndSubmit(user)
    expect(push).toHaveBeenCalledWith('/dashboard')
  })

  it('resumes into the packages page with the chosen package id when present', async () => {
    searchParams = new URLSearchParams('packageId=pkg-10h')
    const user = userEvent.setup()
    render(<SignUpPage />)
    await fillAndSubmit(user)
    expect(push).toHaveBeenCalledWith('/dashboard/packages?packageId=pkg-10h')
  })

  it('carries the package id over to the sign-in link for visitors who already have an account', () => {
    searchParams = new URLSearchParams('packageId=pkg-10h')
    render(<SignUpPage />)
    expect(screen.getByRole('link', { name: /Entrar/i })).toHaveAttribute(
      'href',
      '/sign-in?packageId=pkg-10h',
    )
  })
})


describe('Customer signup failures', () => {
  it('keeps a rejected enrollment on the form without starting a session', async () => {
    vi.mocked(authApi.register).mockRejectedValue({
      isAxiosError: true, response: { status: 403, data: { detail: 'A adesão ao espaço está encerrada.' } },
    })
    render(<SignUpPage />)
    await fillAndSubmit(userEvent.setup())
    expect(await screen.findByRole('alert')).toHaveTextContent('A adesão ao espaço está encerrada.')
    expect(signIn).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Criar Conta/i })).toBeEnabled()
  })

  it.each(['rejected', 'network'])('offers sign-in recovery after %s automatic sign-in', async (failure) => {
    searchParams = new URLSearchParams('packageId=pkg-10h')
    if (failure === 'network') vi.mocked(signIn).mockRejectedValue(new Error('offline'))
    else vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin', status: 401, url: null })
    render(<SignUpPage />)
    await fillAndSubmit(userEvent.setup())
    expect(await screen.findByRole('status')).toHaveTextContent('Conta criada')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Criar Conta/i })).toBeDisabled()
    expect(screen.getByRole('link', { name: /Entrar/i })).toHaveAttribute('href', '/sign-in?packageId=pkg-10h')
    expect(authApi.register).toHaveBeenCalledTimes(1)
  })
})

describe('Sign-up page in English (B65)', () => {
  afterEach(() => resetLocaleForTests())

  it('renders the English copy, the password rules and the recovery notice without Portuguese', async () => {
    setLocale('en')
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin', status: 401, url: null })
    const user = userEvent.setup()
    render(<SignUpPage />)
    expect(screen.getByText('Create account')).toBeInTheDocument()
    expect(screen.getByText(/^Between 10 and 128 characters; a phrase only you know/)).toBeInTheDocument()
    expect(screen.getByLabelText('Password', { exact: true })).toHaveAttribute('placeholder', 'At least 10 characters')

    await user.type(screen.getByLabelText('Name'), 'Test User')
    await user.type(screen.getByLabelText('Email'), 'test@example.com')
    await user.type(screen.getByLabelText('Password', { exact: true }), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'other')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByText('The password must be between 10 and 128 characters.')).toBeInTheDocument()
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Password', { exact: true }))
    await user.type(screen.getByLabelText('Password', { exact: true }), 'password123')
    await user.clear(screen.getByLabelText('Confirm password'))
    await user.type(screen.getByLabelText('Confirm password'), 'password123')
    await user.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Account created')
    expect(screen.getByRole('alert')).toHaveTextContent('could not sign you in')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in')
    expect(document.body.textContent).not.toMatch(/Criar|Entrar|Nome|coincidem|caracteres/)
  })
})
