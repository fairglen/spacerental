'use client'
import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Clock } from 'lucide-react'
import { adminApi, spacesApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { Room } from '@/types'

const roomSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  capacity: z.coerce.number().min(1).default(1),
  hourly_rate: z.coerce.number().min(0),
  color: z.string().default('#A8D5BA'),
  amenities: z.string().optional(),
})
type RoomFormData = z.infer<typeof roomSchema>

const editRoomSchema = z.object({
  name: z.string().min(2),
  capacity: z.coerce.number().min(1),
  hourly_rate: z.coerce.number().min(0),
  color: z.string(),
})
type EditRoomFormData = z.infer<typeof editRoomSchema>

// day_of_week follows Python's date.weekday(): 0=Monday ... 6=Sunday (backend/app/routers/spaces.py).
const DAYS = [
  { day_of_week: 0, label: 'Segunda-feira' },
  { day_of_week: 1, label: 'Terça-feira' },
  { day_of_week: 2, label: 'Quarta-feira' },
  { day_of_week: 3, label: 'Quinta-feira' },
  { day_of_week: 4, label: 'Sexta-feira' },
  { day_of_week: 5, label: 'Sábado' },
  { day_of_week: 6, label: 'Domingo' },
]

type DayRow = { enabled: boolean; open_time: string; close_time: string }

function defaultDayRows(): DayRow[] {
  return DAYS.map(() => ({ enabled: false, open_time: '09:00', close_time: '18:00' }))
}

export default function AdminRoomsPage({ params }: { params: { id: string } }) {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  const { register, handleSubmit, reset, formState: { errors } } = useForm<RoomFormData>({ resolver: zodResolver(roomSchema) })
  const editForm = useForm<EditRoomFormData>({ resolver: zodResolver(editRoomSchema) })
  const [editingRoom, setEditingRoom] = useState<Room | null>(null)
  const [availabilityRoom, setAvailabilityRoom] = useState<Room | null>(null)
  const [dayRows, setDayRows] = useState<DayRow[]>(defaultDayRows())

  const { data, isLoading } = useQuery({
    queryKey: ['space', params.id],
    queryFn: () => spacesApi.get(params.id),
    enabled: !!session?.accessToken,
  })
  const createRoom = useMutation({
    mutationFn: (formData: RoomFormData) => adminApi.createRoom(params.id, {
      ...formData,
      amenities: formData.amenities ? formData.amenities.split(',').map(s => s.trim()).filter(Boolean) : [],
    }, api),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['space', params.id] }); reset() },
  })
  const updateRoom = useMutation({
    mutationFn: ({ id, data: roomData }: { id: string; data: Partial<Room> }) => adminApi.updateRoom(id, roomData, api),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['space', params.id] })
      setEditingRoom(null)
    },
  })
  const setAvailability = useMutation({
    mutationFn: ({ id, rules }: { id: string; rules: Array<{ day_of_week: number; open_time: string; close_time: string }> }) =>
      adminApi.setAvailability(id, rules, api),
    onSuccess: () => setAvailabilityRoom(null),
  })

  const { space, rooms } = data ?? { space: null, rooms: [] }

  function openEditRoom(room: Room) {
    setEditingRoom(room)
    editForm.reset({
      name: room.name,
      capacity: room.capacity,
      hourly_rate: room.hourly_rate,
      color: room.color,
    })
  }

  async function openAvailability(room: Room) {
    setAvailabilityRoom(room)
    setDayRows(defaultDayRows())
    const rules = await adminApi.getAvailability(room.id, api)
    setDayRows(
      DAYS.map(({ day_of_week }) => {
        const rule = rules.find((r) => r.day_of_week === day_of_week)
        return rule
          ? { enabled: true, open_time: rule.open_time.slice(0, 5), close_time: rule.close_time.slice(0, 5) }
          : { enabled: false, open_time: '09:00', close_time: '18:00' }
      }),
    )
  }

  function updateDayRow(index: number, patch: Partial<DayRow>) {
    setDayRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function submitAvailability() {
    if (!availabilityRoom) return
    const rules = dayRows
      .map((row, i) => ({ ...row, day_of_week: DAYS[i].day_of_week }))
      .filter((row) => row.enabled)
      .map(({ day_of_week, open_time, close_time }) => ({ day_of_week, open_time, close_time }))
    setAvailability.mutate({ id: availabilityRoom.id, rules })
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Salas — {space?.name ?? '...'}</h1>
        <p className="text-muted-foreground text-sm mt-1">Gere as salas deste espaço.</p>
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
                      <p className="font-semibold text-foreground">{room.name}</p>
                      <span className="text-sm font-bold text-primary">{formatCurrency(room.hourly_rate)}/h</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{room.capacity} pessoa{room.capacity > 1 ? 's' : ''}</p>
                    <div className="flex flex-wrap gap-1 mb-3">
                      {room.amenities.slice(0, 3).map(a => <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>)}
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openEditRoom(room)}>
                        <Pencil className="h-4 w-4 mr-1" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openAvailability(room)}>
                        <Clock className="h-4 w-4 mr-1" /> Horários
                      </Button>
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

      <Dialog open={!!editingRoom} onOpenChange={(open) => !open && setEditingRoom(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Sala</DialogTitle></DialogHeader>
          <form
            onSubmit={editForm.handleSubmit((d) => editingRoom && updateRoom.mutate({ id: editingRoom.id, data: d }))}
            className="space-y-4"
          >
            <div>
              <Label>Nome da sala</Label>
              <Input {...editForm.register('name')} className="mt-1" />
              {editForm.formState.errors.name && (
                <p className="text-xs text-red-500 mt-1">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label>Capacidade (pessoas)</Label>
              <Input type="number" {...editForm.register('capacity')} className="mt-1" />
            </div>
            <div>
              <Label>Preço por hora (€)</Label>
              <Input type="number" step="0.01" {...editForm.register('hourly_rate')} className="mt-1" />
            </div>
            <div>
              <Label>Cor (hex)</Label>
              <div className="flex gap-2 mt-1">
                <Input type="color" {...editForm.register('color')} className="w-12 h-10 p-1 cursor-pointer" />
                <Input {...editForm.register('color')} className="flex-1" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateRoom.isPending}>
                {updateRoom.isPending ? 'A guardar...' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!availabilityRoom} onOpenChange={(open) => !open && setAvailabilityRoom(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Horários — {availabilityRoom?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-2">
            Define os dias e horas em que esta sala está disponível. Isto substitui todas as regras existentes.
          </p>
          <div className="space-y-3">
            {DAYS.map(({ label }, i) => (
              <div key={label} className="flex items-center gap-3">
                <label className="flex items-center gap-2 w-36 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={dayRows[i]?.enabled ?? false}
                    onChange={(e) => updateDayRow(i, { enabled: e.target.checked })}
                  />
                  {label}
                </label>
                <Input
                  type="time"
                  value={dayRows[i]?.open_time ?? '09:00'}
                  disabled={!dayRows[i]?.enabled}
                  onChange={(e) => updateDayRow(i, { open_time: e.target.value })}
                  className="w-28"
                />
                <span className="text-muted-foreground text-sm">até</span>
                <Input
                  type="time"
                  value={dayRows[i]?.close_time ?? '18:00'}
                  disabled={!dayRows[i]?.enabled}
                  onChange={(e) => updateDayRow(i, { close_time: e.target.value })}
                  className="w-28"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={submitAvailability} disabled={setAvailability.isPending}>
              {setAvailability.isPending ? 'A guardar...' : 'Guardar Horários'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
