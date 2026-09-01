import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignInPage from '@/app/(auth)/sign-in/[[...sign-in]]/page'
import { signIn } from 'next-auth/react'

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
