'use client'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { adminApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const schema = z.object({
  name: z.string().min(2),
  hours: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  validity_days: z.coerce.number().min(1).default(365),
})
type FormData = z.infer<typeof schema>

export default function AdminPackagesPage() {
  const { data: session } = useSession()
  const api = createAuthenticatedApi(session?.accessToken)
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const { data: packages, isLoading } = useQuery({
    queryKey: ['admin', 'packages'],
    queryFn: () => adminApi.getPackages(api),
    enabled: !!session?.accessToken,
  })
  const createMutation = useMutation({
    mutationFn: (data: FormData) => adminApi.createPackage(data, api),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'packages'] }); reset() },
  })

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A2E] mb-2">Pacotes de Horas</h1>
      <p className="text-[#6B7280] text-sm mb-8">Cria e gere os pacotes de horas disponíveis.</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
            <div className="space-y-3">
              {(packages ?? []).map((pkg) => (
                <Card key={pkg.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-[#1A1A2E]">{pkg.name}</p>
                      <p className="text-xs text-[#6B7280] mt-0.5">{pkg.hours}h · válido {pkg.validity_days} dias</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-[#3D7A5E]">{formatCurrency(pkg.price)}</span>
                      <Badge variant={pkg.is_active ? 'default' : 'secondary'}>{pkg.is_active ? 'Ativo' : 'Inativo'}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Novo Pacote</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
              <div>
                <Label>Nome</Label>
                <Input {...register('name')} className="mt-1" placeholder="ex: Pack 10h" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label>Horas</Label>
                <Input type="number" {...register('hours')} className="mt-1" placeholder="10" />
              </div>
              <div>
                <Label>Preço (€)</Label>
                <Input type="number" step="0.01" {...register('price')} className="mt-1" placeholder="100" />
              </div>
              <div>
                <Label>Validade (dias)</Label>
                <Input type="number" {...register('validity_days')} className="mt-1" defaultValue={365} />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'A criar...' : 'Criar Pacote'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
