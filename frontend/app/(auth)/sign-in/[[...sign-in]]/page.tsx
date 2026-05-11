'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const schema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Password obrigatória'),
})
type FormData = z.infer<typeof schema>

export default function SignInPage() {
  const router = useRouter()
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
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-[#3D7A5E]">
            <Building2 className="h-6 w-6" />
            <span className="text-xl font-bold text-[#1A1A2E]">EspaçoHora</span>
          </Link>
        </div>
        <Card>
          <CardHeader className="text-center pb-2">
            <CardTitle>Entrar na conta</CardTitle>
            <p className="text-sm text-[#6B7280] mt-1">Bem-vindo de volta</p>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register('email')} className="mt-1" placeholder="tu@exemplo.pt" autoComplete="email" />
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
            </form>
            <p className="text-center text-sm text-[#6B7280] mt-4">
              Não tens conta?{' '}
              <Link href="/sign-up" className="text-[#3D7A5E] font-medium hover:underline">Registar</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
