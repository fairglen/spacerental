import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spacesApi, bookingsApi, packagesApi, adminApi, createAuthenticatedApi } from '@/lib/api'

describe('spacesApi.list', () => {
  it('extracts spaces array from wrapped response', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { spaces: [{ id: '1', name: 'A' }] } }) } as any
    const result = await spacesApi.list(mockApi)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('A')
  })

  it('returns empty array when no spaces', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { spaces: [] } }) } as any
    const result = await spacesApi.list(mockApi)
    expect(result).toEqual([])
  })
})

describe('bookingsApi.listMine', () => {
  it('extracts bookings array from wrapped response', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { bookings: [{ id: '1' }] } }) } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
  })

  it('handles empty bookings', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { bookings: [] } }) } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(result).toEqual([])
  })
})

describe('createAuthenticatedApi', () => {
  it('sets Authorization header when token provided', () => {
    const api = createAuthenticatedApi('test-token')
    expect(api.defaults.headers.common['Authorization']).toBe('Bearer test-token')
  })
  it('omits Authorization when no token', () => {
    const api = createAuthenticatedApi(null)
    expect(api.defaults.headers.common['Authorization']).toBeUndefined()
  })
})

// Test all wrappers extract correctly
describe('all wrapped responses', () => {
  it('packagesApi.listMine extracts purchases', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { purchases: [{ id: '1' }] } }) } as any
    expect((await packagesApi.listMine(mockApi)).length).toBe(1)
  })
  it('adminApi.getSpaces extracts spaces', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { spaces: [] } }) } as any
    expect(Array.isArray(await adminApi.getSpaces(mockApi))).toBe(true)
  })
  it('adminApi.getBookings extracts bookings', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { bookings: [] } }) } as any
    expect(Array.isArray(await adminApi.getBookings({}, mockApi))).toBe(true)
  })
})

// Decimal-as-string from backend → JS number normalization
describe('decimal field normalization', () => {
  it('spacesApi.get coerces room.hourly_rate from string to number', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          space: { id: 's1', name: 'X' },
          rooms: [{ id: 'r1', hourly_rate: '11.00' }],
        },
      }),
    } as any
    const result = await spacesApi.get('s1', mockApi)
    expect(result.rooms[0].hourly_rate).toBe(11)
    expect(typeof result.rooms[0].hourly_rate).toBe('number')
  })

  it('bookingsApi.listMine coerces total_amount and duration_hours', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: { bookings: [{ id: 'b1', total_amount: '22.50', duration_hours: '2.5' }] },
      }),
    } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(result[0].total_amount).toBe(22.5)
    expect(result[0].duration_hours).toBe(2.5)
    expect(typeof result[0].total_amount).toBe('number')
    expect(typeof result[0].duration_hours).toBe('number')
  })

  it('bookingsApi.create coerces decimals on returned booking', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: { booking: { id: 'b1', total_amount: '15.00', duration_hours: '1.5' } },
      }),
    } as any
    const result = await bookingsApi.create({ room_id: 'r1', start_time: 'x', end_time: 'y' }, mockApi)
    expect(result.total_amount).toBe(15)
    expect(result.duration_hours).toBe(1.5)
    expect(typeof result.total_amount).toBe('number')
  })

  it('bookingsApi.listMine also normalizes nested room.hourly_rate', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          bookings: [{
            id: 'b1',
            total_amount: '10.00',
            duration_hours: '1.0',
            room: { id: 'r1', hourly_rate: '10.00' },
          }],
        },
      }),
    } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(result[0].room!.hourly_rate).toBe(10)
    expect(typeof result[0].room!.hourly_rate).toBe('number')
  })

  it('packagesApi.listMine coerces hours_total/used/remaining', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          purchases: [{
            id: 'p1',
            hours_total: '10.00',
            hours_used: '3.00',
            hours_remaining: '7.00',
          }],
        },
      }),
    } as any
    const result = await packagesApi.listMine(mockApi)
    expect(result[0].hours_total).toBe(10)
    expect(result[0].hours_used).toBe(3)
    expect(result[0].hours_remaining).toBe(7)
    expect(typeof result[0].hours_total).toBe('number')
    expect(typeof result[0].hours_remaining).toBe('number')
  })

  it('packagesApi.listMine also normalizes nested package.price', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          purchases: [{
            id: 'p1',
            hours_total: '10.00',
            hours_used: '0.00',
            hours_remaining: '10.00',
            package: { id: 'pkg1', price: '99.99' },
          }],
        },
      }),
    } as any
    const result = await packagesApi.listMine(mockApi)
    expect(result[0].package!.price).toBe(99.99)
    expect(typeof result[0].package!.price).toBe('number')
  })

  it('packagesApi.list coerces price on packages', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: { packages: [{ id: 'pkg1', price: '50.00' }] },
      }),
    } as any
    const result = await packagesApi.list('org1', mockApi)
    expect(result[0].price).toBe(50)
    expect(typeof result[0].price).toBe('number')
  })

  it('adminApi.getSpaces normalizes hourly_rate on nested rooms', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          spaces: [{
            id: 's1',
            name: 'X',
            rooms: [{ id: 'r1', hourly_rate: '12.50' }],
          }],
        },
      }),
    } as any
    const result = await adminApi.getSpaces(mockApi)
    expect(result[0].rooms![0].hourly_rate).toBe(12.5)
    expect(typeof result[0].rooms![0].hourly_rate).toBe('number')
  })

  it('num() default: null/undefined coerce to 0 via missing fields', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: { bookings: [{ id: 'b1' }] },
      }),
    } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(result[0].total_amount).toBe(0)
    expect(result[0].duration_hours).toBe(0)
  })
})
