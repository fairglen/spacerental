'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { tFor, useLocale, useT, type Locale } from '@/lib/i18n'

// B65: built per locale so the field error follows the language switcher;
// useForm re-reads its resolver on every render.
function schemaFor(locale: Locale) {
  return z.object({ email: z.string().email(tFor(locale)('auth.email_invalid')) })
}
type FormData = z.infer<ReturnType<typeof schemaFor>>

export default function ForgotPasswordPage() {
  const t = useT()
  const [locale] = useLocale()
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const schema = useMemo(() => schemaFor(locale), [locale])
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      const detail = await authApi.requestPasswordReset(data.email)
      // What the API answers whatever the email, shown as-is so the page never
      // says more than the API does (G03); the catalog's line stands in when
      // the answer carries no text.
      setSent(detail || t('auth.forgot_neutral_notice'))
    } catch {
      setError(t('auth.forgot_send_failed'))
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
            <CardTitle>{t('auth.forgot_title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('auth.forgot_subtitle')}</p>
          </CardHeader>
          <CardContent className="pt-4">
            {sent ? (
              <div className="space-y-4">
                <p role="status" className="text-sm text-primary bg-primary/10 rounded-lg px-3 py-2">{sent}</p>
                <p className="text-sm text-muted-foreground">{t('auth.forgot_link_validity')}</p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setSent(null)}>
                  {t('auth.forgot_request_another')}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="email">{t('auth.email_label')}</Label>
                  <Input id="email" type="email" {...register('email')} className="mt-1" placeholder={t('auth.email_placeholder')} autoComplete="email" />
                  {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
                </div>
                {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? t('auth.forgot_submitting') : t('auth.forgot_submit')}
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
