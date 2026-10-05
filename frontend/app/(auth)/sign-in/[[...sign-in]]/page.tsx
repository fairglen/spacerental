'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { safeInternalPath } from '@/lib/navigation'
import { useT } from '@/lib/i18n'

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password obrigatória'),
})
type FormData = z.infer<typeof schema>

export default function SignInPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Carried over from Pricing/sign-up when a signed-out visitor picked a
  // package before proving they already have an account (B12).
  const packageId = searchParams.get('packageId')
  // Where to return after signing in (B28) — set by the booking modal and by
  // the NextAuth middleware. Only a same-origin path is ever followed.
  const callbackUrl = safeInternalPath(searchParams.get('callbackUrl'))
  // Set by /reset-password after a successful change (G03).
  const passwordReset = searchParams.get('password') === 'reset'
  // The backend refused the session's token (a password change elsewhere, a
  // suspension, or it expired) and the app signed out (review on #65).
  const sessionExpired = searchParams.get('session') === 'expired'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    const result = await signIn('credentials', {
      email: data.email,
      password: data.password,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError('Email ou password incorretos.')
    } else {
      router.push(packageId ? `/dashboard/packages?packageId=${packageId}` : callbackUrl ?? '/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center text-primary" aria-label={t('brand.name')}>
            <BrandLogo height={32} />
          </Link>
        </div>
        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle>Entrar na conta</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Bem-vindo de volta</p>
          </CardHeader>
          <CardContent className="pt-4">
            {passwordReset && (
              <p role="status" className="text-sm text-primary bg-primary/10 rounded-lg px-3 py-2 mb-4">
                A sua password foi alterada. Inicie sessão com a nova password.
              </p>
            )}
            {sessionExpired && !passwordReset && (
              <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-4">
                A sua sessão terminou — por exemplo, depois de uma alteração de password. Inicie sessão de novo.
              </p>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} className="mt-1" placeholder="nome@exemplo.pt" autoComplete="email" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register('password')} className="mt-1" placeholder="••••••••" autoComplete="current-password" />
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'A entrar...' : 'Entrar'}
              </Button>
              <p className="text-center text-sm">
                <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline">
                  Esqueceu-se da password?
                </Link>
              </p>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Ainda não tem conta?{' '}
              <Link
                href={
                  packageId
                    ? `/sign-up?packageId=${packageId}`
                    : callbackUrl
                      ? `/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`
                      : '/sign-up'
                }
                className="text-primary font-medium hover:underline"
              >
                Registar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
