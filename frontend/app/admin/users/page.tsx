'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { pt } from 'date-fns/locale'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { useOrg } from '@/contexts/OrgContext'
import { ROLE_LABELS } from '@/components/admin/users/RoleDialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_SIZE = 20

/** The org's members, searchable by name or email (A05). */
export default function AdminUsersPage() {
  const { currentOrgId } = useOrg()
  return <OrgUsers key={currentOrgId} currentOrgId={currentOrgId} />
}

function OrgUsers({ currentOrgId }: { currentOrgId: string | null }) {
  const { data: session } = useSession()
  const api = useApi()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'users', currentOrgId, q, page],
    queryFn: () => adminApi.getUsers({ page, page_size: PAGE_SIZE, ...(q ? { q } : {}) }, api),
    enabled: !!session?.accessToken && !!currentOrgId,
  })
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Utilizadores</h1>
          <p className="text-muted-foreground text-sm">Quem tem conta neste espaço: clientes e equipa. Abra um para ver reservas, packs e pedidos de ajuda.</p>
        </div>
        <div>
          <Label htmlFor="users-search">Procurar</Label>
          <Input id="users-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} placeholder="Nome ou email" className="mt-1 w-64" autoComplete="off" />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : isError ? (
        <p role="alert" className="text-sm text-red-600">Não foi possível carregar os utilizadores. Tente novamente.</p>
      ) : (data?.users.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{q ? 'Ninguém com esse nome ou email.' : 'Ainda não há utilizadores.'}</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-background border-b border-border">
                  <tr>
                    {['Nome', 'Email', 'Papel', 'Reservas', 'Desde', ''].map((h, i) => (
                      <th key={i} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data!.users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-4 py-3 text-foreground font-medium">{u.name || '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                      <td className="px-4 py-3"><Badge variant={u.role === 'member' ? 'secondary' : 'default'}>{ROLE_LABELS[u.role]}</Badge></td>
                      <td className="px-4 py-3 text-foreground">{u.bookings_count}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{format(parseISO(u.joined_at), 'd MMM yyyy', { locale: pt })}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button asChild size="sm" variant="outline"><Link href={`/admin/users/${u.id}`} aria-label={`Ver ${u.email}`}>Ver</Link></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
                <span className="text-muted-foreground">Página {page} de {totalPages} · {total} utilizadores</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button>
                  <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Seguinte</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
