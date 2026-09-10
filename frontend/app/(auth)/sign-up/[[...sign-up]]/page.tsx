'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import axios from 'axios'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { authApi } from '@/lib/api'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'As passwords não coincidem',
  path: ['confirmPassword'],
})
type FormData = z.infer<typeof schema>

export default function SignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Set when arriving from a "Comprar Pack" click while signed out (B12) — the
  // choice must survive sign-up, so it resumes straight into the purchase
  // instead of a generic dashboard.
  const packageId = searchParams.get('packageId')
  const [error, setError] = useState('')
  const [accountCreated, setAccountCreated] = useState(false)
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    setError('')
    try {
      await authApi.register({ email: data.email, password: data.password, name: data.name })
      setAccountCreated(true)
      const result = await signIn('credentials', { email: data.email, password: data.password, redirect: false })
      if (!result?.ok || result.error) {
        setError('A conta foi criada, mas não foi possível iniciar sessão. Usa o link Entrar abaixo.')
        return
      }
      router.push(packageId ? `/dashboard/packages?packageId=${packageId}` : '/dashboard')
      router.refresh()
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail || 'Erro ao criar conta.')
      } else {
        setError('Erro de ligação. Tenta novamente.')
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
          <Link href="/" className="inline-flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold text-foreground">EspaçoHora</span>
          </Link>
        </div>
        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle>Criar conta</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Cria uma conta de cliente para reservar salas e comprar packs de horas</p>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="name">Nome</Label>
                <Input id="name" {...register('name')} className="mt-1" placeholder="O teu nome" autoComplete="name" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} className="mt-1" placeholder="tu@exemplo.pt" autoComplete="email" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" {...register('password')} className="mt-1" placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirmar password</Label>
                <Input id="confirmPassword" type="password" {...register('confirmPassword')} className="mt-1" placeholder="Repete a password" autoComplete="new-password" />
                {errors.confirmPassword && <p className="text-xs text-red-500 mt-1">{errors.confirmPassword.message}</p>}
              </div>
              {accountCreated && <p role="status" className="text-sm">Conta criada. Se a sessão não iniciou, usa o link Entrar abaixo.</p>}
              {error && <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || accountCreated}>
                {loading ? 'A criar conta...' : 'Criar Conta'}
              </Button>
            </form>
            <p className="text-center text-sm text-muted-foreground mt-4">
              Já tens conta?{' '}
              <Link
                href={packageId ? `/sign-in?packageId=${packageId}` : '/sign-in'}
                className="text-primary font-medium hover:underline"
              >
                Entrar
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
