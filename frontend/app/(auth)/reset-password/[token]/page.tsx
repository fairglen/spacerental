'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { isAxiosError } from 'axios'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { useT } from '@/lib/i18n'

const schema = z
  .object({
    password: z.string().min(8, 'A password deve ter pelo menos 8 caracteres').max(128, 'A password é demasiado longa'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'As passwords não coincidem' })
type FormData = z.infer<typeof schema>

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const t = useT()
  const router = useRouter()
  // 400 from the API: unknown, used or expired — one message, a way to ask again.
  const [invalid, setInvalid] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      await authApi.confirmPasswordReset(params.token, data.password)
      router.push('/sign-in?password=reset')
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 400) {
        setInvalid(true)
      } else {
        setError('Não foi possível alterar a password. Tente novamente dentro de instantes.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-primary">
            <Building2 className="h-6 w-6" />
            <span className="text-xl font-bold text-foreground">{t('brand.name')}</span>
          </Link>
        </div>
        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle>Escolher uma nova password</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Pelo menos 8 caracteres.</p>
          </CardHeader>
          <CardContent className="pt-4">
            {invalid ? (
              <div className="space-y-4">
                <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                  A ligação é inválida ou já expirou. Peça uma nova ligação para repor a password.
                </p>
                <Button asChild className="w-full">
                  <Link href="/forgot-password">Pedir nova ligação</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="password">Nova password</Label>
                  <Input id="password" type="password" {...register('password')} className="mt-1" placeholder="••••••••" autoComplete="new-password" />
                  {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
                </div>
                <div>
                  <Label htmlFor="confirm">Confirmar a nova password</Label>
                  <Input id="confirm" type="password" {...register('confirm')} className="mt-1" placeholder="••••••••" autoComplete="new-password" />
                  {errors.confirm && <p className="text-xs text-red-500 mt-1">{errors.confirm.message}</p>}
                </div>
                {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'A guardar...' : 'Guardar a nova password'}
                </Button>
              </form>
            )}
            <p className="text-center text-sm text-muted-foreground mt-4">
              <Link href="/sign-in" className="text-primary font-medium hover:underline">Voltar a entrar</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
