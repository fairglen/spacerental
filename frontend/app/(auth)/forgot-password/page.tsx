'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'
import { useT } from '@/lib/i18n'

const schema = z.object({ email: z.string().email('Email inválido') })
type FormData = z.infer<typeof schema>

// What the API answers whatever the email; shown as-is so the page never says
// more than the API does (G03).
const NEUTRAL_NOTICE =
  'Se existir uma conta com este email, vai receber uma ligação para repor a password.'

export default function ForgotPasswordPage() {
  const t = useT()
  const [sent, setSent] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      const detail = await authApi.requestPasswordReset(data.email)
      setSent(detail || NEUTRAL_NOTICE)
    } catch {
      setError('Não foi possível enviar o pedido. Tente novamente dentro de instantes.')
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
            <CardTitle>Recuperar a password</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Indique o email da sua conta e enviamos-lhe uma ligação para escolher uma nova password.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            {sent ? (
              <div className="space-y-4">
                <p role="status" className="text-sm text-primary bg-primary/10 rounded-lg px-3 py-2">{sent}</p>
                <p className="text-sm text-muted-foreground">
                  A ligação é válida durante 60 minutos. Se não receber nada, verifique a pasta de spam ou peça uma nova ligação.
                </p>
                <Button type="button" variant="outline" className="w-full" onClick={() => setSent(null)}>
                  Pedir outra ligação
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" {...register('email')} className="mt-1" placeholder="nome@exemplo.pt" autoComplete="email" />
                  {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
                </div>
                {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'A enviar...' : 'Enviar ligação'}
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
