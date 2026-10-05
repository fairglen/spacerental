'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { adminApi, type HistoryEntity } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminAction } from '@/types'

/**
 * "Histórico" (G05): the entity's audit trail, collapsed by default — actor,
 * action, when, the keys that changed before → after, the reason — with a
 * link to the whole trail.
 */
export const ACTION_LABELS: Record<string, string> = {
  create: 'Criado', 'create.manual': 'Reserva manual criada', 'create.complimentary': 'Horas oferecidas',
  update: 'Editado', delete: 'Eliminado', deactivate: 'Desativado', duplicate: 'Duplicado',
  'availability.set': 'Horário alterado', 'photo.add': 'Fotografia adicionada', 'photo.remove': 'Fotografia removida',
  'photo.reorder': 'Fotografias reordenadas', cancel: 'Cancelado', confirm: 'Confirmado', complete: 'Concluído',
  move: 'Horário alterado', mark_paid: 'Marcado como pago', 'price.override': 'Valor corrigido',
  'role.set': 'Função alterada', 'membership.remove': 'Removido do espaço', anonymise: 'Anonimizado',
  suspend: 'Suspenso', reactivate: 'Reativado', 'password_reset.send': 'Ligação de recuperação enviada',
  'password.set': 'Password definida', 'expiry.extend': 'Validade prolongada', adjust: 'Horas ajustadas',
}

export function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action
}

export function changedKeys(a: AdminAction): string[] {
  const keys = new Set([...Object.keys(a.before ?? {}), ...Object.keys(a.after ?? {})])
  keys.delete('id')
  return Array.from(keys)
}

function show(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function HistoryRow({ action }: { action: AdminAction }) {
  const [openRow, setOpenRow] = useState(false)
  const keys = changedKeys(action)
  return (
    <li className="py-2">
      <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => setOpenRow(!openRow)} aria-expanded={openRow}>
        {openRow ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />}
        <span className="flex-1 min-w-0">
          <span className="text-sm text-foreground">
            <strong>{actionLabel(action.action)}</strong>
            {' · '}{action.actor ? (action.actor.name || action.actor.email) : 'Sistema'}
          </span>
          <span className="block text-xs text-muted-foreground">
            {format(parseISO(action.created_at), "d MMM yyyy, HH:mm", { locale: pt })}
            {keys.length > 0 && ` · ${keys.join(', ')}`}
          </span>
          {action.reason && <span className="block text-xs text-muted-foreground italic">Motivo: {action.reason}</span>}
        </span>
      </button>
      {openRow && keys.length > 0 && (
        <dl className="mt-2 ml-6 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {keys.map((k) => (
            <div key={k} className="contents">
              <dt className="font-medium text-foreground">{k}</dt>
              <dd className="text-muted-foreground break-all">{show(action.before?.[k])} → {show(action.after?.[k])}</dd>
            </div>
          ))}
        </dl>
      )}
      {openRow && keys.length === 0 && <p className="ml-6 mt-1 text-xs text-muted-foreground">Sem campos alterados.</p>}
    </li>
  )
}

export function HistoryPanel({ entity, id }: { entity: HistoryEntity; id: string }) {
  const api = useApi()
  const { currentOrgId } = useOrg()
  const [open, setOpen] = useState(false)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'history', currentOrgId, entity, id],
    queryFn: () => adminApi.getHistory(entity, id, { page_size: 20 }, api),
    enabled: open && !!currentOrgId,
  })
  return (
    <section aria-labelledby="history-heading" className="rounded-xl border border-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 id="history-heading" className="text-base font-semibold text-foreground">Histórico</h2>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Ocultar' : 'Mostrar'}
        </Button>
      </div>
      {open && (
        <div className="mt-3">
          {isLoading && <Skeleton className="h-16" />}
          {isError && <p role="alert" className="text-sm text-red-600">Não foi possível carregar o histórico.</p>}
          {data && data.actions.length === 0 && <p className="text-sm text-muted-foreground">Ainda sem alterações registadas.</p>}
          {data && data.actions.length > 0 && (
            <ul className="divide-y divide-border">{data.actions.map((a) => <HistoryRow key={a.id} action={a} />)}</ul>
          )}
          <p className="mt-3 text-xs">
            <Link href={`/admin/audit?entity_type=${entityType(entity)}&entity_id=${id}`} className="text-primary underline">Ver no histórico completo</Link>
          </p>
        </div>
      )}
    </section>
  )
}

function entityType(entity: HistoryEntity): string {
  return { spaces: 'space', rooms: 'room', bookings: 'booking', users: 'user', packages: 'package', purchases: 'purchase', support: 'support_request' }[entity]
}
