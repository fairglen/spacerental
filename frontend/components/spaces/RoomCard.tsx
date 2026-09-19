'use client'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { Room } from '@/types'

type RoomCardProps = {
  room: Room
  /** This room's calendar is the one currently shown below (B27). */
  selected?: boolean
} & (
  // On the booking page the card selects the room in place…
  | { onBook: (room: Room) => void; href?: undefined }
  // …on the landing page it is a link to that page with the room preselected (C11).
  | { href: string; onBook?: undefined }
)

export function RoomCard({ room, onBook, href, selected = false }: RoomCardProps) {
  // Catalog strings because the card now also appears on the landing page,
  // which has the locale switcher; the Portuguese wording is unchanged.
  const t = useT()
  return (
    <Card data-testid="room-card" className={cn('hover:shadow-md transition-shadow', selected && 'ring-2 ring-primary border-primary')}>
      <div
        className="h-32 rounded-t-xl flex items-center justify-center text-3xl"
        style={{ backgroundColor: room.color + '33' }}
      >
        🛋️
      </div>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">
            {room.name}
            {selected && <Badge className="ml-2 align-middle bg-primary text-primary-foreground">{t('roomCard.selected')}</Badge>}
          </CardTitle>
          <span className="text-lg font-bold text-primary">{formatCurrency(room.hourly_rate)}<span className="text-xs font-normal text-muted-foreground">/h</span></span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" /> {t(room.capacity > 1 ? 'roomCard.capacity_many' : 'roomCard.capacity_one', { count: room.capacity })}
        </div>
      </CardHeader>
      <CardContent>
        {room.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{room.description}</p>}
        <div className="flex flex-wrap gap-1 mb-4">
          {room.amenities.slice(0, 3).map((a) => (
            <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
          ))}
        </div>
        {href ? (
          <Button asChild className="w-full">
            <Link href={href}>{t('roomCard.cta')}</Link>
          </Button>
        ) : (
          <Button className="w-full" onClick={() => onBook?.(room)} aria-pressed={selected} variant={selected ? 'secondary' : 'default'}>
            {t('roomCard.cta')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
