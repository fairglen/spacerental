/**
 * The parts of a space that say where it is. Everything is optional and
 * nullable, because that is what the API sends: every one of these columns is
 * nullable, an operator may have typed only a city, and older rows have no
 * coordinates. A `Space` is assignable to this.
 */
export type SpaceLocationData = {
  address?: string | null
  postal_code?: string | null
  city?: string | null
  latitude?: number | null
  longitude?: number | null
}

const clean = (value: string | null | undefined) => (value ?? '').trim()

/** Street, then "postcode city" — built only from the parts that exist. */
export function addressLines(space: SpaceLocationData): string[] {
  const locality = [clean(space.postal_code), clean(space.city)].filter(Boolean).join(' ')
  return [clean(space.address), locality].filter(Boolean)
}

/** Both or nothing: half a point is not a place (the API enforces the same). */
export function hasCoordinates(
  space: SpaceLocationData,
): space is SpaceLocationData & { latitude: number; longitude: number } {
  return typeof space.latitude === 'number' && typeof space.longitude === 'number'
}

/**
 * Where "Como chegar" goes. Google's universal maps URL, because on a phone it
 * hands off to the installed maps app, which is what someone on their way
 * actually wants. Without coordinates it degrades to a search for the address.
 */
export function directionsUrl(space: SpaceLocationData): string | null {
  if (hasCoordinates(space)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${space.latitude},${space.longitude}`
  }
  const query = addressLines(space).join(', ')
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null
}

// Half-widths of the embedded map's box, in degrees: a few streets around the
// door. Longitude is wider because the preview is landscape.
const HALF_HEIGHT = 0.0025
const HALF_WIDTH = 0.005

/** OpenStreetMap's keyless embed, centred on the point, with a marker. */
export function mapEmbedUrl(latitude: number, longitude: number): string {
  // Shift the box instead of clipping it, so the point stays inside it and the
  // box keeps a real area even at a pole or the antimeridian.
  const centreLat = Math.min(90 - HALF_HEIGHT, Math.max(-90 + HALF_HEIGHT, latitude))
  const centreLng = Math.min(180 - HALF_WIDTH, Math.max(-180 + HALF_WIDTH, longitude))
  const box = [centreLng - HALF_WIDTH, centreLat - HALF_HEIGHT, centreLng + HALF_WIDTH, centreLat + HALF_HEIGHT]
    .map((n) => n.toFixed(6))
    .join(',')
  const params = new URLSearchParams({ bbox: box, layer: 'mapnik', marker: `${latitude},${longitude}` })
  return `https://www.openstreetmap.org/export/embed.html?${params}`
}

export function mapLinkUrl(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`
}

/**
 * "38.755723, -9.279799" — what a maps app puts on the clipboard — as its two
 * halves, so an operator can paste the pair into one field.
 *
 * A bare comma is also the Portuguese decimal separator, so "38,755723" is one
 * number, not a pair: without a space after the comma both halves must carry
 * their own decimal point. Anything else is left alone.
 */
export function parseCoordinatePair(text: string): [string, string] | null {
  const number = String.raw`-?\d+(?:\.\d+)?`
  const match = text.trim().match(new RegExp(String.raw`^\(?\s*(${number})(,\s+|\s+|,)(${number})\s*\)?$`))
  if (!match) return null
  const [, first, separator, second] = match
  if (separator === ',' && !(first.includes('.') && second.includes('.'))) return null
  return [first, second]
}
