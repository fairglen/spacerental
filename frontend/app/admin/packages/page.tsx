'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Power, PowerOff } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Package } from '@/types'

const schema = z.object({
  name: z.string().min(2),
  hours: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  validity_days: z.coerce.number().min(1).default(365),
})
type FormData = z.infer<typeof schema>

const editSchema = z.object({
  name: z.string().min(2),
  hours: z.coerce.number().min(1),
  price: z.coerce.number().min(0),
  validity_days: z.coerce.number().min(1),
})
type EditFormData = z.infer<typeof editSchema>

export default function AdminPackagesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const { currentOrgId } = useOrg()
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })
  const editForm = useForm<EditFormData>({ resolver: zodResolver(editSchema) })
  const [editingPackage, setEditingPackage] = useState<Package | null>(null)

  const { data: packages, isLoading } = useQuery({
    queryKey: ['admin', 'packages', currentOrgId],
    queryFn: () => adminApi.getPackages(api),
    enabled: !!session?.accessToken && !!currentOrgId,
  })
  const createMutation = useMutation({
    mutationFn: (data: FormData) => adminApi.createPackage(data, api),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin', 'packages'] }); reset() },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Package> }) => adminApi.updatePackage(id, data, api),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'packages'] })
      setEditingPackage(null)
    },
  })
  const toggleActiveMutation = useMutation({
    mutationFn: (pkg: Package) => adminApi.updatePackage(pkg.id, { is_active: !pkg.is_active }, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'packages'] }),
  })

  function openEdit(pkg: Package) {
    setEditingPackage(pkg)
    editForm.reset({
      name: pkg.name,
      hours: pkg.hours,
      price: pkg.price,
      validity_days: pkg.validity_days,
    })
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-foreground mb-2">Pacotes de Horas</h1>
      <p className="text-muted-foreground text-sm mb-8">Cria e gere os pacotes de horas disponíveis.</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
            <div className="space-y-3">
              {(packages ?? []).map((pkg) => (
                <Card key={pkg.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{pkg.hours}h · válido {pkg.validity_days} dias</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-primary">{formatCurrency(pkg.price)}</span>
                      <Badge variant={pkg.is_active ? 'default' : 'secondary'}>{pkg.is_active ? 'Ativo' : 'Inativo'}</Badge>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(pkg)} aria-label="Editar pacote">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => toggleActiveMutation.mutate(pkg)}
                        aria-label={pkg.is_active ? 'Desativar pacote' : 'Ativar pacote'}
                      >
                        {pkg.is_active ? <PowerOff className="h-4 w-4 text-red-500" /> : <Power className="h-4 w-4 text-green-600" />}
                      </Button>
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

      <Dialog open={!!editingPackage} onOpenChange={(open) => !open && setEditingPackage(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Pacote</DialogTitle></DialogHeader>
          <form
            onSubmit={editForm.handleSubmit((d) => editingPackage && updateMutation.mutate({ id: editingPackage.id, data: d }))}
            className="space-y-4"
          >
            <div>
              <Label>Nome</Label>
              <Input {...editForm.register('name')} className="mt-1" />
              {editForm.formState.errors.name && (
                <p className="text-xs text-red-500 mt-1">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label>Horas</Label>
              <Input type="number" {...editForm.register('hours')} className="mt-1" />
            </div>
            <div>
              <Label>Preço (€)</Label>
              <Input type="number" step="0.01" {...editForm.register('price')} className="mt-1" />
            </div>
            <div>
              <Label>Validade (dias)</Label>
              <Input type="number" {...editForm.register('validity_days')} className="mt-1" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
