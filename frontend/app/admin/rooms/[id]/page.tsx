'use client'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { adminApi, spacesApi, createAuthenticatedApi } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const roomSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  capacity: z.coerce.number().min(1).default(1),
  hourly_rate: z.coerce.number().min(0),
  color: z.string().default('#A8D5BA'),
  amenities: z.string().optional(),
})
type RoomFormData = z.infer<typeof roomSchema>

export default function AdminRoomsPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession()
  const api = createAuthenticatedApi(session?.accessToken)
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RoomFormData>({ resolver: zodResolver(roomSchema) })

  const { data, isLoading } = useQuery({
    queryKey: ['space', params.id],
    queryFn: () => spacesApi.get(params.id),
  })
  const createRoom = useMutation({
    mutationFn: (formData: RoomFormData) => adminApi.createRoom(params.id, {
      ...formData,
      amenities: formData.amenities ? formData.amenities.split(',').map(s => s.trim()).filter(Boolean) : [],
    }, api),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['space', params.id] }); reset() },
  })

  const { space, rooms } = data ?? { space: null, rooms: [] }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1A1A2E]">Salas — {space?.name ?? '...'}</h1>
        <p className="text-[#6B7280] text-sm mt-1">Gere as salas deste espaço.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {isLoading ? <Skeleton className="h-48 rounded-xl" /> : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rooms.map((room) => (
                <Card key={room.id}>
                  <div className="h-16 rounded-t-xl" style={{ backgroundColor: room.color + '44' }} />
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start mb-1">
                      <p className="font-semibold text-[#1A1A2E]">{room.name}</p>
                      <span className="text-sm font-bold text-[#3D7A5E]">{formatCurrency(room.hourly_rate)}/h</span>
                    </div>
                    <p className="text-xs text-[#6B7280] mb-2">{room.capacity} pessoa{room.capacity > 1 ? 's' : ''}</p>
                    <div className="flex flex-wrap gap-1">
                      {room.amenities.slice(0,3).map(a => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Adicionar Sala</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((d) => createRoom.mutate(d))} className="space-y-4">
              <div>
                <Label>Nome da sala</Label>
                <Input {...register('name')} className="mt-1" placeholder="ex: Sala Calma" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <Label>Descrição</Label>
                <Input {...register('description')} className="mt-1" placeholder="Breve descrição..." />
              </div>
              <div>
                <Label>Capacidade (pessoas)</Label>
                <Input type="number" {...register('capacity')} className="mt-1" defaultValue={1} />
              </div>
              <div>
                <Label>Preço por hora (€)</Label>
                <Input type="number" step="0.01" {...register('hourly_rate')} className="mt-1" placeholder="11" />
                {errors.hourly_rate && <p className="text-xs text-red-500 mt-1">{errors.hourly_rate.message}</p>}
              </div>
              <div>
                <Label>Cor (hex)</Label>
                <div className="flex gap-2 mt-1">
                  <Input type="color" {...register('color')} className="w-12 h-10 p-1 cursor-pointer" defaultValue="#A8D5BA" />
                  <Input {...register('color')} className="flex-1" placeholder="#A8D5BA" />
                </div>
              </div>
              <div>
                <Label>Comodidades (separadas por vírgula)</Label>
                <Input {...register('amenities')} className="mt-1" placeholder="Wi-Fi, Insonorizado..." />
              </div>
              <Button type="submit" className="w-full" disabled={createRoom.isPending}>
                {createRoom.isPending ? 'A criar...' : 'Adicionar Sala'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
