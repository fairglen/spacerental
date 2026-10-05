'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm, type FieldErrors, type UseFormRegister, type UseFormSetValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Copy, Plus, Power } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryPanel } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { PhotoManager } from '@/components/admin/PhotoManager'
import { SpaceLocationFields } from '@/components/admin/SpaceLocationFields'
import { RoomActiveDialog, roomInUseOf } from '@/components/admin/RoomActiveDialog'
import { locationDefaults, locationFormShape, locationPayload, refineCoordinatePair, type LocationFormValues } from '@/lib/spaceLocationForm'
import { formatCurrency } from '@/lib/utils'
import { detailOf } from '@/lib/httpError'
import type { Room, Space } from '@/types'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  description: z.string(),
  address: z.string(),
  city: z.string(),
  timezone: z.string().min(1, 'Fuso horário obrigatório'),
  amenities: z.string(),
  ...locationFormShape,
}).superRefine(refineCoordinatePair)
type FormValues = z.infer<typeof schema>

const roomSchema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  hourly_rate: z.coerce.number().min(0, 'Valor inválido'),
  capacity: z.coerce.number().min(1, 'Pelo menos 1'),
})
type RoomValues = z.infer<typeof roomSchema>

function toForm(space: Space): FormValues {
  return {
    name: space.name,
    description: space.description ?? '',
    address: space.address ?? '',
    city: space.city ?? '',
    timezone: space.timezone ?? 'Europe/Lisbon',
    amenities: (space.amenities ?? []).join(', '),
    ...locationDefaults(space),
  }
}

/** One space (G06): Identificação, Localização, Fotografias, Salas, DangerZone, Histórico. */
export default function AdminSpacePage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('spaces')
  return <SpaceDetail key={`${currentOrgId}-${id}`} spaceId={id} />
}

function SpaceDetail({ spaceId }: { spaceId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('spaces')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'spaces', currentOrgId, spaceId],
    queryFn: () => adminApi.getSpace(spaceId, api),
    enabled,
  })
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: locationDefaults() as FormValues })
  useEffect(() => { if (data) form.reset(toForm(data.space)) }, [data, form])
  const [photos, setPhotos] = useState<Space['photos'] | null>(null)
  const [toggling, setToggling] = useState<Room | null>(null)
  const roomForm = useForm<RoomValues>({ resolver: zodResolver(roomSchema), defaultValues: { name: '', hourly_rate: 11, capacity: 1 } })
  const [showNewRoom, setShowNewRoom] = useState(false)

  const toggleRoom = useMutation({
    mutationFn: ({ room, is_active }: { room: Room; is_active: boolean }) => adminApi.updateRoom(room.id, { is_active }, api),
    onSuccess: async () => { setToggling(null); await invalidate(spaceId) },
  })
  const duplicate = useMutation({
    mutationFn: (room: Room) => adminApi.duplicateRoom(room.id, api),
    onSuccess: async (copy) => { toast({ title: `${copy.name} criada.`, variant: 'success' }); await invalidate(spaceId) },
    onError: (err) => toast({ title: 'Não foi possível duplicar a sala.', description: detailOf(err), variant: 'error' }),
  })
  const createRoom = useMutation({
    mutationFn: (values: RoomValues) => adminApi.createRoom(spaceId, { ...values, amenities: [], images: [] } as Partial<Room>, api),
    onSuccess: async (room) => {
      toast({ title: `${room.name} criada.`, variant: 'success' })
      roomForm.reset({ name: '', hourly_rate: 11, capacity: 1 })
      setShowNewRoom(false)
      await invalidate(spaceId)
    },
    onError: (err) => toast({ title: 'Não foi possível criar a sala.', description: detailOf(err), variant: 'error' }),
  })

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar este espaço. <Link href="/admin/spaces" className="underline">Voltar à lista</Link>.</p></div>
  const { space } = data
  const rooms = space.rooms ?? []

  return (
    <div className="p-8 pb-28 max-w-5xl">
      <PageHeader
        title={space.name}
        crumbs={[{ label: 'Espaços', href: '/admin/spaces' }, { label: space.name }]}
        badge={<Badge variant={space.is_active ? 'default' : 'secondary'}>{space.is_active ? 'Ativo' : 'Inativo'}</Badge>}
        description={`${rooms.length} sala(s) · ${data.photo_count} fotografia(s) · ${data.bookings.total} reserva(s), ${data.bookings.upcoming} por vir`}
      />
      <EntityForm
        form={form}
        successMessage="Espaço guardado."
        onCancel={() => router.push('/admin/spaces')}
        onSubmit={async (values) => {
          await adminApi.updateSpace(spaceId, {
            name: values.name,
            // Blank clears a stored value: the API takes an explicit null.
            description: values.description.trim() || null,
            address: values.address.trim() || null,
            city: values.city.trim() || null,
            timezone: values.timezone,
            amenities: values.amenities.split(',').map((s) => s.trim()).filter(Boolean),
            ...locationPayload(values),
          } as Partial<Space>, api)
        }}
        onSaved={() => invalidate(spaceId)}
      >
        <FormSection title="Identificação" description="O que os clientes veem no site e nas reservas.">
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}>
            <Input id="name" {...form.register('name')} />
          </FormField>
          <FormField id="amenities" label="Comodidades" hint="Separadas por vírgulas.">
            <Input id="amenities" {...form.register('amenities')} />
          </FormField>
          <FormField id="description" label="Descrição" full>
            <Textarea id="description" rows={3} {...form.register('description')} />
          </FormField>
        </FormSection>
        <FormSection title="Localização" description="A morada e o ponto no mapa; o fuso horário é o relógio do horário de funcionamento (R01).">
          <FormField id="address" label="Morada">
            <Input id="address" {...form.register('address')} />
          </FormField>
          <FormField id="city" label="Cidade">
            <Input id="city" {...form.register('city')} />
          </FormField>
          <FormField id="timezone" label="Fuso horário" hint="Nome IANA, por exemplo Europe/Lisbon." error={form.formState.errors.timezone?.message}>
            <Input id="timezone" {...form.register('timezone')} />
          </FormField>
          <div className="lg:col-span-2">
            <SpaceLocationFields
              idPrefix="space"
              register={form.register as unknown as UseFormRegister<LocationFormValues>}
              setValue={form.setValue as unknown as UseFormSetValue<LocationFormValues>}
              errors={form.formState.errors as FieldErrors<LocationFormValues>}
            />
          </div>
        </FormSection>
      </EntityForm>

      <div className="space-y-6 mt-8">
        <section aria-labelledby="fotografias" className="rounded-xl border border-border bg-white p-5">
          {/* The manager prints its own "Fotografias"; this one names the section for assistive tech only. */}
          <h2 id="fotografias" className="sr-only">Fotografias</h2>
          <PhotoManager
            kind="spaces"
            entityId={space.id}
            entityName={space.name}
            photos={photos ?? space.photos ?? []}
            onChange={(next) => { setPhotos(next); void invalidate(spaceId) }}
          />
        </section>

        <section aria-labelledby="salas" className="rounded-xl border border-border bg-white p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 id="salas" className="text-base font-semibold text-foreground">Salas</h2>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowNewRoom(!showNewRoom)}><Plus className="h-4 w-4 mr-1" /> Nova sala</Button>
          </div>
          {showNewRoom && (
            <form
              className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4 rounded-lg border border-border p-3"
              onSubmit={roomForm.handleSubmit((values) => createRoom.mutate(values))}
              aria-label="Nova sala"
            >
              <FormField id="room-name" label="Nome" error={roomForm.formState.errors.name?.message}>
                <Input id="room-name" {...roomForm.register('name')} placeholder="ex: Sala Calma" />
              </FormField>
              <FormField id="room-rate" label="€/hora" error={roomForm.formState.errors.hourly_rate?.message}>
                <Input id="room-rate" type="number" step="0.01" {...roomForm.register('hourly_rate')} />
              </FormField>
              <FormField id="room-capacity" label="Lotação" error={roomForm.formState.errors.capacity?.message}>
                <Input id="room-capacity" type="number" {...roomForm.register('capacity')} />
              </FormField>
              <div className="flex items-end"><Button type="submit" disabled={createRoom.isPending}>{createRoom.isPending ? 'A criar…' : 'Criar sala'}</Button></div>
            </form>
          )}
          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem salas.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rooms.map((room) => (
                <li key={room.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="admin-room-card">
                  <div>
                    <Link href={`/admin/rooms/${room.id}`} className="font-medium text-foreground hover:underline">{room.name}</Link>
                    {!room.is_active && <Badge variant="secondary" className="ml-2 align-middle">Inativa</Badge>}
                    <p className="text-xs text-muted-foreground">{formatCurrency(room.hourly_rate)}/h · {room.capacity} pessoa{room.capacity > 1 ? 's' : ''}</p>
                  </div>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => duplicate.mutate(room)} aria-label={`Duplicar ${room.name}`}><Copy className="h-4 w-4 mr-1" /> Duplicar</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { toggleRoom.reset(); setToggling(room) }} aria-label={`${room.is_active ? 'Desativar' : 'Ativar'} ${room.name}`}>
                      <Power className="h-4 w-4 mr-1" /> {room.is_active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DangerZone
          entityLabel="espaço"
          name={space.name}
          shortId={space.id.replace(/-/g, '').slice(0, 8)}
          keeps="Desativar esconde o espaço dos clientes e mantém tudo. Eliminar só é possível quando nenhuma sala teve reservas; as salas, horários, bloqueios e fotografias vão com ele."
          soft={{ active: space.is_active, onToggle: () => adminApi.updateSpace(spaceId, { is_active: !space.is_active }, api) }}
          hard={{
            onDelete: async (confirm) => {
              await adminApi.deleteSpace(spaceId, confirm, api)
              toast({ title: 'Espaço eliminado.', variant: 'success' })
              router.push('/admin/spaces')
            },
          }}
          onDone={() => invalidate(spaceId)}
        />
        <HistoryPanel entity="spaces" id={spaceId} />
      </div>

      <RoomActiveDialog
        room={toggling}
        busy={toggleRoom.isPending}
        inUse={toggleRoom.isError ? roomInUseOf(toggleRoom.error) : null}
        error={toggleRoom.isError && !roomInUseOf(toggleRoom.error) ? 'Não foi possível alterar a sala. Tente novamente.' : null}
        onConfirm={(is_active) => toggling && toggleRoom.mutate({ room: toggling, is_active })}
        onClose={() => { setToggling(null); toggleRoom.reset() }}
      />
    </div>
  )
}
