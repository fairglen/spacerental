'use client'
import { useMemo, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import axios from 'axios'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { safeInternalPath } from '@/lib/navigation'
import { tFor, useLocale, useT, type Locale } from '@/lib/i18n'
import { PASSWORD_MIN_LENGTH, passwordHint, passwordProblems, passwordReasonsOf } from '@/lib/password'

// B65: built per locale so the field errors follow the language switcher;
// useForm re-reads its resolver on every render.
function schemaFor(locale: Locale) {
  const t = tFor(locale)
  return z.object({
    name: z.string().min(2, t('auth.name_required')),
    email: z.string().email(t('auth.email_invalid')),
    password: z.string(),
    confirmPassword: z.string(),
  }).refine(d => d.password === d.confirmPassword, {
    message: t('auth.passwords_mismatch'),
    path: ['confirmPassword'],
  }).superRefine((d, ctx) => {
    // B66: the same rules the server applies, said before the request.
    for (const problem of passwordProblems(d.password, d.email, t)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
    }
  })
}
type FormData = z.infer<ReturnType<typeof schemaFor>>

export default function SignUpPage() {
  const t = useT()
  const [locale] = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Set when arriving from a "Comprar Pack" click while signed out (B12) — the
  // choice must survive sign-up, so it resumes straight into the purchase
  // instead of a generic dashboard.
  const packageId = searchParams.get('packageId')
  const callbackUrl = safeInternalPath(searchParams.get('callbackUrl'))
  const [error, setError] = useState('')
  const [accountCreated, setAccountCreated] = useState(false)
  const [loading, setLoading] = useState(false)
  const schema = useMemo(() => schemaFor(locale), [locale])
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      await authApi.register({ email: data.email, password: data.password, name: data.name })
      setAccountCreated(true)
      const result = await signIn('credentials', { email: data.email, password: data.password, redirect: false })
      if (!result?.ok || result.error) {
        setError(t('auth.sign_up_session_failed'))
        return
      }
      router.push(packageId ? `/dashboard/packages?packageId=${packageId}` : callbackUrl ?? '/dashboard')
      router.refresh()
    } catch (err) {
      if (axios.isAxiosError(err)) {
        // B66: a refused password comes back as the list of reasons.
        const reasons = passwordReasonsOf(err)
        setError(reasons ? reasons.join(' ') : (typeof err.response?.data?.detail === 'string' ? err.response.data.detail : t('auth.sign_up_failed')))
      } else {
        setError(t('auth.connection_error'))
      }
    }
    finally {
      setLoading(false)
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
            <CardTitle>{t('auth.sign_up_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('auth.sign_up_subtitle')}</p>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="name">{t('auth.name_label')}</Label>
                <Input id="name" {...register('name')} className="mt-1" placeholder={t('auth.name_placeholder')} autoComplete="name" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">{t('auth.email_label')}</Label>
                <Input id="email" type="email" {...register('email')} className="mt-1" placeholder={t('auth.email_placeholder')} autoComplete="email" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">{t('auth.password_label')}</Label>
                <Input id="password" type="password" {...register('password')} className="mt-1" placeholder={t('auth.password_new_placeholder', { min: PASSWORD_MIN_LENGTH })} autoComplete="new-password" aria-describedby="password-hint" />
                <p id="password-hint" className="text-xs text-muted-foreground mt-1">{passwordHint(t)}</p>
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>
              <div>
                <Label htmlFor="confirmPassword">{t('auth.confirm_password_label')}</Label>
                <Input id="confirmPassword" type="password" {...register('confirmPassword')} className="mt-1" placeholder={t('auth.confirm_password_placeholder')} autoComplete="new-password" />
                {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword.message}</p>}
              </div>
              {accountCreated && <p role="status" className="text-sm">{t('auth.account_created_notice')}</p>}
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || accountCreated}>
                {loading ? t('auth.sign_up_submitting') : t('auth.sign_up_submit')}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              {t('auth.have_account')}{' '}
              <Link
                href={
                  packageId
                    ? `/sign-in?packageId=${packageId}`
                    : callbackUrl
                      ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`
                      : '/sign-in'
                }
                className="text-primary font-medium hover:underline"
              >
                {t('auth.sign_in')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
