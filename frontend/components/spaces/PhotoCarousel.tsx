'use client'
import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types'

interface PhotoCarouselProps {
  photos: Photo[]
  /** What the photos are of — "Sala Calma". Used in every accessible name. */
  label: string
  /** What is shown today when there are no photos. */
  placeholder: ReactNode
  /** 'card' loads thumbnails; 'page' loads the full images. */
  size?: 'card' | 'page'
  className?: string
}

// Up to this many photos get a dot each; more would be a row of specks, so
// they get a "2 / 8" counter instead.
const MAX_DOTS = 5
// Pointer travel, in px, after which a press was a swipe and not a tap.
const SWIPE_THRESHOLD = 10

/**
 * Room and space photos (C16). Native scroll-snap does the swiping, so touch
 * works with no gesture code and no dependency; the buttons, arrow keys and
 * dots are the pointer and keyboard paths to the same scroll position.
 *
 * It never moves by itself: no autoplay, and the live region only speaks after
 * the visitor moved it — a carousel that talks unprompted is noise.
 */
export function PhotoCarousel({ photos, label, placeholder, size = 'card', className }: PhotoCarouselProps) {
  const track = useRef<HTMLDivElement>(null)
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const [index, setIndex] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const count = photos.length
  const position = (i: number) => `Fotografia ${i + 1} de ${count}`

  const goTo = useCallback((next: number) => {
    const target = Math.min(count - 1, Math.max(0, next))
    setIndex(target)
    setAnnouncement(`Fotografia ${target + 1} de ${count}`)
    const el = track.current
    if (!el || typeof el.scrollTo !== 'function') return
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollTo({ left: target * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
  }, [count])

  if (count === 0) return <>{placeholder}</>

  // Inside a clickable card these must never count as a click on the card.
  const act = (event: MouseEvent, to: number) => {
    event.preventDefault()
    event.stopPropagation()
    goTo(to)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    goTo(index + (event.key === 'ArrowRight' ? 1 : -1))
  }

  // A swipe ends in a `click` on whatever is under the finger; the browser does
  // not know the difference, so measure the travel and swallow that click.
  const onPointerDown = (event: PointerEvent) => {
    pressedAt.current = { x: event.clientX, y: event.clientY }
    swiped.current = false
  }
  const onPointerMove = (event: PointerEvent) => {
    const from = pressedAt.current
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SWIPE_THRESHOLD) swiped.current = true
  }
  const onPointerUp = () => { pressedAt.current = null }
  const onClickCapture = (event: MouseEvent) => {
    if (!swiped.current) return
    swiped.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  // Swiping moves the scroll position without telling React; follow it so the
  // dots and buttons stay true. Deliberately silent: only manual moves speak.
  const onScroll = () => {
    const el = track.current
    if (!el || el.clientWidth === 0) return
    const seen = Math.round(el.scrollLeft / el.clientWidth)
    if (seen !== index) setIndex(Math.min(count - 1, Math.max(0, seen)))
  }

  const multiple = count > 1
  const control = cn(
    // 44px hit area; visible on hover, and always while anything inside the
    // frame — or the frame itself — has keyboard focus.
    'absolute top-1/2 -translate-y-1/2 z-10 flex h-11 w-11 items-center justify-center rounded-full',
    'bg-white/90 text-foreground shadow transition-opacity',
    'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:hidden',
  )

  return (
    <div
      role="region"
      aria-roledescription="carrossel"
      aria-label={`${label} — fotografias`}
      tabIndex={multiple ? 0 : undefined}
      onKeyDown={multiple ? onKeyDown : undefined}
      className={cn(
        'group relative aspect-[4/3] w-full overflow-hidden bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
        className,
      )}
    >
      <div
        ref={track}
        data-testid="photo-track"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={onClickCapture}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((photo, i) => (
          <div
            key={photo.id}
            id={`${photo.id}-slide`}
            role="group"
            aria-roledescription="diapositivo"
            aria-label={position(i)}
            className="h-full w-full shrink-0 snap-center"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- operator photos on the API's origin; width/height reserve the space, so nothing shifts */}
            <img
              src={size === 'page' ? photo.url : photo.thumb_url}
              alt={`${label} — fotografia ${i + 1}`}
              width={photo.width ?? 1600}
              height={photo.height ?? 1200}
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover"
            />
          </div>
        ))}
      </div>

      {multiple && (
        <>
          <button type="button" aria-label="Fotografia anterior" disabled={index === 0}
            onClick={(e) => act(e, index - 1)} className={cn(control, 'left-2')}>
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Fotografia seguinte" disabled={index === count - 1}
            onClick={(e) => act(e, index + 1)} className={cn(control, 'right-2')}>
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>

          {count <= MAX_DOTS ? (
            // A dark pill behind the dots: white dots alone vanish on a light photo.
            <div role="tablist" aria-label="Escolher fotografia"
              className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 rounded-full bg-black/35 px-1">
              {photos.map((photo, i) => (
                <button
                  key={photo.id}
                  type="button"
                  role="tab"
                  aria-label={position(i)}
                  aria-selected={i === index}
                  aria-controls={`${photo.id}-slide`}
                  tabIndex={i === index ? 0 : -1}
                  onClick={(e) => act(e, i)}
                  // The visible dot is small; the button around it is not.
                  className="group/dot flex h-6 w-5 items-center justify-center focus-visible:outline-none"
                >
                  <span className={cn(
                    'h-1.5 w-1.5 rounded-full bg-white/70 transition-all group-focus-visible/dot:ring-2 group-focus-visible/dot:ring-primary',
                    i === index && 'w-3 bg-white',
                  )} />
                </button>
              ))}
            </div>
          ) : (
            <span data-testid="photo-counter" aria-hidden="true"
              className="absolute bottom-2 right-2 z-10 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
              {index + 1} / {count}
            </span>
          )}
          <span data-testid="photo-announcer" aria-live="polite" className="sr-only">{announcement}</span>
        </>
      )}
    </div>
  )
}
