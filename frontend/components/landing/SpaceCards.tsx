'use client'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { spacesApi } from '@/lib/api'
import { useSingleSpace } from '@/lib/hooks/useSingleSpace'
import { RoomCard } from '@/components/spaces/RoomCard'
import { SpaceLocation } from '@/components/spaces/SpaceLocation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n'
import type { Space } from '@/types'

// Enough for a landing page; a space with more rooms links to the full view.
const ROOM_PREVIEW = 6

function CardSkeletons() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} data-testid="card-skeleton">
          <CardHeader>
            <Skeleton className="h-6 w-3/4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="text-center mb-10">
      <h2 className="text-3xl font-bold text-foreground mb-3">{title}</h2>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}

/** One space: go straight to its rooms, and still say where it is. */
function SingleSpaceRooms({ space }: { space: Space }) {
  const t = useT()
  // Same key as the space page, so following a card finds the rooms cached.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['space', space.id],
    queryFn: () => spacesApi.get(space.id),
  })
  const rooms = (data?.rooms ?? []).filter((r) => r.is_active)

  return (
    <>
      <SectionHeading title={t('spaceCards.rooms_title')} description={t('spaceCards.section_description')} />
      {isPending ? (
        <CardSkeletons />
      ) : isError ? (
        <div role="alert" className="text-center py-12 text-muted-foreground space-y-3">
          <p>{t('spaceCards.error')}</p>
          <Button variant="outline" onClick={() => { void refetch() }}>{t('spaceCards.retry')}</Button>
        </div>
      ) : rooms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="rooms-empty">
          <Building2 className="h-10 w-10 mx-auto mb-3 text-primary-light" aria-hidden />
          <p>{t('spaceCards.rooms_empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rooms.slice(0, ROOM_PREVIEW).map((room) => (
            <RoomCard key={room.id} room={room} href={`/spaces/${space.id}?room=${room.id}`} />
          ))}
        </div>
      )}
      {rooms.length > ROOM_PREVIEW && (
        <div className="text-center mt-8">
          <Link href="/spaces">
            <Button variant="outline">{t('spaceCards.rooms_cta_all')}</Button>
          </Link>
        </div>
      )}
      <section aria-labelledby="onde-estamos" id="onde-estamos-seccao" className="mt-12 mx-auto max-w-3xl rounded-xl border border-border bg-white p-6 scroll-mt-20">
        <h3 id="onde-estamos" className="text-xl font-semibold text-foreground">{t('location.heading')}</h3>
        <p className="mt-1 mb-4 text-sm font-medium text-foreground">{space.name}</p>
        <SpaceLocation space={space} variant="compact" />
      </section>
    </>
  )
}

function SpacesPreview({ spaces }: { spaces: Space[] }) {
  const t = useT()
  return (
    <>
      <SectionHeading title={t('spaceCards.section_title')} description={t('spaceCards.section_description')} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {spaces.slice(0, 3).map((space) => (
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
                <Button className="w-full" size="sm">{t('spaceCards.cta_detail')}</Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="text-center mt-8">
        <Link href="/spaces">
          <Button variant="outline">{t('spaceCards.cta_all')}</Button>
        </Link>
      </div>
    </>
  )
}

export function SpaceCards() {
  const t = useT()
  const { mode, space, spaces, retry } = useSingleSpace()

  return (
    <section id="salas" className="py-16 bg-background scroll-mt-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Until the mode is known not even the heading is drawn: it is the
            first thing that would have to change. */}
        {mode === 'loading' && (
          <>
            <div className="mb-10 flex flex-col items-center gap-3" aria-hidden>
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-4 w-80 max-w-full" />
            </div>
            <CardSkeletons />
          </>
        )}
        {mode === 'single' && space && <SingleSpaceRooms space={space} />}
        {mode === 'multi' && <SpacesPreview spaces={spaces} />}
        {mode === 'empty' && (
          <div className="text-center py-12 text-muted-foreground" data-testid="spaces-empty">
            <Building2 className="h-10 w-10 mx-auto mb-3 text-primary-light" aria-hidden />
            <p>{t('spaceCards.empty_state')}</p>
          </div>
        )}
        {mode === 'error' && (
          <div role="alert" className="text-center py-12 text-muted-foreground space-y-3">
            <p>{t('spaceCards.error')}</p>
            <Button variant="outline" onClick={retry}>{t('spaceCards.retry')}</Button>
          </div>
        )}
      </div>
    </section>
  )
}
