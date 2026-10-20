'use client'
import { Suspense } from 'react'
import Link from 'next/link'
import { Building2, MapPin } from 'lucide-react'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { useT } from '@/lib/i18n'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { SpaceRoomsSkeleton, SpaceRoomsView } from '@/components/spaces/SpaceRoomsView'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Space } from '@/types'

function SpacesList({ spaces }: { spaces: Space[] }) {
  const t = useT()
  return (
    <main className="min-h-screen bg-background">
      <div className="bg-white border-b border-border py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-foreground">{t('spaces.list_title')}</h1>
          <p className="text-muted-foreground mt-2">{t('spaces.list_subtitle')}</p>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {spaces.map((space) => (
            <Card key={space.id} className="hover:shadow-md transition-shadow">
              <div className="h-48 bg-linear-to-br from-accent to-primary-light/40 rounded-t-xl flex items-center justify-center text-5xl">
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
                  <Button className="w-full">{t('spaces.list_cta')}</Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}

function Notice({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-24 text-center text-muted-foreground" data-testid={testId}>
        <Building2 className="h-10 w-10 mx-auto mb-3 text-primary-light" aria-hidden />
        {children}
      </div>
    </main>
  )
}

/**
 * While there is one space this page IS that space's rooms view, rendered in
 * place rather than redirected to `/spaces/<id>`: no redirect means no history
 * entry for the back button to bounce off, no skeleton-then-navigate hop on
 * every visit, and nothing to undo the day a second space appears — the list
 * below simply comes back. `/spaces/<id>` keeps working in both modes.
 */
export default function SpacesPage() {
  const { mode, space, spaces, retry } = useSingleSpace()
  const t = useT()

  return (
    <>
      <Navbar />
      {mode === 'loading' && <SpaceRoomsSkeleton />}
      {mode === 'single' && space && (
        <Suspense fallback={<SpaceRoomsSkeleton />}>
          <SpaceRoomsView spaceId={space.id} />
        </Suspense>
      )}
      {mode === 'multi' && <SpacesList spaces={spaces} />}
      {mode === 'empty' && (
        <Notice testId="spaces-empty">
          <p>{t('spaces.empty')}</p>
        </Notice>
      )}
      {mode === 'error' && (
        <Notice>
          <div role="alert" className="space-y-3">
            {/* B65: the same words as the landing page's room list, so one key. */}
            <p>{t('spaceCards.error')}</p>
            <Button variant="outline" onClick={retry}>{t('spaceCards.retry')}</Button>
          </div>
        </Notice>
      )}
      <Footer />
    </>
  )
}
