import { z } from 'zod'

/**
 * The location part of the admin space forms (new + edit), shared so both
 * validate the same way. Inputs are text: a number input would reject the
 * decimal comma Portuguese keyboards produce and the pair a maps app copies.
 *
 * The API is the authority (422 on range, and on half a point); this only
 * gets the operator the message before the round trip.
 */
export const locationFormShape = {
  postal_code: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{3})?$/, 'Código postal no formato 0000-000'),
  latitude: coordinate(90, 'Latitude entre -90 e 90'),
  longitude: coordinate(180, 'Longitude entre -180 e 180'),
}

export type LocationFormValues = { postal_code: string; latitude: string; longitude: string }

function toNumber(text: string): number {
  return Number(text.trim().replace(',', '.'))
}

function coordinate(limit: number, message: string) {
  return z
    .string()
    .trim()
    .refine((v) => v === '' || (/^-?\d+([.,]\d+)?$/.test(v) && Math.abs(toNumber(v)) <= limit), message)
}

/** Both or neither — flagged on whichever field was left empty. */
export function refineCoordinatePair(
  values: Pick<LocationFormValues, 'latitude' | 'longitude'>,
  ctx: z.RefinementCtx,
) {
  const message = 'Indica a latitude e a longitude, ou deixa as duas em branco'
  const hasLat = values.latitude.trim() !== ''
  const hasLng = values.longitude.trim() !== ''
  if (hasLat && !hasLng) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['longitude'], message })
  if (hasLng && !hasLat) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['latitude'], message })
}

/**
 * What goes to the API. The coordinates always travel together, and an empty
 * field is an explicit null: that is how a location is cleared, and the API
 * refuses one coordinate sent without the other.
 */
export function locationPayload(values: LocationFormValues) {
  const blank = (v: string) => v.trim() === ''
  return {
    postal_code: blank(values.postal_code) ? null : values.postal_code.trim(),
    latitude: blank(values.latitude) ? null : toNumber(values.latitude),
    longitude: blank(values.longitude) ? null : toNumber(values.longitude),
  }
}

export function locationDefaults(space?: {
  postal_code?: string | null
  latitude?: number | null
  longitude?: number | null
}): LocationFormValues {
  return {
    postal_code: space?.postal_code ?? '',
    latitude: space?.latitude != null ? String(space.latitude) : '',
    longitude: space?.longitude != null ? String(space.longitude) : '',
  }
}
