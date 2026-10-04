'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { Copy, Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { localInputToUtc, utcToWall } from '@/lib/spaceClock'
import { statusOf, detailOf } from '@/lib/httpError'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryPanel } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { PhotoManager } from '@/components/admin/PhotoManager'
import { roomInUseOf } from '@/components/admin/RoomActiveDialog'
import { formatCurrency } from '@/lib/utils'
import { DAYS, rowsFromRules, rulesFromRows, type DayRow, type Window } from '@/lib/admin/openingHoursEditor'
import type { Room } from '@/types'

const schema = z.object({
  name: z.string().min(2, 'Nome obrigatório'),
  description: z.string(),
  capacity: z.coerce.number().min(1, 'Pelo menos 1 pessoa'),
  hourly_rate: z.coerce.number().min(0, 'Valor inválido'),
  color: z.string().min(1),
  amenities: z.string(),
})
type FormValues = z.infer<typeof schema>

function toForm(room: Room): FormValues {
  return {
    name: room.name,
    description: room.description ?? '',
    capacity: room.capacity,
    hourly_rate: room.hourly_rate,
    color: room.color,
    amenities: room.amenities.join(', '),
  }
}


/** The ROOM page (G06). Under the old route the id was a SPACE's: that still
 * lands here and is sent on to the space's page. */
export default function AdminRoomPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('rooms')
  return <RoomDetail key={`${currentOrgId}-${id}`} roomId={id} />
}

function RoomDetail({ roomId }: { roomId: string }) {
  const router = useRouter()
  const { api, enabled, currentOrgId, invalidate } = useCrud('rooms')
  const { toast } = useToast()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'rooms', currentOrgId, roomId],
    queryFn: () => adminApi.getRoom(roomId, api),
    enabled,
    retry: false,
  })
  // A 404 may be the old `/admin/rooms/<space id>` link: if it names a space, go there.
  const isNotFound = isError && statusOf(error) === 404
  const { data: asSpace } = useQuery({
    queryKey: ['admin', 'spaces', currentOrgId, roomId, 'redirect'],
    queryFn: () => adminApi.getSpace(roomId, api),
    enabled: enabled && isNotFound,
    retry: false,
  })
  useEffect(() => { if (asSpace) router.replace(`/admin/spaces/${roomId}`) }, [asSpace, roomId, router])

  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  useEffect(() => { if (data) form.reset(toForm(data.room)) }, [data, form])
  const [days, setDays] = useState<DayRow[] | null>(null)
  useEffect(() => { if (data) setDays(rowsFromRules(data.rules)) }, [data])
  const [photos, setPhotos] = useState<Room['photos'] | null>(null)
  const [block, setBlock] = useState({ start: '', end: '', reason: '' })

  const saveHours = useMutation({
    mutationFn: (rows: DayRow[]) => adminApi.setAvailability(roomId, rulesFromRows(rows), api),
    onSuccess: async () => { toast({ title: 'Horário guardado.', variant: 'success' }); await invalidate(roomId) },
    onError: (err) => toast({ title: 'Não foi possível guardar o horário.', description: detailOf(err), variant: 'error' }),
  })
  const copyDay = useMutation({
    mutationFn: (day: number) => adminApi.copyAvailabilityToAllDays(roomId, day, api),
    onSuccess: async (rules) => { setDays(rowsFromRules(rules)); toast({ title: 'Horário copiado para todos os dias.', variant: 'success' }); await invalidate(roomId) },
    onError: (err) => toast({ title: 'Não foi possível copiar o horário.', description: detailOf(err), variant: 'error' }),
  })
  const addBlock = useMutation({
    // The inputs are the space's wall clock (R01), whatever zone the operator is in.
    mutationFn: () => adminApi.createBlock(roomId, { start_time: localInputToUtc(block.start, data?.space.timezone ?? 'Europe/Lisbon'), end_time: localInputToUtc(block.end, data?.space.timezone ?? 'Europe/Lisbon'), reason: block.reason }, api),
    onSuccess: async () => { setBlock({ start: '', end: '', reason: '' }); toast({ title: 'Bloqueio criado.', variant: 'success' }); await invalidate(roomId) },
    onError: (err) => toast({ title: 'Não foi possível bloquear.', description: detailOf(err) ?? 'Há reservas nesse horário.', variant: 'error' }),
  })
  const removeBlock = useMutation({
    mutationFn: (blockId: string) => adminApi.deleteBlock(roomId, blockId, api),
    onSuccess: async () => { toast({ title: 'Bloqueio removido.', variant: 'success' }); await invalidate(roomId) },
  })
  const duplicate = useMutation({
    mutationFn: () => adminApi.duplicateRoom(roomId, api),
    onSuccess: async (copy) => { toast({ title: `${copy.name} criada.`, variant: 'success' }); await invalidate(); router.push(`/admin/rooms/${copy.id}`) },
    onError: (err) => toast({ title: 'Não foi possível duplicar a sala.', description: detailOf(err), variant: 'error' }),
  })

  if (isLoading || (isNotFound && asSpace === undefined && !error)) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isNotFound && !asSpace) {
    return <div className="p-8"><p role="alert" className="text-sm text-red-600">Sala não encontrada. <Link href="/admin/rooms" className="underline">Voltar às salas</Link>.</p></div>
  }
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar esta sala. <button type="button" className="underline" onClick={() => refetch()}>Tentar novamente</button></p></div>
  const { room, space, blocks, bookings } = data
  const zone = space.timezone ?? 'Europe/Lisbon'

  return (
    <div className="p-8 pb-28 max-w-5xl">
      <PageHeader
        title={room.name}
        crumbs={[{ label: 'Salas', href: '/admin/rooms' }, { label: space.name, href: `/admin/spaces/${space.id}` }, { label: room.name }]}
        badge={<Badge variant={room.is_active ? 'default' : 'secondary'}>{room.is_active ? 'Ativa' : 'Inativa'}</Badge>}
        description={`${formatCurrency(room.hourly_rate)}/h · ${room.capacity} pessoa${room.capacity > 1 ? 's' : ''} · ${bookings.total} reserva(s), ${bookings.upcoming} por vir`}
        actions={<Button type="button" variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending}><Copy className="h-4 w-4 mr-1" /> Duplicar</Button>}
      />
      <EntityForm
        form={form}
        successMessage="Sala guardada."
        onCancel={() => router.push('/admin/rooms')}
        onSubmit={(values) => adminApi.updateRoom(roomId, {
          name: values.name,
          // Blank clears a stored value: the API takes an explicit null.
          description: values.description.trim() || null,
          capacity: values.capacity,
          hourly_rate: values.hourly_rate,
          color: values.color,
          amenities: values.amenities.split(',').map((s) => s.trim()).filter(Boolean),
        } as Partial<Room>, api)}
        onSaved={() => invalidate(roomId)}
      >
        <FormSection title="Detalhes" description="O que os clientes veem ao reservar.">
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}><Input id="name" {...form.register('name')} /></FormField>
          <FormField id="hourly_rate" label="€/hora" error={form.formState.errors.hourly_rate?.message}><Input id="hourly_rate" type="number" step="0.01" {...form.register('hourly_rate')} /></FormField>
          <FormField id="capacity" label="Lotação" error={form.formState.errors.capacity?.message}><Input id="capacity" type="number" {...form.register('capacity')} /></FormField>
          <FormField id="color" label="Cor no calendário"><Input id="color" type="color" className="h-10 w-20 p-1" {...form.register('color')} /></FormField>
          <FormField id="amenities" label="Comodidades" hint="Separadas por vírgulas." full><Input id="amenities" {...form.register('amenities')} /></FormField>
          <FormField id="description" label="Descrição" full><Textarea id="description" rows={3} {...form.register('description')} /></FormField>
        </FormSection>
      </EntityForm>

      <div className="space-y-6 mt-8">
        <section aria-labelledby="horario" className="rounded-xl border border-border bg-white p-5">
          <h2 id="horario" className="text-base font-semibold text-foreground">Horário</h2>
          <p className="text-sm text-muted-foreground mt-1">Horas no relógio do espaço ({space.timezone}). Um dia desligado está fechado.</p>
          {days && (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Horário semanal</caption>
              <tbody>
                {DAYS.map((d, i) => (
                  <tr key={d.day_of_week} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={days[i].enabled} onChange={(e) => setDays(days.map((r, j) => (j === i ? { ...r, enabled: e.target.checked } : r)))} aria-label={`${d.label} aberto`} />
                        {d.label}
                      </label>
                    </td>
                    <td className="py-2 pr-2" colSpan={2}>
                      {/* Every window of the day (a lunch break makes two); none is lost on save. */}
                      {days[i].windows.map((w, k) => {
                        const nth = k === 0 ? '' : ` (${k + 1})`
                        const setWindow = (patch: Partial<Window>) => setDays(days.map((r, j) => (j === i ? { ...r, windows: r.windows.map((x, l) => (l === k ? { ...x, ...patch } : x)) } : r)))
                        return (
                          <div key={k} className="flex items-center gap-2 mb-1">
                            <Input type="time" step={3600} aria-label={`${d.label} abre${nth}`} value={w.open_time} disabled={!days[i].enabled} onChange={(e) => setWindow({ open_time: e.target.value })} />
                            <span aria-hidden>–</span>
                            <Input type="time" step={3600} aria-label={`${d.label} fecha${nth}`} value={w.close_time} disabled={!days[i].enabled} onChange={(e) => setWindow({ close_time: e.target.value })} />
                            {days[i].windows.length > 1 && (
                              <Button type="button" variant="ghost" size="sm" disabled={!days[i].enabled} aria-label={`Remover período ${k + 1} de ${d.label}`} onClick={() => setDays(days.map((r, j) => (j === i ? { ...r, windows: r.windows.filter((_, l) => l !== k) } : r)))}>Remover</Button>
                            )}
                          </div>
                        )
                      })}
                      <Button type="button" variant="ghost" size="sm" disabled={!days[i].enabled} aria-label={`Adicionar período a ${d.label}`} onClick={() => setDays(days.map((r, j) => (j === i ? { ...r, windows: [...r.windows, { open_time: r.windows[r.windows.length - 1]?.close_time ?? '14:00', close_time: '18:00' }] } : r)))}>+ período</Button>
                    </td>
                    <td className="py-2 text-right">
                      <Button type="button" variant="ghost" size="sm" disabled={!days[i].enabled || copyDay.isPending} onClick={() => copyDay.mutate(d.day_of_week)} aria-label={`Copiar ${d.label} para todos os dias`}>
                        Copiar para todos os dias
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={() => days && saveHours.mutate(days)} disabled={!days || saveHours.isPending}>{saveHours.isPending ? 'A guardar…' : 'Guardar horário'}</Button>
          </div>
        </section>

        <section aria-labelledby="bloqueios" className="rounded-xl border border-border bg-white p-5">
          <h2 id="bloqueios" className="text-base font-semibold text-foreground">Bloqueios</h2>
          <p className="text-sm text-muted-foreground mt-1">Os próximos 30 dias. Um bloqueio não pode cobrir uma reserva.</p>
          <form
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4"
            onSubmit={(e) => { e.preventDefault(); addBlock.mutate() }}
            aria-label="Novo bloqueio"
          >
            <div><Label htmlFor="block-start">Início</Label><Input id="block-start" type="datetime-local" step={3600} value={block.start} onChange={(e) => setBlock({ ...block, start: e.target.value })} className="mt-1" required /></div>
            <div><Label htmlFor="block-end">Fim</Label><Input id="block-end" type="datetime-local" step={3600} value={block.end} onChange={(e) => setBlock({ ...block, end: e.target.value })} className="mt-1" required /></div>
            <div><Label htmlFor="block-reason">Motivo</Label><Input id="block-reason" value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })} className="mt-1" required /></div>
            <div className="flex items-end"><Button type="submit" disabled={addBlock.isPending || !block.start || !block.end || !block.reason.trim()}>Bloquear</Button></div>
          </form>
          {blocks.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Sem bloqueios nos próximos 30 dias.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {/* The space clock, like the form above (review on #65). */}
                    {format(parseISO(`${utcToWall(b.start_time, zone).date}T00:00:00`), 'EEE d MMM', { locale: pt })}, {utcToWall(b.start_time, zone).time} – {utcToWall(b.end_time, zone).time}
                    <span className="text-muted-foreground"> · {b.reason}</span>
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeBlock.mutate(b.id)} aria-label={`Remover bloqueio ${utcToWall(b.start_time, zone).date}T${utcToWall(b.start_time, zone).time}`}><Trash2 className="h-4 w-4" /></Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="fotografias" className="rounded-xl border border-border bg-white p-5">
          {/* The manager prints its own "Fotografias"; this one names the section for assistive tech only. */}
          <h2 id="fotografias" className="sr-only">Fotografias</h2>
          <PhotoManager kind="rooms" entityId={room.id} entityName={room.name} photos={photos ?? room.photos ?? []} onChange={(next) => { setPhotos(next); void invalidate(roomId) }} />
        </section>

        <DangerZone
          entityLabel="sala"
          name={room.name}
          shortId={room.id.replace(/-/g, '').slice(0, 8)}
          keeps="Desativar tira a sala das reservas e mantém tudo; é recusado enquanto houver reservas futuras. Eliminar só é possível para uma sala que nunca teve reservas nem bloqueios; as fotografias vão com ela."
          soft={{
            active: room.is_active,
            onToggle: async () => {
              try {
                await adminApi.updateRoom(roomId, { is_active: !room.is_active }, api)
              } catch (err) {
                const inUse = roomInUseOf(err)
                if (inUse) {
                  // The A07 refusal, reshaped to the zone's own blocker list.
                  throw { response: { status: 409, data: { detail: { message: `Ainda há ${inUse.total} reserva(s) marcada(s) nesta sala. Mova-as ou cancele-as primeiro.`, blockers: inUse.bookings.map((b) => `${format(parseISO(b.start_time), "d MMM HH:mm", { locale: pt })} · ${b.customer_name || b.customer_email || 'cliente'}`) } } } }
                }
                throw err
              }
            },
          }}
          hard={{
            onDelete: async (confirm) => {
              await adminApi.deleteRoom(roomId, confirm, api)
              toast({ title: 'Sala eliminada.', variant: 'success' })
              await invalidate()
              router.push(`/admin/spaces/${space.id}`)
            },
          }}
          onDone={() => invalidate(roomId)}
        />
        <HistoryPanel entity="rooms" id={roomId} />
      </div>
    </div>
  )
}
