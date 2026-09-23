'use client'
import { useRef, useState, type ElementType } from 'react'
import { Clock, Mail, MapPin, Navigation, Map as MapIcon, Phone } from 'lucide-react'
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
 * "Onde estamos" (V06): where the space is, how to get there, how to reach
 * it and when it is open — one block, used on the landing page (single-space
 * mode) and at the top of the rooms page. Two columns from `md`: the words on
 * the left, the map on the right.
 *
 * The map is a third-party embed, so it is never loaded on render: the
 * placeholder shows the address and a "Ver mapa" button at the map's own
 * size, and the iframe mounts only when asked for. No request leaves for
 * OpenStreetMap without that intent.
 */
export function WhereWeAre({ space, rooms = [], headingAs: Heading = 'h2', className }: WhereWeAreProps) {
  const t = useT()
  const [mapShown, setMapShown] = useState(false)
  const frame = useRef<HTMLDivElement>(null)
  // Measured when the map is asked for, so the box has the frame's shape.
  const [aspect, setAspect] = useState(DEFAULT_MAP_ASPECT)

  const lines = addressLines(space)
  const directions = directionsUrl(space)
  if (lines.length === 0 && !directions) return null

  const name = space.name?.trim()
  const hours = describeOpeningHours(rooms)
  const withMap = hasCoordinates(space)

  const showMap = () => {
    const el = frame.current
    if (el && el.clientWidth > 0 && el.clientHeight > 0) setAspect(el.clientWidth / el.clientHeight)
    setMapShown(true)
  }

  return (
    <section
      aria-labelledby="onde-estamos"
      id="onde-estamos-seccao"
      data-testid="where-we-are"
      className={cn('grid gap-6 rounded-xl border border-border bg-white p-6 md:grid-cols-5 scroll-mt-20', className)}
    >
      <div className="md:col-span-2 text-sm">
        <Heading id="onde-estamos" className="text-xl font-semibold text-foreground">{t('location.heading')}</Heading>
        {name && <p className="mt-1 font-medium text-foreground">{name}</p>}
        <div role="group" aria-label={t('location.address_label')} className="mt-2 flex items-start gap-2 text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <address className="not-italic">
            {lines.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </address>
        </div>
        {directions && (
          <Button asChild size="sm" className="mt-3 gap-2">
            <a href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-4 w-4" aria-hidden /> {t('location.directions')}
            </a>
          </Button>
        )}

        <hr className="my-4 border-border" />

        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('location.contact')}</h3>
        <ul className="mt-1 space-y-1">
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <a href={contactMailto()} className="text-foreground underline underline-offset-2 hover:text-primary">{CONTACT_EMAIL}</a>
          </li>
          {/* Optional and empty by default: no phone line until there is a number (CONTACT_PHONE). */}
          {CONTACT_PHONE && (
            <li className="flex items-center gap-2">
              <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} className="text-foreground underline underline-offset-2 hover:text-primary">{CONTACT_PHONE}</a>
            </li>
          )}
        </ul>

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('location.hours')}</h3>
        <ul data-testid="opening-hours" className="mt-1 space-y-0.5 text-foreground">
          {hours.lines.map((line) => (
            <li key={line} className="flex items-center gap-2">
              <Clock className="h-4 w-4 shrink-0 text-primary" aria-hidden /> {line}
            </li>
          ))}
        </ul>
        {hours.differsByRoom && (
          <p className="mt-1 text-xs text-muted-foreground">{t('location.hours_per_room')}</p>
        )}
      </div>

      {withMap && (
        <div className="md:col-span-3">
          <div ref={frame} data-testid="map-frame" className="flex h-full min-h-[280px] overflow-hidden rounded-xl border border-border bg-accent/40">
            {mapShown ? (
              <iframe
                title={name ? t('location.map_title', { name }) : t('location.map_title_generic')}
                src={mapEmbedUrl(space.latitude, space.longitude, aspect)}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="w-full flex-1 border-0"
              />
            ) : (
              // The address and the button at the map's size: nothing jumps when it loads.
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
                <MapIcon className="h-6 w-6 text-primary" aria-hidden />
                <p className="text-sm text-muted-foreground">{lines.join(' · ')}</p>
                <Button type="button" variant="outline" size="sm" onClick={showMap}>
                  {t('location.show_map')}
                </Button>
              </div>
            )}
          </div>
          {/* One line below the map either way, so the frame keeps its height. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {mapShown ? (
              <a
                href={mapLinkUrl(space.latitude, space.longitude)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                {t('location.open_full_map')}
              </a>
            ) : (
              t('location.map_privacy')
            )}
          </p>
        </div>
      )}
    </section>
  )
}
