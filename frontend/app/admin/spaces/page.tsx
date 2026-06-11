'use client'
import { useSession } from 'next-auth/react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Plus, MapPin, Edit, Trash2 } from 'lucide-react'
import { adminApi } from '@/lib/api'
import { useApi } from '@/lib/hooks/useApi'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

export default function AdminSpacesPage() {
  const { data: session } = useSession()
  const api = useApi()
  const qc = useQueryClient()

  const { data: spaces, isLoading } = useQuery({
    queryKey: ['admin', 'spaces'],
    queryFn: () => adminApi.getSpaces(api),
    enabled: !!session?.accessToken,
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.updateSpace(id, { is_active: false }, api),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'spaces'] }),
  })

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
                  <Link href={`/admin/rooms/${space.id}`}><Button variant="outline" size="sm"><Edit className="h-4 w-4 mr-1" /> Salas</Button></Link>
                  <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteMutation.mutate(space.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
