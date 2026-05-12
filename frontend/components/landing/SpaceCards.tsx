'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { spacesApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function SpaceCards() {
  const { data: spaces, isLoading } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => spacesApi.list(),
  })

  const preview = (spaces ?? []).slice(0, 3)

  return (
    <section className="py-16 bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <h2 className="text-3xl font-bold text-foreground mb-3">Espaços Disponíveis</h2>
          <p className="text-muted-foreground">Salas preparadas para a tua prática profissional.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-6 w-3/4" />
                  </CardHeader>
                  <CardContent>
                    <Skeleton className="h-32 w-full" />
                  </CardContent>
                </Card>
              ))
            : preview.map((space) => (
                <Card key={space.id} className="hover:shadow-md transition-shadow">
                  <div className="h-40 bg-gradient-to-br from-accent to-primary-light/40 rounded-t-xl flex items-center justify-center">
                    <span className="text-4xl">🏢</span>
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{space.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{space.city}</p>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{space.description}</p>
                    <div className="flex flex-wrap gap-1 mb-4">
                      {space.amenities.slice(0, 3).map((a) => (
                        <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                    <Link href={`/spaces/${space.id}`}>
                      <Button className="w-full" size="sm">Ver Disponibilidade</Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
        </div>
        {!isLoading && preview.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Building2 className="h-10 w-10 mx-auto mb-3 text-primary-light" />
            <p>Ainda não há espaços disponíveis.</p>
          </div>
        )}
        <div className="text-center mt-8">
          <Link href="/spaces">
            <Button variant="outline">Ver Todos os Espaços</Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
