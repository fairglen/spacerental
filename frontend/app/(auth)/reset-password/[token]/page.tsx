'use client'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isAxiosError } from 'axios'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { tFor, useLocale, useT, type Locale } from '@/lib/i18n'
import { passwordHint, passwordProblems, passwordReasonsOf } from '@/lib/password'

// B66: the length rule here (the page does not know the email); the server
// answers 422 with every reason, shown as it is. B65: built per locale so
// the field errors follow the language switcher; useForm re-reads its
// resolver on every render.
function schemaFor(locale: Locale) {
  const t = tFor(locale)
  return z
    .object({
      password: z.string(),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, { path: ['confirm'], message: t('auth.passwords_mismatch') })
    .superRefine((v, ctx) => {
      for (const problem of passwordProblems(v.password, '', t)) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
    })
}
type FormData = z.infer<ReturnType<typeof schemaFor>>

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const t = useT()
  const [locale] = useLocale()
  const router = useRouter()
  // 400 from the API: unknown, used or expired — one message, a way to ask again.
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const schema = useMemo(() => schemaFor(locale), [locale])
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      await authApi.confirmPasswordReset(params.token, data.password)
      router.push('/sign-in?password=reset')
    } catch (err) {
      const reasons = passwordReasonsOf(err)
      if (isAxiosError(err) && err.response?.status === 400) {
        setInvalid(true)
      } else if (reasons) {
        setError(reasons.join(' '))
      } else {
        setError(t('auth.reset_failed'))
      }
    } finally {
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
            <CardTitle>{t('auth.reset_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('auth.reset_subtitle')}</p>
          </CardHeader>
          <CardContent className="pt-4">
            {invalid ? (
              <div className="space-y-4">
                <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  {t('auth.reset_invalid_link')}
                </p>
                <Button asChild className="w-full">
                  <Link href="/forgot-password">{t('auth.reset_request_new')}</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="password">{t('auth.new_password_label')}</Label>
                  <Input id="password" type="password" {...register('password')} className="mt-1" placeholder="••••••••••" autoComplete="new-password" aria-describedby="password-hint" />
                  <p id="password-hint" className="text-xs text-muted-foreground mt-1">{passwordHint(t)}</p>
                  {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
                </div>
                <div>
                  <Label htmlFor="confirm">{t('auth.confirm_new_password_label')}</Label>
                  <Input id="confirm" type="password" {...register('confirm')} className="mt-1" placeholder="••••••••" autoComplete="new-password" />
                  {errors.confirm && <p className="text-xs text-red-500 mt-1">{errors.confirm.message}</p>}
                </div>
                {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('auth.reset_submitting') : t('auth.reset_submit')}
                </Button>
              </form>
            )}
            <p className="text-center text-sm text-muted-foreground mt-4">
              <Link href="/sign-in" className="text-primary font-medium hover:underline">{t('auth.back_to_sign_in')}</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
