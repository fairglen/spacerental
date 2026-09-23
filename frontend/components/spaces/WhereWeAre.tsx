'use client'
import { useLayoutEffect, useRef, useState, type ElementType } from 'react'
import { Clock, Mail, MapPin, Navigation, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { CONTACT_EMAIL, CONTACT_PHONE, contactMailto } from '@/lib/contact'
import { describeOpeningHours } from '@/lib/openingHours'
import {
  addressLines, directionsUrl, hasCoordinates, mapEmbedUrl, mapLinkUrl, DEFAULT_MAP_ASPECT, type SpaceLocationData,
} from '@/lib/location'
import type { OpeningWindow } from '@/types'

interface WhereWeAreProps {
  space: SpaceLocationData & { name?: string | null }
  /** The space's rooms, for the hours: the union of their opening windows. */
  rooms?: { availability_rules?: OpeningWindow[] | null }[]
  /** The heading's element: h2 on the landing page, h2 below the page's h1. */
  headingAs?: ElementType
  className?: string
}

/**
 * "Onde estamos" (V06, reworked in L04): when the space is open, how to
 * reach it and where it is — one block, used on the landing page
 * (single-space mode) and at the top of the rooms page. Two columns from
 * `md`: the words on the left, one line each with its icon (hours, email,
 * address, then the directions button); the map on the right, loaded on
 * render as a lazy, referrer-free OpenStreetMap embed — the privacy page
 * says openstreetmap.org receives that request.
 */
export function WhereWeAre({ space, rooms = [], headingAs: Heading = 'h2', className }: WhereWeAreProps) {
  const t = useT()
  const frame = useRef<HTMLDivElement>(null)
  // The map's bounding box takes the frame's shape so the pin sits in the
  // middle. The frame is measured once it is laid out; until then (and on the
  // server) the box has the default shape, which is close on every layout.
  const [aspect, setAspect] = useState(DEFAULT_MAP_ASPECT)
  useLayoutEffect(() => {
    const el = frame.current
    if (el && el.clientWidth > 0 && el.clientHeight > 0) setAspect(el.clientWidth / el.clientHeight)
  }, [])

  const lines = addressLines(space)
  const directions = directionsUrl(space)
  if (lines.length === 0 && !directions) return null

  const name = space.name?.trim()
  const hours = describeOpeningHours(rooms)
  const withMap = hasCoordinates(space)
  const lineClass = 'flex items-start gap-2 text-foreground'
  const iconClass = 'mt-0.5 h-4 w-4 shrink-0 text-primary'

  return (
    <section
      aria-labelledby="onde-estamos"
      id="onde-estamos-seccao"
      data-testid="where-we-are"
      className={cn('grid gap-6 rounded-xl border border-border bg-white p-6 md:grid-cols-5 scroll-mt-20', className)}
    >
      <div className="min-w-0 md:col-span-2 text-sm">
        <Heading id="onde-estamos" className="text-xl font-semibold text-foreground">{t('location.heading')}</Heading>
        {name && <p className="mt-1 font-medium text-foreground">{name}</p>}

        <ul data-testid="where-lines" className="mt-3 space-y-2">
          {/* 1. When it is open (R01: the rules as the wall clock they are). */}
          <li className={lineClass}>
            <Clock className={iconClass} aria-hidden />
            <div>
              <ul data-testid="opening-hours" className="space-y-0.5">
                {hours.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {hours.differsByRoom && (
                <p className="text-xs text-muted-foreground">{t('location.hours_per_room')}</p>
              )}
            </div>
          </li>
          {/* 2. How to reach it — one address (C09); no phone line until there is a number. */}
          <li className={lineClass}>
            <Mail className={iconClass} aria-hidden />
            <a href={contactMailto()} className="underline underline-offset-2 hover:text-primary">{CONTACT_EMAIL}</a>
          </li>
          {CONTACT_PHONE && (
            <li className={lineClass}>
              <Phone className={iconClass} aria-hidden />
              <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} className="underline underline-offset-2 hover:text-primary">{CONTACT_PHONE}</a>
            </li>
          )}
          {/* 3. Where it is, on two lines, with the directions right under it. */}
          <li className={lineClass}>
            <MapPin className={iconClass} aria-hidden />
            <address role="group" aria-label={t('location.address_label')} className="not-italic">
              {lines.map((line) => (
                <span key={line} className="block">{line}</span>
              ))}
            </address>
          </li>
        </ul>
        {directions && (
          <Button asChild size="sm" className="mt-3 gap-2">
            <a href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-4 w-4" aria-hidden /> {t('location.directions')}
            </a>
          </Button>
        )}
      </div>

      {withMap && (
        // min-w-0: the frame's 16:10 floor would otherwise set the grid
        // column's minimum width and push the page sideways on a phone.
        <div className="min-w-0 md:col-span-3">
          <div
            ref={frame}
            data-testid="map-frame"
            className="flex w-full aspect-[16/10] min-h-[240px] overflow-hidden rounded-xl border border-border bg-accent/40 md:aspect-auto md:h-full md:min-h-[280px]"
          >
            <iframe
              title={name ? t('location.map_title', { name }) : t('location.map_title_generic')}
              src={mapEmbedUrl(space.latitude, space.longitude, aspect)}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full flex-1 border-0"
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <a
              href={mapLinkUrl(space.latitude, space.longitude)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {t('location.open_full_map')}
            </a>
          </p>
        </div>
      )}
    </section>
  )
}
