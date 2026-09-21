import { describe, it, expect } from 'vitest'
import { addressLines, hasCoordinates, directionsUrl, mapEmbedUrl, mapLinkUrl, parseCoordinatePair } from '@/lib/location'

const queluz = {
  address: 'R. 12 de Julho de 1997 5, Loja 1',
  postal_code: '2745-841',
  city: 'Queluz',
  latitude: 38.755723,
  longitude: -9.279799,
}

describe('addressLines', () => {
  it('is street, then "postcode city"', () => {
    expect(addressLines(queluz)).toEqual(['R. 12 de Julho de 1997 5, Loja 1', '2745-841 Queluz'])
  })

  it.each([
    [{ address: 'Rua A', postal_code: null, city: 'Porto' }, ['Rua A', 'Porto']],
    [{ address: 'Rua A', postal_code: '4000-001', city: null }, ['Rua A', '4000-001']],
    [{ address: null, postal_code: null, city: 'Porto' }, ['Porto']],
    [{ address: '  ', postal_code: '', city: undefined }, []],
    [{}, []],
  ])('builds only from the parts that exist: %j', (space, expected) => {
    expect(addressLines(space)).toEqual(expected)
    expect(addressLines(space).join(' ')).not.toMatch(/null|undefined|,\s*$|^\s*,/)
  })
})

describe('hasCoordinates', () => {
  it('needs both', () => {
    expect(hasCoordinates(queluz)).toBe(true)
    expect(hasCoordinates({ latitude: 38.7, longitude: null })).toBe(false)
    expect(hasCoordinates({})).toBe(false)
  })

  it('accepts the equator and the prime meridian', () => {
    expect(hasCoordinates({ latitude: 0, longitude: 0 })).toBe(true)
  })
})

describe('directionsUrl', () => {
  it('routes to the coordinates when they exist', () => {
    expect(directionsUrl(queluz)).toBe('https://www.google.com/maps/dir/?api=1&destination=38.755723,-9.279799')
  })

  it('falls back to a search built from the address', () => {
    const url = directionsUrl({ ...queluz, latitude: null, longitude: null })
    expect(url).not.toBeNull()
    const parsed = new URL(url!)
    expect(parsed.origin + parsed.pathname).toBe('https://www.google.com/maps/search/')
    expect(parsed.searchParams.get('api')).toBe('1')
    expect(parsed.searchParams.get('query')).toBe('R. 12 de Julho de 1997 5, Loja 1, 2745-841 Queluz')
  })

  it('is null when there is nothing to find', () => {
    expect(directionsUrl({})).toBeNull()
  })
})

describe('map URLs', () => {
  it('embeds OpenStreetMap centred on the point, with a marker', () => {
    const url = new URL(mapEmbedUrl(38.755723, -9.279799))
    expect(url.origin + url.pathname).toBe('https://www.openstreetmap.org/export/embed.html')
    expect(url.searchParams.get('marker')).toBe('38.755723,-9.279799')
    const [west, south, east, north] = url.searchParams.get('bbox')!.split(',').map(Number)
    expect((west + east) / 2).toBeCloseTo(-9.279799, 6)
    expect((south + north) / 2).toBeCloseTo(38.755723, 6)
    expect(west).toBeLessThan(east)
    expect(south).toBeLessThan(north)
  })

  it('keeps the box on the globe at the edges', () => {
    const [west, south, east, north] = new URL(mapEmbedUrl(90, 180)).searchParams.get('bbox')!.split(',').map(Number)
    expect(north).toBeLessThanOrEqual(90)
    expect(east).toBeLessThanOrEqual(180)
    expect(west).toBeLessThan(east)
    expect(south).toBeLessThan(north)
  })

  it('links to the full map at the same point', () => {
    expect(mapLinkUrl(38.755723, -9.279799)).toBe(
      'https://www.openstreetmap.org/?mlat=38.755723&mlon=-9.279799#map=17/38.755723/-9.279799',
    )
  })
})

describe('parseCoordinatePair', () => {
  it.each([
    ['38.755723, -9.279799', ['38.755723', '-9.279799']],
    ['38.755723,-9.279799', ['38.755723', '-9.279799']],
    ['  38.75572   -9.27980 ', ['38.75572', '-9.27980']],
    ['(38.755723, -9.279799)', ['38.755723', '-9.279799']],
  ])('splits what a maps app copies: %s', (text, expected) => {
    expect(parseCoordinatePair(text)).toEqual(expected)
  })

  it.each(['38.755723', 'Queluz', '38,755723', '1, 2, 3', ''])('leaves anything else alone: %s', (text) => {
    expect(parseCoordinatePair(text)).toBeNull()
  })
})
