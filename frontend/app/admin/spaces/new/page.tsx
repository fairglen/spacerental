'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  description: z.string().optional(),
  address: z.string().min(2, 'Morada obrigatória'),
  city: z.string().min(2, 'Cidade obrigatória'),
  amenities: z.string().optional(),
})
type FormData = z.infer<typeof schema>

export default function NewSpacePage() {
  const { data: session } = useSession()
  const api = useApi()
  const router = useRouter()
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      adminApi.createSpace({
        ...data,
        amenities: data.amenities ? data.amenities.split(',').map(s => s.trim()).filter(Boolean) : [],
      }, api),
    onSuccess: () => router.push('/admin/spaces'),
  })

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-foreground mb-2">Novo Espaço</h1>
      <p className="text-muted-foreground text-sm mb-8">Preenche os dados do espaço. Podes adicionar salas depois.</p>
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-5">
            <div>
              <Label htmlFor="name">Nome do espaço *</Label>
              <Input id="name" {...register('name')} className="mt-1" placeholder="ex: Espaço Calmo" />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label htmlFor="description">Descrição</Label>
              <textarea id="description" {...register('description')}
                className="mt-1 flex min-h-[80px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Descrição breve do espaço..." />
            </div>
            <div>
              <Label htmlFor="address">Morada *</Label>
              <Input id="address" {...register('address')} className="mt-1" placeholder="ex: Rua das Flores, 123" />
              {errors.address && <p className="text-xs text-red-500 mt-1">{errors.address.message}</p>}
            </div>
            <div>
              <Label htmlFor="city">Cidade *</Label>
              <Input id="city" {...register('city')} className="mt-1" placeholder="ex: Lisboa" />
              {errors.city && <p className="text-xs text-red-500 mt-1">{errors.city.message}</p>}
            </div>
            <div>
              <Label htmlFor="amenities">Comodidades (separadas por vírgula)</Label>
              <Input id="amenities" {...register('amenities')} className="mt-1" placeholder="ex: Wi-Fi, Ar condicionado, Insonorizado" />
            </div>
            {mutation.isError && <p className="text-sm text-red-600">Erro ao criar espaço. Tenta novamente.</p>}
            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'A criar...' : 'Criar Espaço'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancelar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
