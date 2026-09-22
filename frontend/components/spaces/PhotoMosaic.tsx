'use client'
import { useState, type ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { LayoutGrid, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PhotoCarousel } from '@/components/spaces/PhotoCarousel'
import type { Photo } from '@/types'

interface PhotoMosaicProps {
  photos: Photo[]
  /** What the photos are of — "Sala Calma". Used in every accessible name. */
  label: string
  /** What is shown when there are no photos, at the mosaic's size. */
  placeholder: ReactNode
  className?: string
}

type Layout = 'hero' | 'halves' | 'big-2' | 'big-3' | 'big-4'

/** How many tiles the mosaic shows and how they sit, by how many photos there are. */
function layoutFor(count: number): Layout {
  if (count <= 1) return 'hero'
  if (count === 2) return 'halves'
  if (count === 3) return 'big-2'
  if (count === 4) return 'big-3'
  return 'big-4'
}

const TILES: Record<Layout, number> = { hero: 1, halves: 2, 'big-2': 3, 'big-3': 4, 'big-4': 5 }

// Where each tile sits in a 4-column × 2-row grid (the big one is the left
// half, both rows), per layout. Index 0 is always the big tile.
const CELLS: Record<Layout, string[]> = {
  hero: ['col-span-4 row-span-2'],
  halves: ['col-span-2 row-span-2', 'col-span-2 row-span-2'],
  'big-2': ['col-span-2 row-span-2', 'col-span-2 row-span-1', 'col-span-2 row-span-1'],
  'big-3': ['col-span-2 row-span-2', 'col-span-1 row-span-2', 'col-span-1 row-span-1', 'col-span-1 row-span-1'],
  'big-4': ['col-span-2 row-span-2', 'col-span-1 row-span-1', 'col-span-1 row-span-1', 'col-span-1 row-span-1', 'col-span-1 row-span-1'],
}

/**
 * The selected room's photos (V01): on wide screens an Airbnb-style mosaic —
 * the first photo big on the left, the others in a grid on the right, ~2:1
 * overall — and below `lg` the carousel at full width. Both are in the DOM
 * and CSS picks one, so the server render is right on every screen. Any
 * tile, and the "Mostrar todas as fotos" button, open the full-screen gallery.
 */
export function PhotoMosaic({ photos, label, placeholder, className }: PhotoMosaicProps) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(0)

  const count = photos.length
  if (count === 0) return <>{placeholder}</>

  const layout = layoutFor(count)
  const tiles = photos.slice(0, TILES[layout])
  const openAt = (index: number) => {
    setStart(index)
    setOpen(true)
  }

  return (
    <div role="region" aria-label={`${label} — fotografias`} className={cn('relative', className)}>
      {/* ≥1024px: the mosaic. */}
      <div
        data-testid="photo-mosaic"
        data-layout={layout}
        className="hidden lg:grid aspect-[2/1] w-full grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-xl bg-accent"
      >
        {tiles.map((photo, i) => (
          <div key={photo.id} data-tile={i === 0 ? 'big' : 'small'} className={cn('relative overflow-hidden', CELLS[layout][i])}>
            {/* eslint-disable-next-line @next/next/no-img-element -- operator photos on the API's origin; width/height reserve the space */}
            <img
              src={photo.url}
              alt={`${label} — fotografia ${i + 1} de ${count}`}
              width={photo.width ?? 1600}
              height={photo.height ?? 1200}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              onClick={() => openAt(i)}
              className="h-full w-full cursor-zoom-in object-cover"
            />
          </div>
        ))}
      </div>
      {count > 1 && (
        <button
          type="button"
          onClick={() => openAt(0)}
          className="absolute bottom-3 right-3 z-10 hidden lg:inline-flex items-center gap-2 rounded-lg border border-border bg-white/95 px-3 py-1.5 text-sm font-medium text-foreground shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden="true" /> Mostrar todas as fotos
        </button>
      )}

      {/* <1024px: the carousel, full width, a counter instead of dots. */}
      <div data-testid="photo-mosaic-carousel" className="lg:hidden overflow-hidden rounded-xl">
        <PhotoCarousel
          photos={photos}
          label={label}
          regionLabel={`${label} — carrossel de fotografias`}
          placeholder={null}
          size="page"
          indicator="counter"
          onPhotoClick={openAt}
        />
      </div>

      <PhotoGallery photos={photos} label={label} open={open} onOpenChange={setOpen} start={start} />
    </div>
  )
}

interface PhotoGalleryProps {
  photos: Photo[]
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  start: number
}

/**
 * Full-screen gallery: the carousel at `size="full"` with counter, arrows,
 * keyboard, Escape and a close button — Radix gives the focus trap and the
 * body scroll lock — and a thumbnail strip below on desktop.
 */
function PhotoGallery({ photos, label, open, onOpenChange, start }: PhotoGalleryProps) {
  const [index, setIndex] = useState(start)
  // Reopening on another tile: the carousel and the strip start there.
  const [seenStart, setSeenStart] = useState(start)
  if (seenStart !== start) {
    setSeenStart(start)
    setIndex(start)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95" />
        <DialogPrimitive.Content
          aria-label={`${label} — fotografias`}
          className="fixed inset-0 z-50 flex flex-col focus:outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{label} — fotografias</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Galeria de fotografias. Use as setas para mudar de fotografia e Escape para fechar.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
          <div className="min-h-0 flex-1 p-4 pt-16 md:p-8 md:pt-16">
            <PhotoCarousel
              photos={photos}
              label={label}
              placeholder={null}
              size="full"
              indicator="counter"
              initialIndex={index}
              onIndexChange={setIndex}
              className="h-full bg-transparent"
            />
          </div>
          <div role="tablist" aria-label="Miniaturas" className="hidden md:flex shrink-0 justify-center gap-2 overflow-x-auto px-4 pb-4">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                role="tab"
                aria-label={`Fotografia ${i + 1} de ${photos.length}`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                onClick={() => setIndex(i)}
                className={cn(
                  'h-16 w-[5.33rem] shrink-0 overflow-hidden rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails on the API's origin */}
                <img src={photo.thumb_url} alt="" width={photo.width ?? 1600} height={photo.height ?? 1200} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
