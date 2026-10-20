import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignInPage from '@/app/(auth)/sign-in/[[...sign-in]]/page'
import { signIn } from 'next-auth/react'
import { resetLocaleForTests, setLocale } from '@/lib/i18n'

const push = vi.fn()
let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => '/sign-in',
  useSearchParams: () => searchParams,
  redirect: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams()
})

describe('Sign in form', () => {
  it('renders email, password inputs and submit button', () => {
    render(<SignInPage />)
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Entrar/i })).toBeInTheDocument()
  })

  it('calls signIn with the typed credentials on submit', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined } as any)
    const user = userEvent.setup()
    render(<SignInPage />)
    await user.type(screen.getByLabelText(/Email/i), 'me@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: /Entrar/i }))
    // react-hook-form + zod resolver runs async; findBy waits for the call.
    await vi.waitFor(() => expect(signIn).toHaveBeenCalled())
    expect(signIn).toHaveBeenCalledWith('credentials', expect.objectContaining({
      email: 'me@test.com',
      password: 'password123',
    }))
  })
})

describe('Sign-in resumes an interrupted package purchase (B12)', () => {
  it('resumes into the packages page with the chosen package id when present', async () => {
    searchParams = new URLSearchParams('packageId=pkg-10h')
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined } as any)
    const user = userEvent.setup()
    render(<SignInPage />)
    await user.type(screen.getByLabelText(/Email/i), 'me@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: /Entrar/i }))
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/packages?packageId=pkg-10h'))
  })

  it('carries the package id over to the sign-up link', () => {
    searchParams = new URLSearchParams('packageId=pkg-10h')
    render(<SignInPage />)
    expect(screen.getByRole('link', { name: /Registar/i })).toHaveAttribute(
      'href',
      '/sign-up?packageId=pkg-10h',
    )
  })
})

describe('Sign-in returns to where the customer was (B28)', () => {
  async function submit() {
    vi.mocked(signIn).mockResolvedValue({ ok: true, error: undefined } as any)
    const user = userEvent.setup()
    render(<SignInPage />)
    await user.type(screen.getByLabelText(/Email/i), 'me@test.com')
    await user.type(screen.getByLabelText('Password'), 'password123')
    await user.click(screen.getByRole('button', { name: /Entrar/i }))
    await vi.waitFor(() => expect(push).toHaveBeenCalled())
  }

  it('follows a same-origin relative callbackUrl', async () => {
    searchParams = new URLSearchParams('callbackUrl=%2Fspaces%2Fspace-1')
    await submit()
    expect(push).toHaveBeenCalledWith('/spaces/space-1')
  })

  it('ignores an external callbackUrl and lands on the dashboard', async () => {
    searchParams = new URLSearchParams('callbackUrl=https%3A%2F%2Fevil.example%2F')
    await submit()
    expect(push).toHaveBeenCalledWith('/dashboard')
  })

  it('keeps the package resume ahead of a callbackUrl', async () => {
    searchParams = new URLSearchParams('callbackUrl=%2Fspaces%2Fspace-1&packageId=pkg-10h')
    await submit()
    expect(push).toHaveBeenCalledWith('/dashboard/packages?packageId=pkg-10h')
  })

  it('carries the callbackUrl over to the sign-up link', () => {
    searchParams = new URLSearchParams('callbackUrl=%2Fspaces%2Fspace-1')
    render(<SignInPage />)
    expect(screen.getByRole('link', { name: /Registar/i })).toHaveAttribute('href', '/sign-up?callbackUrl=%2Fspaces%2Fspace-1')
  })
})

describe('Sign-in page in English (B65)', () => {
  afterEach(() => resetLocaleForTests())

  it('renders the English copy, field errors and the failed sign-in without Portuguese', async () => {
    setLocale('en')
    searchParams = new URLSearchParams('password=reset')
    vi.mocked(signIn).mockResolvedValue({ ok: false, error: 'CredentialsSignin', status: 401, url: null })
    const user = userEvent.setup()
    render(<SignInPage />)
    expect(screen.getByText('Sign in to your account')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your password has been changed')
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/sign-up')

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Invalid email')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Email'), 'me@test.com')
    await user.type(screen.getByLabelText('Password'), 'wrong-one')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Entrar|Registar|Esqueceu|incorretos/)
  })
})
