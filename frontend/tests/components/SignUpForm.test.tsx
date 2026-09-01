import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { signIn } from 'next-auth/react'
import SignUpPage from '@/app/(auth)/sign-up/[[...sign-up]]/page'
import { authApi } from '@/lib/api'

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
