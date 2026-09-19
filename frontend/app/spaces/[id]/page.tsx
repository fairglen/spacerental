'use client'
import { Suspense } from 'react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { SpaceRoomsSkeleton, SpaceRoomsView } from '@/components/spaces/SpaceRoomsView'

export default function SpacePage({ params }: { params: { id: string } }) {
  return (
    <>
      <Navbar />
      {/* SpaceRoomsView reads ?room= with useSearchParams, which needs a boundary. */}
      <Suspense fallback={<SpaceRoomsSkeleton />}>
        <SpaceRoomsView spaceId={params.id} />
      </Suspense>
      <Footer />
    </>
  )
}
