'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { Plus, MapPin, DoorOpen, Pencil, Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Space } from '@/types'

const editSpaceSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
})
type EditSpaceFormData = z.infer<typeof editSpaceSchema>

export default function AdminSpacesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const { currentOrgId } = useOrg()
  const qc = useQueryClient()
  const [editingSpace, setEditingSpace] = useState<Space | null>(null)
  const { register, handleSubmit, reset, formState: { errors } } = useForm<EditSpaceFormData>({
    resolver: zodResolver(editSpaceSchema),
  })

  const { data: spaces, isLoading } = useQuery({
    queryKey: ['admin', 'spaces', currentOrgId],
    queryFn: () => adminApi.getSpaces(api),
    enabled: !!session?.accessToken && !!currentOrgId,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.updateSpace(id, { is_active: false }, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'spaces'] }),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Space> }) => adminApi.updateSpace(id, data, api),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'spaces'] })
      setEditingSpace(null)
    },
  })

  function openEdit(space: Space) {
    setEditingSpace(space)
    reset({
      name: space.name,
      description: space.description ?? '',
      address: space.address ?? '',
      city: space.city ?? '',
    })
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Espaços</h1>
          <p className="text-muted-foreground text-sm mt-1">Gere os teus espaços e salas.</p>
        </div>
        <Link href="/admin/spaces/new"><Button className="gap-2"><Plus className="h-4 w-4" /> Novo Espaço</Button></Link>
      </div>
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-4">
          {(spaces ?? []).map((space) => (
            <Card key={space.id}>
              <CardContent className="p-5 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">{space.name}</h3>
                    <Badge variant={space.is_active ? 'default' : 'secondary'}>{space.is_active ? 'Ativo' : 'Inativo'}</Badge>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin className="h-3 w-3" /> {space.city}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEdit(space)}>
                    <Pencil className="h-4 w-4 mr-1" /> Editar
                  </Button>
                  <Link href={`/admin/rooms/${space.id}`}><Button variant="outline" size="sm"><DoorOpen className="h-4 w-4 mr-1" /> Salas</Button></Link>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteMutation.mutate(space.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editingSpace} onOpenChange={(open) => !open && setEditingSpace(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Espaço</DialogTitle></DialogHeader>
          <form
            onSubmit={handleSubmit((d) => editingSpace && updateMutation.mutate({ id: editingSpace.id, data: d }))}
            className="space-y-4"
          >
            <div>
              <Label>Nome</Label>
              <Input {...register('name')} className="mt-1" />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
            </div>
            <div>
              <Label>Descrição</Label>
              <Input {...register('description')} className="mt-1" />
            </div>
            <div>
              <Label>Morada</Label>
              <Input {...register('address')} className="mt-1" />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input {...register('city')} className="mt-1" />
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
