'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { formatBookingCost, formatCurrency, formatHours, STATUS_LABELS } from '@/lib/utils'
import { SUPPORT_CATEGORY_LABELS } from '@/components/help/HelpDialog'
import { ROLE_LABELS, RoleDialog } from '@/components/admin/users/RoleDialog'
import { GrantHoursDialog } from '@/components/admin/users/GrantHoursDialog'
import { ExtendValidityDialog } from '@/components/admin/users/ExtendValidityDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { AdminPurchase, ComplimentaryHoursBody, OrgUser } from '@/types'

const PURCHASE_STATUS: Record<'pending' | 'active' | 'cancelled', string> = { pending: 'Por pagar', active: 'Ativo', cancelled: 'Cancelado' }

function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/** One customer as the operator sees them (A05). */
export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useOrg()
  return <UserDetail key={`${currentOrgId}-${id}`} userId={id} currentOrgId={currentOrgId} />
}

function UserDetail({ userId, currentOrgId }: { userId: string; currentOrgId: string | null }) {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()
  const [roleTarget, setRoleTarget] = useState<OrgUser | null>(null)
  const [granting, setGranting] = useState(false)
  const [extending, setExtending] = useState<AdminPurchase | null>(null)

  const enabled = !!session?.accessToken && !!currentOrgId
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'user', currentOrgId, userId],
    queryFn: () => adminApi.getUser(userId, api),
    enabled,
  })
  const { data: packages = [] } = useQuery({
    queryKey: ['admin', 'packages', currentOrgId],
    queryFn: () => adminApi.getPackages(api),
    enabled,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'user', currentOrgId, userId] })
  const setRole = useMutation({
    mutationFn: (role: 'admin' | 'member') => adminApi.setUserRole(userId, role, api),
    onSuccess: () => { setRoleTarget(null); refresh(); qc.invalidateQueries({ queryKey: ['admin', 'users'] }) },
  })
  const grant = useMutation({
    mutationFn: (body: ComplimentaryHoursBody) => adminApi.grantHours(userId, body, api),
    onSuccess: () => { setGranting(false); refresh() },
  })
  const extend = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { expires_at: string; reason: string } }) => adminApi.extendPurchase(id, body, api),
    onSuccess: () => { setExtending(null); refresh() },
  })

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar este utilizador. <Link href="/admin/users" className="underline">Voltar à lista</Link>.</p></div>

  const { user, bookings, purchases, support_requests } = data
  const isSelf = session?.user?.id === user.id
  const canChangeRole = !isSelf && user.role !== 'owner'
  const activePacks = packages.filter((p) => p.is_active)

  return (
    <div className="p-8 space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← Utilizadores</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              {user.name || user.email}
              <Badge variant={user.role === 'member' ? 'secondary' : 'default'}>{ROLE_LABELS[user.role]}</Badge>
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              <a href={`mailto:${user.email}`} className="hover:underline">{user.email}</a>
              {' · '}desde {format(parseISO(user.joined_at), "d 'de' MMMM 'de' yyyy", { locale: pt })}
              {' · '}{user.bookings_count} {user.bookings_count === 1 ? 'reserva' : 'reservas'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setGranting(true)} disabled={activePacks.length === 0} title={activePacks.length === 0 ? 'Cria um pack ativo primeiro' : undefined}>
              Atribuir horas
            </Button>
            {canChangeRole && (
              <Button variant={user.role === 'admin' ? 'destructive' : 'default'} onClick={() => setRoleTarget(user)}>
                {user.role === 'admin' ? 'Remover admin' : 'Tornar admin'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Packs e horas</CardTitle></CardHeader>
        <CardContent className="p-0">
          {purchases.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Sem packs.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background border-y border-border">
                <tr>{['Pack', 'Horas restantes', 'Pago', 'Estado', 'Validade', 'Nota', ''].map((h, i) => <th key={i} className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchases.map((p) => (
                  <tr key={p.id} className={p.status !== 'active' ? 'opacity-60' : undefined}>
                    <td className="px-4 py-2 text-foreground">{p.package?.name ?? 'Pack'}</td>
                    <td className="px-4 py-2 text-foreground">{formatHours(p.hours_remaining)} de {formatHours(p.hours_total)}</td>
                    <td className="px-4 py-2 text-foreground">{p.amount_paid === 0 ? <Badge variant="secondary">Oferta</Badge> : formatCurrency(p.amount_paid)}</td>
                    <td className="px-4 py-2"><Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{PURCHASE_STATUS[p.status]}</Badge></td>
                    <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                      {format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}
                      {p.status === 'active' && parseISO(p.expires_at).getTime() < Date.now() && <span className="block text-xs text-red-600">caducou</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground max-w-xs"><span className="line-clamp-2 whitespace-pre-line" title={p.admin_note ?? undefined}>{p.admin_note ?? '—'}</span></td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {p.status === 'active' && (
                        <Button size="sm" variant="outline" onClick={() => setExtending(p)} aria-label={`Prolongar validade ${p.package?.name ?? 'Pack'}`}>Prolongar</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Reservas</CardTitle></CardHeader>
        <CardContent className="p-0">
          {bookings.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Sem reservas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-background border-y border-border">
                <tr>{['Quando', 'Sala', 'Estado', 'Valor'].map((h) => <th key={h} className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bookings.map((b) => (
                  <tr key={b.id} className={['cancelled', 'expired'].includes(b.status) ? 'opacity-60' : undefined}>
                    <td className="px-4 py-2 text-foreground whitespace-nowrap">
                      {format(parseISO(b.start_time), 'd MMM yyyy, HH:mm', { locale: pt })}–{format(parseISO(b.end_time), 'HH:mm')}
                    </td>
                    <td className="px-4 py-2 text-foreground">{b.room?.name ?? '—'}</td>
                    <td className="px-4 py-2"><Badge variant="secondary">{STATUS_LABELS[b.status]}</Badge></td>
                    <td className="px-4 py-2 text-foreground">{formatBookingCost(b)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Pedidos de ajuda</CardTitle></CardHeader>
        <CardContent className="p-0">
          {support_requests.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">Sem pedidos.</p>
          ) : (
            <ul className="divide-y divide-border">
              {support_requests.map((r) => (
                <li key={r.id} className="px-6 py-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>{format(parseISO(r.created_at), 'd MMM yyyy, HH:mm', { locale: pt })}</span>
                    <span>· #{r.reference} · {SUPPORT_CATEGORY_LABELS[r.category]}</span>
                    <Badge variant={r.status === 'new' ? 'default' : 'secondary'}>{r.status === 'new' ? 'Nova' : 'Fechada'}</Badge>
                  </div>
                  <p className="mt-1 text-foreground line-clamp-2">{r.message}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <RoleDialog
        user={roleTarget}
        busy={setRole.isPending}
        error={setRole.isError ? errorMessage(setRole.error, 'Não foi possível alterar o papel. Tenta novamente.') : null}
        onConfirm={(role) => setRole.mutate(role)}
        onClose={() => { setRoleTarget(null); setRole.reset() }}
      />
      <ExtendValidityDialog
        purchase={extending}
        busy={extend.isPending}
        error={extend.isError ? errorMessage(extend.error, 'Não foi possível prolongar a validade. Tenta novamente.') : null}
        onSubmit={(body) => extending && extend.mutate({ id: extending.id, body })}
        onClose={() => { setExtending(null); extend.reset() }}
      />
      {granting && (
        <GrantHoursDialog
          open
          userLabel={user.name || user.email}
          packages={activePacks}
          busy={grant.isPending}
          error={grant.isError ? errorMessage(grant.error, 'Não foi possível atribuir as horas. Tenta novamente.') : null}
          onSubmit={(body) => grant.mutate(body)}
          onClose={() => { setGranting(false); grant.reset() }}
        />
      )}
    </div>
  )
}
