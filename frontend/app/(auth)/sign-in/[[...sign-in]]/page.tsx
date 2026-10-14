'use client'
import { useMemo, useState } from 'react'
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
import { tFor, useLocale, useT, type Locale } from '@/lib/i18n'

// B65: built per locale so the field errors follow the language switcher;
// useForm re-reads its resolver on every render.
function schemaFor(locale: Locale) {
  const t = tFor(locale)
  return z.object({
    email: z.string().email(t('auth.email_invalid')),
    password: z.string().min(1, t('auth.password_required')),
  })
}
type FormData = z.infer<ReturnType<typeof schemaFor>>

export default function SignInPage() {
  const t = useT()
  const [locale] = useLocale()
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
  const schema = useMemo(() => schemaFor(locale), [locale])
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
      setError(t('auth.sign_in_failed'))
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
            <CardTitle>{t('auth.sign_in_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('auth.sign_in_subtitle')}</p>
          </CardHeader>
          <CardContent className="pt-4">
            {passwordReset && (
              <p role="status" className="text-sm text-primary bg-primary/10 rounded-lg px-3 py-2 mb-4">
                {t('auth.password_reset_notice')}
              </p>
            )}
            {sessionExpired && !passwordReset && (
              <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mb-4">
                {t('auth.session_expired_notice')}
              </p>
            )}
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="email">{t('auth.email_label')}</Label>
                <Input id="email" type="email" {...register('email')} className="mt-1" placeholder={t('auth.email_placeholder')} autoComplete="email" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">{t('auth.password_label')}</Label>
                <Input id="password" type="password" {...register('password')} className="mt-1" placeholder="••••••••" autoComplete="current-password" />
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('auth.sign_in_submitting') : t('auth.sign_in')}
              </Button>
              <p className="text-center text-sm">
                <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline">
                  {t('auth.forgot_password_link')}
                </Link>
              </p>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              {t('auth.no_account')}{' '}
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
                {t('auth.register_link')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
