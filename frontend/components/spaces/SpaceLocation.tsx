'use client'
import { useState } from 'react'
import { MapPin, Navigation, Map as MapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  addressLines, directionsUrl, hasCoordinates, mapEmbedUrl, mapLinkUrl, type SpaceLocationData,
} from '@/lib/location'

interface SpaceLocationProps {
  space: SpaceLocationData & { name?: string | null }
  /** 'compact' is the same content in a tighter box, for page headers and the landing section. */
  variant?: 'full' | 'compact'
  className?: string
}

/**
 * Where a space is: address, a directions link, and an optional map.
 *
 * The map is a third-party embed, so it is never loaded on render: the
 * customer sees a placeholder and the iframe mounts only when they ask for it.
 * No request leaves for OpenStreetMap without that intent, and the page stays
 * fast for everyone who only wanted the address.
 */
export function SpaceLocation({ space, variant = 'full', className }: SpaceLocationProps) {
  const t = useT()
  const [mapShown, setMapShown] = useState(false)

  const lines = addressLines(space)
  const directions = directionsUrl(space)
  if (lines.length === 0 && !directions) return null

  const compact = variant === 'compact'
  const name = space.name?.trim()

  return (
    <div className={cn('text-sm', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div role="group" aria-label={t('location.address_label')} className="flex items-start gap-2 text-muted-foreground">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-primary" aria-hidden />
          <address className="not-italic">
            {lines.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </address>
        </div>
        {directions && (
          <Button asChild size="sm" className="gap-2">
            <a href={directions} target="_blank" rel="noopener noreferrer">
              <Navigation className="h-4 w-4" aria-hidden /> {t('location.directions')}
            </a>
          </Button>
        )}
      </div>

      {hasCoordinates(space) && (
        <div className={cn('mt-3 overflow-hidden rounded-xl border border-border bg-accent/40', compact ? 'h-48' : 'h-64')}>
          {mapShown ? (
            <iframe
              title={name ? t('location.map_title', { name }) : t('location.map_title_generic')}
              src={mapEmbedUrl(space.latitude, space.longitude)}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
              <MapIcon className="h-6 w-6 text-primary" aria-hidden />
              <Button type="button" variant="outline" size="sm" onClick={() => setMapShown(true)}>
                {t('location.show_map')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('location.map_privacy')}</p>
            </div>
          )}
        </div>
      )}
      {hasCoordinates(space) && mapShown && (
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
      )}
    </div>
  )
}
