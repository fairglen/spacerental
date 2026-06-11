'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { spacesApi } from '@/lib/api'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export default function SpacesPage() {
  const { data: spaces, isLoading } = useQuery({
    queryKey: ['spaces'],
    queryFn: () => spacesApi.list(),
  })

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-background">
        <div className="bg-white border-b border-border py-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h1 className="text-3xl font-bold text-foreground">Todos os Espaços</h1>
            <p className="text-muted-foreground mt-2">Encontra a sala perfeita para a tua prática.</p>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-6">
                    <Skeleton className="h-48 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(spaces ?? []).map((space) => (
                <Card key={space.id} className="hover:shadow-md transition-shadow">
                  <div className="h-48 bg-gradient-to-br from-accent to-primary-light/40 rounded-t-xl flex items-center justify-center text-5xl">
                    🏢
                  </div>
                  <CardHeader className="pb-2">
                    <CardTitle>{space.name}</CardTitle>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> {space.city}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{space.description}</p>
                    <div className="flex flex-wrap gap-1 mb-4">
                      {space.amenities.slice(0, 4).map((a) => (
                        <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                      ))}
                    </div>
                    <Link href={`/spaces/${space.id}`}>
                      <Button className="w-full">Ver Salas e Reservar</Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
