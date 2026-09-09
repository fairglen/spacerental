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
  it('adminApi.updatePackage extracts and normalizes package', async () => {
    const mockApi = {
      put: vi.fn().mockResolvedValue({ data: { package: { id: 'pkg1', price: '45.00' } } }),
    } as any
    const result = await adminApi.updatePackage('pkg1', { is_active: false }, mockApi)
    expect(mockApi.put).toHaveBeenCalledWith('/admin/packages/pkg1', { is_active: false })
    expect(result.price).toBe(45)
    expect(typeof result.price).toBe('number')
  })

  it('adminApi.getAvailability extracts rules array', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({ data: { rules: [{ id: 'r1', day_of_week: 0 }] } }),
    } as any
    const result = await adminApi.getAvailability('room1', mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/rooms/room1/availability')
    expect(result).toHaveLength(1)
    expect(result[0].day_of_week).toBe(0)
  })

  it('adminApi.setAvailability posts the full rule set and extracts the response', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({ data: { rules: [{ id: 'r1', day_of_week: 0 }] } }),
    } as any
    const rules = [{ day_of_week: 0, open_time: '09:00', close_time: '18:00' }]
    const result = await adminApi.setAvailability('room1', rules, mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/admin/rooms/room1/availability', { rules })
    expect(result).toHaveLength(1)
  })

  it('adminApi.getBookings extracts bookings alongside pagination metadata', async () => {
    const mockApi = {
      defaults: { params: {} },
      get: vi.fn().mockResolvedValue({ data: { bookings: [], total: 0, page: 1, page_size: 20 } }),
    } as any
    const result = await adminApi.getBookings({}, mockApi)
    expect(Array.isArray(result.bookings)).toBe(true)
    expect(result.total).toBe(0)
    expect(result.page).toBe(1)
    expect(result.page_size).toBe(20)
  })

  it('adminApi.getBookings merges instance default params with call params', async () => {
    const mockApi = {
      defaults: { params: { org_id: 'org-123' } },
      get: vi.fn().mockResolvedValue({ data: { bookings: [], total: 0, page: 1, page_size: 20 } }),
    } as any
    await adminApi.getBookings({ status: 'confirmed' }, mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/bookings', {
      params: { org_id: 'org-123', status: 'confirmed' },
    })
  })

  it('adminApi.getBookings forwards page/page_size params for pagination', async () => {
    const mockApi = {
      defaults: { params: { org_id: 'org-123' } },
      get: vi.fn().mockResolvedValue({ data: { bookings: [], total: 45, page: 2, page_size: 20 } }),
    } as any
    const result = await adminApi.getBookings({ page: 2, page_size: 20 }, mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/bookings', {
      params: { org_id: 'org-123', page: 2, page_size: 20 },
    })
    expect(result.total).toBe(45)
    expect(result.page).toBe(2)
  })
})

// Checkout responses pair the created resource with the Stripe redirect URL.
describe('checkout responses', () => {
  it('bookingsApi.create extracts both booking and checkout_url', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: {
          booking: { id: 'b1', status: 'pending', total_amount: '22.00', duration_hours: '2.0' },
          checkout_url: 'https://checkout.stripe.stub/cs_stub_abc',
        },
      }),
    } as any
    const result = await bookingsApi.create({ room_id: 'r1', start_time: 'x', end_time: 'y' }, mockApi)
    expect(result.checkout_url).toBe('https://checkout.stripe.stub/cs_stub_abc')
    expect(result.booking.id).toBe('b1')
    // Stays pending until the Stripe webhook confirms it.
    expect(result.booking.status).toBe('pending')
  })

  // Story 2.4: a package-paid booking is confirmed on the spot and has no URL.
  it('bookingsApi.create yields a null checkout_url for a package booking', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: {
          booking: { id: 'b2', status: 'confirmed', total_amount: '22.00', duration_hours: '2.0' },
          checkout_url: null,
        },
      }),
    } as any
    const result = await bookingsApi.create(
      { room_id: 'r1', start_time: 'x', end_time: 'y', payment_method: 'package' },
      mockApi,
    )
    expect(result.checkout_url).toBeNull()
    expect(result.booking.status).toBe('confirmed')
  })

  it('bookingsApi.create forwards payment_method to the API', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: { booking: { id: 'b1' }, checkout_url: 'https://checkout.stripe.stub/cs' },
      }),
    } as any
    await bookingsApi.create(
      { room_id: 'r1', start_time: 'x', end_time: 'y', payment_method: 'hourly' },
      mockApi,
    )
    expect(mockApi.post).toHaveBeenCalledWith('/bookings', {
      room_id: 'r1', start_time: 'x', end_time: 'y', payment_method: 'hourly',
    })
  })

  it('packagesApi.purchase extracts both purchase and checkout_url', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: {
          purchase: {
            id: 'p1',
            status: 'pending',
            hours_total: '10.00',
            hours_used: '0.00',
            hours_remaining: '10.00',
          },
          checkout_url: 'https://checkout.stripe.stub/cs_stub_def',
        },
      }),
    } as any
    const result = await packagesApi.purchase('pkg1', 'org1', mockApi)
    expect(result.checkout_url).toBe('https://checkout.stripe.stub/cs_stub_def')
    expect(result.purchase.hours_remaining).toBe(10)
    expect(typeof result.purchase.hours_remaining).toBe('number')
    // Only the webhook flips this to 'active'.
    expect(result.purchase.status).toBe('pending')
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
        data: {
          booking: { id: 'b1', total_amount: '15.00', duration_hours: '1.5' },
          checkout_url: 'https://checkout.stripe.stub/cs_stub_1',
        },
      }),
    } as any
    const result = await bookingsApi.create({ room_id: 'r1', start_time: 'x', end_time: 'y' }, mockApi)
    expect(result.booking.total_amount).toBe(15)
    expect(result.booking.duration_hours).toBe(1.5)
    expect(typeof result.booking.total_amount).toBe('number')
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
