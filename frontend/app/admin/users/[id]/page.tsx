'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { detailOf } from '@/lib/httpError'
import { useCrud } from '@/components/admin/crud/useCrud'
import { EntityForm, FormField, FormSection } from '@/components/admin/crud/EntityForm'
import { DangerZone } from '@/components/admin/crud/DangerZone'
import { HistoryPanel } from '@/components/admin/crud/HistoryPanel'
import { PageHeader } from '@/components/admin/crud/PageHeader'
import { ReasonDialog } from '@/components/admin/crud/ReasonDialog'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatBookingCost, formatCurrency, formatHours, packSplitLines, STATUS_LABELS } from '@/lib/utils'
import { SUPPORT_CATEGORY_LABELS } from '@/components/help/HelpDialog'
import { ROLE_LABELS, RoleDialog } from '@/components/admin/users/RoleDialog'
import { GrantHoursDialog } from '@/components/admin/users/GrantHoursDialog'
import { ExtendValidityDialog } from '@/components/admin/users/ExtendValidityDialog'
import type { AdminPurchase, ComplimentaryHoursBody, OrgUser } from '@/types'

// A customer may have no name (the API allows null); blank clears it.
const schema = z.object({
  name: z.string(),
  email: z.string().email('Email inválido'),
})
type FormValues = z.infer<typeof schema>

const PURCHASE_STATUS: Record<'pending' | 'active' | 'cancelled', string> = { pending: 'Por pagar', active: 'Ativo', cancelled: 'Cancelado' }
const SUPPORT_STATUS = { new: 'Nova', in_progress: 'Em curso', closed: 'Fechada' } as const

/** One customer (G06): Conta, Acesso, Reservas, Banco de horas, Pedidos de ajuda, DangerZone, Histórico. */
export default function AdminUserPage() {
  const { id } = useParams<{ id: string }>()
  const { currentOrgId } = useCrud('users')
  return <UserDetail key={`${currentOrgId}-${id}`} userId={id} />
}

function UserDetail({ userId }: { userId: string }) {
  const router = useRouter()
  const { data: session } = useSession()
  const { api, enabled, currentOrgId, invalidate } = useCrud('users')
  const { toast } = useToast()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'users', currentOrgId, userId],
    queryFn: () => adminApi.getUser(userId, api),
    enabled,
  })
  const { data: packages = [] } = useQuery({ queryKey: ['admin', 'packages', currentOrgId], queryFn: () => adminApi.getPackages(api), enabled })
  const { data: history } = useQuery({
    queryKey: ['admin', 'history', currentOrgId, 'users', userId, 'reset'],
    queryFn: () => adminApi.getHistory('users', userId, { page_size: 50 }, api),
    enabled,
  })
  const lastReset = history?.actions.find((a) => a.action === 'password_reset.send')

  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  useEffect(() => { if (data) form.reset({ name: data.user.name ?? '', email: data.user.email }) }, [data, form])

  const [roleTarget, setRoleTarget] = useState<OrgUser | null>(null)
  const [granting, setGranting] = useState(false)
  const [extending, setExtending] = useState<AdminPurchase | null>(null)
  const [adjusting, setAdjusting] = useState<AdminPurchase | null>(null)
  const [adjustHours, setAdjustHours] = useState('')
  const [cancelling, setCancelling] = useState<AdminPurchase | null>(null)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState({ password: '', confirm: '' })
  const [pwError, setPwError] = useState<string | null>(null)
  const [anonOpen, setAnonOpen] = useState(false)
  const [anonConfirm, setAnonConfirm] = useState('')
  const [membershipOpen, setMembershipOpen] = useState(false)

  const done = async (message: string) => { toast({ title: message, variant: 'success' }); await invalidate(userId) }
  const fail = (fallback: string) => (err: unknown) => toast({ title: detailOf(err) ?? fallback, variant: 'error' })
  const setRole = useMutation({ mutationFn: (role: 'admin' | 'member') => adminApi.setUserRole(userId, role, api), onSuccess: async () => { setRoleTarget(null); await done('Função alterada.') } })
  const grant = useMutation({ mutationFn: (body: ComplimentaryHoursBody) => adminApi.grantHours(userId, body, api), onSuccess: async () => { setGranting(false); await done('Horas atribuídas.') } })
  const extend = useMutation({ mutationFn: ({ id, body }: { id: string; body: { expires_at: string; reason: string } }) => adminApi.extendPurchase(id, body, api), onSuccess: async () => { setExtending(null); await done('Validade prolongada.') } })
  const suspend = useMutation({
    mutationFn: (disabled: boolean) => adminApi.updateUser(userId, { disabled_at: disabled ? new Date().toISOString() : null }, api),
    onSuccess: (u) => done(u.disabled_at ? 'Conta suspensa.' : 'Conta reativada.'),
    onError: fail('Não foi possível alterar a conta.'),
  })
  const sendReset = useMutation({
    mutationFn: () => adminApi.sendPasswordReset(userId, api),
    onSuccess: (r) => done(`Ligação enviada para ${r.sent_to}.`),
    onError: fail('Não foi possível enviar a ligação.'),
  })
  const setPassword = useMutation({
    mutationFn: () => adminApi.setPassword(userId, pw.password, api),
    onSuccess: async () => { setPwOpen(false); setPw({ password: '', confirm: '' }); await done('Password definida. As sessões anteriores foram terminadas.') },
    onError: (err) => setPwError(detailOf(err) ?? 'Não foi possível definir a password.'),
  })
  const removeMembership = useMutation({
    mutationFn: () => adminApi.removeMembership(userId, data?.user.email ?? '', api),
    onSuccess: async () => { toast({ title: 'Removido do espaço.', variant: 'success' }); await invalidate(); router.push('/admin/users') },
    onError: fail('Não foi possível remover.'),
  })

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 rounded-xl" /></div>
  if (isError || !data) return <div className="p-8"><p role="alert" className="text-sm text-red-600">Não foi possível carregar este cliente. <Link href="/admin/users" className="underline">Voltar à lista</Link>.</p></div>
  const { user, bookings, purchases, balance, support_requests } = data
  const isSelf = session?.user?.id === user.id
  const canChangeRole = !isSelf && user.role !== 'owner'
  const activePacks = packages.filter((p) => p.is_active)
  const short = user.id.replace(/-/g, '').slice(0, 8)
  const suspended = !!user.disabled_at
  const unreferenced = bookings.length === 0 && purchases.length === 0 && support_requests.length === 0

  return (
    <div className="p-8 pb-28 max-w-5xl">
      <PageHeader
        title={user.name || user.email}
        crumbs={[{ label: 'Clientes', href: '/admin/users' }, { label: user.name || user.email }]}
        badge={<><Badge variant={user.role === 'member' ? 'secondary' : 'default'}>{ROLE_LABELS[user.role]}</Badge>{suspended && <Badge variant="destructive">Suspenso</Badge>}</>}
        description={`${user.email} · desde ${format(parseISO(user.joined_at), "d 'de' MMMM 'de' yyyy", { locale: pt })} · ${user.bookings_count} ${user.bookings_count === 1 ? 'reserva' : 'reservas'}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setGranting(true)} disabled={activePacks.length === 0} title={activePacks.length === 0 ? 'Crie um pack ativo primeiro' : undefined}>Atribuir horas</Button>
            {canChangeRole && <Button variant={user.role === 'admin' ? 'destructive' : 'default'} onClick={() => setRoleTarget(user)}>{user.role === 'admin' ? 'Remover admin' : 'Tornar admin'}</Button>}
          </>
        }
      />

      <EntityForm
        form={form}
        successMessage="Conta guardada."
        onCancel={() => router.push('/admin/users')}
        onSubmit={(values) => adminApi.updateUser(userId, { name: values.name.trim() || null, email: values.email }, api)}
        onSaved={() => invalidate(userId)}
        extra={!isSelf && (
          <Button type="button" variant={suspended ? 'outline' : 'destructive'} size="sm" onClick={() => suspend.mutate(!suspended)} disabled={suspend.isPending}>
            {suspended ? 'Reativar conta' : 'Suspender conta'}
          </Button>
        )}
      >
        <FormSection title="Conta" description={suspended ? `Suspensa desde ${format(parseISO(user.disabled_at!), "d MMM yyyy, HH:mm", { locale: pt })}: não consegue iniciar sessão nem reservar.` : 'A pessoa consegue iniciar sessão e reservar.'}>
          <FormField id="name" label="Nome" error={form.formState.errors.name?.message}><Input id="name" {...form.register('name')} /></FormField>
          <FormField id="email" label="Email" error={form.formState.errors.email?.message}><Input id="email" type="email" {...form.register('email')} /></FormField>
        </FormSection>
      </EntityForm>

      <div className="space-y-6 mt-8">
        <section aria-labelledby="acesso" className="rounded-xl border border-border bg-white p-5">
          <h2 id="acesso" className="text-base font-semibold text-foreground">Acesso</h2>
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">Ligação de recuperação</p>
              <p className="text-xs text-muted-foreground mt-1">
                {lastReset ? `Última enviada a ${format(parseISO(lastReset.created_at), "d MMM yyyy, HH:mm", { locale: pt })}.` : 'Nunca enviada por aqui.'}
                {' '}Válida 60 minutos, uma só utilização.
              </p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => sendReset.mutate()} disabled={sendReset.isPending || suspended} title={suspended ? 'Reative a conta primeiro' : undefined}>
                Enviar ligação de recuperação
              </Button>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">Password</p>
              <p className="text-xs text-muted-foreground mt-1">Definir uma password termina todas as sessões da pessoa.</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => { setPwError(null); setPwOpen(true) }}>Definir password</Button>
            </div>
            {!isSelf && (
              <div className="rounded-lg border border-border p-3 lg:col-span-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Membro deste espaço</p>
                  <p className="text-xs text-muted-foreground">Remover tira o acesso a este espaço; a conta continua a existir. Não pode remover o último proprietário.</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => setMembershipOpen(true)}>Remover do espaço</Button>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="reservas" className="rounded-xl border border-border bg-white p-5">
          <h2 id="reservas" className="text-base font-semibold text-foreground mb-3">Reservas</h2>
          {bookings.length === 0 ? <p className="text-sm text-muted-foreground">Sem reservas.</p> : (
            <table className="w-full text-sm">
              <caption className="sr-only">Reservas do cliente</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{['Quando', 'Sala', 'Estado', 'Valor'].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {bookings.map((b) => (
                  <tr key={b.id} className={['cancelled', 'expired'].includes(b.status) ? 'opacity-60' : undefined}>
                    <td className="px-2 py-2 whitespace-nowrap"><Link href={`/admin/bookings/${b.id}`} className="underline underline-offset-2">{format(parseISO(b.start_time), 'd MMM yyyy, HH:mm', { locale: pt })}–{format(parseISO(b.end_time), 'HH:mm')}</Link></td>
                    <td className="px-2 py-2">{b.room?.name ?? '—'}</td>
                    <td className="px-2 py-2"><Badge variant="secondary">{STATUS_LABELS[b.status]}</Badge></td>
                    <td className="px-2 py-2">
                      {formatBookingCost(b)}
                      {/* H02: which packs, on hover — the same hint as the bookings table. */}
                      {(b.package_debits?.length ?? 0) > 0 && (
                        <span className="block text-xs text-muted-foreground underline decoration-dotted cursor-help" title={packSplitLines(b.package_debits).join('\n')}>
                          {b.package_debits!.length === 1 ? '1 pack' : `de ${b.package_debits!.length} packs`}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="banco" className="rounded-xl border border-border bg-white p-5">
          <h2 id="banco" className="text-base font-semibold text-foreground">Banco de horas</h2>
          <p data-testid="user-hour-bank" className="text-sm text-muted-foreground mt-1">
            <span className="font-semibold text-foreground">{formatHours(balance.hours_available)} disponíveis</span>
            {balance.hours_expiring_next && <> · {formatHours(balance.hours_expiring_next.hours)} expiram a {format(parseISO(balance.hours_expiring_next.expires_at), "d 'de' MMM", { locale: pt })}.</>}
          </p>
          {purchases.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Sem packs.</p> : (
            <table className="mt-3 w-full text-sm">
              <caption className="sr-only">Packs do cliente</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground"><tr>{['Pack', 'Horas restantes', 'Pago', 'Estado', 'Validade', 'Nota', ''].map((h, i) => <th key={i} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {purchases.map((p) => (
                  <tr key={p.id} className={p.status !== 'active' ? 'opacity-60' : undefined}>
                    <td className="px-2 py-2"><Link href={`/admin/purchases/${p.id}`} className="underline underline-offset-2">{p.package?.name ?? 'Pack'}</Link></td>
                    <td className="px-2 py-2">{formatHours(p.hours_remaining)} de {formatHours(p.hours_total)}</td>
                    <td className="px-2 py-2">{p.amount_paid === 0 ? <Badge variant="secondary">Oferta</Badge> : formatCurrency(p.amount_paid)}</td>
                    <td className="px-2 py-2"><Badge variant={p.status === 'active' ? 'default' : 'secondary'}>{PURCHASE_STATUS[p.status]}</Badge></td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                      {format(parseISO(p.expires_at), 'd MMM yyyy', { locale: pt })}
                      {p.status === 'active' && parseISO(p.expires_at).getTime() < Date.now() && <span className="block text-xs text-red-600">caducou</span>}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground max-w-xs"><span className="line-clamp-2 whitespace-pre-line" title={p.admin_note ?? undefined}>{p.admin_note ?? '—'}</span></td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {p.status === 'active' && (
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setAdjustHours(''); setAdjusting(p) }} aria-label={`Ajustar horas ${p.package?.name ?? 'Pack'}`}>Ajustar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setExtending(p)} aria-label={`Prolongar validade ${p.package?.name ?? 'Pack'}`}>Prolongar</Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => setCancelling(p)} aria-label={`Cancelar ${p.package?.name ?? 'Pack'}`}>Cancelar</Button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="pedidos" className="rounded-xl border border-border bg-white p-5">
          <h2 id="pedidos" className="text-base font-semibold text-foreground mb-3">Pedidos de ajuda</h2>
          {support_requests.length === 0 ? <p className="text-sm text-muted-foreground">Sem pedidos.</p> : (
            <ul className="divide-y divide-border">
              {support_requests.map((r) => (
                <li key={r.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <Link href={`/admin/support/${r.id}`} className="underline underline-offset-2">#{r.reference}</Link>
                    <span>{format(parseISO(r.created_at), 'd MMM yyyy, HH:mm', { locale: pt })} · {SUPPORT_CATEGORY_LABELS[r.category]}</span>
                    <Badge variant={r.status === 'closed' ? 'secondary' : 'default'}>{SUPPORT_STATUS[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-foreground line-clamp-2">{r.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DangerZone
          entityLabel="conta"
          name={user.email}
          shortId={short}
          keeps="Anonimizar substitui o nome e o email por marcadores, retira a password, suspende a conta para sempre e remove-a deste espaço; as reservas, packs e pedidos ficam. Eliminar só é possível quando nada faz referência à conta."
          hard={{
            label: 'Anonimizar a conta',
            hint: 'Não pode ser anulado. Escreva o email ou o identificador curto para confirmar.',
            onDelete: async (confirm) => { setAnonConfirm(confirm); setAnonOpen(true) },
            disabledReason: isSelf ? 'Não pode anonimizar a sua própria conta.' : undefined,
          }}
          onDone={() => undefined}
        />
        {unreferenced && !isSelf && (
          <DangerZone
            entityLabel="conta"
            name={user.email}
            shortId={short}
            keeps="Nada faz referência a esta conta, por isso pode ser eliminada de vez."
            hard={{
              label: 'Eliminar a conta definitivamente',
              onDelete: async (confirm) => {
                await adminApi.deleteUser(userId, confirm, api)
                toast({ title: 'Conta eliminada.', variant: 'success' })
                await invalidate()
                router.push('/admin/users')
              },
            }}
          />
        )}
        <HistoryPanel entity="users" id={userId} />
      </div>

      <RoleDialog user={roleTarget} busy={setRole.isPending} error={setRole.isError ? (detailOf(setRole.error) ?? 'Não foi possível alterar o papel.') : null} onConfirm={(role) => setRole.mutate(role)} onClose={() => { setRoleTarget(null); setRole.reset() }} />
      <ExtendValidityDialog purchase={extending} busy={extend.isPending} error={extend.isError ? (detailOf(extend.error) ?? 'Não foi possível prolongar a validade.') : null} onSubmit={(body) => extending && extend.mutate({ id: extending.id, body })} onClose={() => { setExtending(null); extend.reset() }} />
      {granting && (
        <GrantHoursDialog open userLabel={user.name || user.email} packages={activePacks} busy={grant.isPending} error={grant.isError ? (detailOf(grant.error) ?? 'Não foi possível atribuir as horas.') : null} onSubmit={(body) => grant.mutate(body)} onClose={() => { setGranting(false); grant.reset() }} />
      )}

      <ReasonDialog
        open={!!adjusting}
        title={`Ajustar horas · ${adjusting?.package?.name ?? 'Pack'}`}
        description="Positivo acrescenta, negativo retira. O saldo nunca fica abaixo das horas já descontadas por reservas."
        confirmLabel="Ajustar"
        canConfirm={adjustHours.trim() !== '' && Number(adjustHours) !== 0 && Number.isFinite(Number(adjustHours))}
        onConfirm={async (reason) => { if (adjusting) { await adminApi.adjustPurchase(adjusting.id, { hours: Number(adjustHours), reason }, api); setAdjusting(null); await done('Horas ajustadas.') } }}
        onClose={() => setAdjusting(null)}
      >
        <div>
          <Label htmlFor="adjust-hours">Horas (±)</Label>
          <Input id="adjust-hours" type="number" step="0.5" value={adjustHours} onChange={(e) => setAdjustHours(e.target.value)} className="mt-1" placeholder="ex: 2 ou -1" />
        </div>
      </ReasonDialog>
      <ReasonDialog
        open={!!cancelling}
        title={`Cancelar o pack · ${cancelling?.package?.name ?? 'Pack'}`}
        description="As horas restantes passam a 0; nada é devolvido em dinheiro e as reservas já pagas com este pack ficam."
        confirmLabel="Cancelar pack"
        destructive
        onConfirm={async (reason) => { if (cancelling) { await adminApi.updatePurchase(cancelling.id, { status: 'cancelled', reason }, api); setCancelling(null); await done('Pack cancelado.') } }}
        onClose={() => setCancelling(null)}
      />
      <ReasonDialog
        open={anonOpen}
        title="Anonimizar esta conta"
        description={`${user.email} passa a utilizador-${short}@anon.invalid; a pessoa deixa de conseguir entrar. As reservas, packs e pedidos ficam.`}
        confirmLabel="Anonimizar"
        destructive
        onConfirm={async (reason) => {
          await adminApi.anonymiseUser(userId, { confirm: anonConfirm, reason }, api)
          setAnonOpen(false)
          toast({ title: 'Conta anonimizada.', variant: 'success' })
          await invalidate(userId)
        }}
        onClose={() => setAnonOpen(false)}
      />

      <Dialog open={pwOpen} onOpenChange={(o) => !o && !setPassword.isPending && setPwOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir password</DialogTitle>
            <DialogDescription>Pelo menos 8 caracteres. As sessões atuais da pessoa terminam.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (pw.password !== pw.confirm) { setPwError('As passwords não coincidem.'); return } if (pw.password.length < 8) { setPwError('Pelo menos 8 caracteres.'); return } setPassword.mutate() }}>
            <div><Label htmlFor="new-password">Nova password</Label><Input id="new-password" type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} className="mt-1" /></div>
            <div><Label htmlFor="confirm-password">Confirmar</Label><Input id="confirm-password" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} className="mt-1" /></div>
            {pwError && <p role="alert" className="text-sm text-red-600">{pwError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPwOpen(false)} disabled={setPassword.isPending}>Cancelar</Button>
              <Button type="submit" disabled={setPassword.isPending || !pw.password || !pw.confirm}>{setPassword.isPending ? 'A guardar…' : 'Definir password'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={membershipOpen} onOpenChange={(o) => !o && setMembershipOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover do espaço</DialogTitle>
            <DialogDescription>{user.name || user.email} deixa de ter acesso a este espaço. A conta e o histórico continuam a existir.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMembershipOpen(false)}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={() => removeMembership.mutate()} disabled={removeMembership.isPending}>Remover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
