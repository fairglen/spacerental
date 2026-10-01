import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { authApi, apiClient, spacesApi, bookingsApi, packagesApi, adminApi, recurrencesApi, supportApi, createAuthenticatedApi } from '@/lib/api'

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

  it('bookingsApi.checkout posts to /bookings/{id}/checkout and unwraps booking + url (C03)', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: { booking: { id: 'b1', total_amount: '11.00', duration_hours: '1', status: 'pending' }, checkout_url: 'http://x/checkout/stub/cs_stub_1' },
      }),
    } as any
    const result = await bookingsApi.checkout('b1', mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/bookings/b1/checkout')
    expect(result.booking.total_amount).toBe(11)
    expect(result.checkout_url).toBe('http://x/checkout/stub/cs_stub_1')
  })

  it('carries access_code through unchanged, including null (B23)', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: { bookings: [{ id: '1', access_code: '482913' }, { id: '2', access_code: null }] },
      }),
    } as any
    const result = await bookingsApi.listMine(mockApi)
    expect(result[0].access_code).toBe('482913')
    expect(result[1].access_code).toBeNull()
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

  // Review on #65: a revoked bearer token must end the NextAuth session too.
  it('a 401 on an authenticated client signs the browser out, once; other errors and the anonymous client do not', async () => {
    const { signOut } = await import('next-auth/react')
    const { resetSessionRevoked } = await import('@/lib/sessionRevoked')
    resetSessionRevoked()
    vi.mocked(signOut).mockClear()
    const api = createAuthenticatedApi('stale-token')
    const reject = (status: number) => Promise.reject(new AxiosError('x', String(status), undefined, undefined, {
      status, statusText: 'x', data: {}, headers: {}, config: { headers: new AxiosHeaders() },
    }))
    api.defaults.adapter = () => reject(401)
    await expect(api.get('/bookings/me')).rejects.toBeTruthy()
    await expect(api.get('/packages/me')).rejects.toBeTruthy()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/sign-in?session=expired' })

    resetSessionRevoked()
    vi.mocked(signOut).mockClear()
    api.defaults.adapter = () => reject(403)
    await expect(api.get('/admin/users')).rejects.toBeTruthy()
    expect(signOut).not.toHaveBeenCalled()

    const anonymous = createAuthenticatedApi(null)
    anonymous.defaults.adapter = () => reject(401)
    await expect(anonymous.post('/auth/login', {})).rejects.toBeTruthy()
    expect(signOut).not.toHaveBeenCalled()
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

  it('recurrencesApi.create extracts recurrence and bookings, with no checkout_url', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({
        data: {
          recurrence: { id: 'rule-1', frequency: 'weekly', until_date: '2026-08-24' },
          bookings: [
            { id: 'b1', status: 'pending', total_amount: '11.00', duration_hours: '1.0' },
            { id: 'b2', status: 'pending', total_amount: '11.00', duration_hours: '1.0' },
          ],
        },
      }),
    } as any
    const result = await recurrencesApi.create(
      { room_id: 'r1', start_time: 'x', end_time: 'y', until_date: '2026-08-24' },
      mockApi,
    )
    expect(mockApi.post).toHaveBeenCalledWith('/recurrences', {
      room_id: 'r1', start_time: 'x', end_time: 'y', until_date: '2026-08-24',
    })
    expect(result.recurrence.id).toBe('rule-1')
    expect(result.bookings).toHaveLength(2)
    // Decimal-as-string normalization applies to series bookings too.
    expect(result.bookings[0].total_amount).toBe(11)
    expect(typeof result.bookings[0].total_amount).toBe('number')
    expect('checkout_url' in result).toBe(false)
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

  it('packagesApi.myPackages extracts the purchases and the bank, both as numbers (H02)', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          purchases: [{ id: 'p1', hours_total: '10.00', hours_used: '2.00', hours_remaining: '8.00', amount_paid: '100.00', package: { id: 'k', price: '100.00' } }],
          balance: { hours_available: '8.00', hours_expiring_next: { hours: '8.00', expires_at: '2027-01-01T00:00:00Z' } },
        },
      }),
    } as any
    const mine = await packagesApi.myPackages(mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/packages/me')
    expect(mine.purchases[0]).toMatchObject({ hours_remaining: 8, package: { price: 100 } })
    expect(mine.balance).toEqual({ hours_available: 8, hours_expiring_next: { hours: 8, expires_at: '2027-01-01T00:00:00Z' } })
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


describe('customer enrollment API contract', () => {
  it('keeps operator registration on its explicit endpoint and preserves the auth envelope', async () => {
    const response = { access_token: 'token', token_type: 'bearer', user: { id: 'operator' }, role: 'owner' }
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: response })
    const data = { email: 'operator@example.com', password: 'password123', name: 'Operator' }
    expect(await authApi.registerOperator(data)).toEqual(response)
    expect(post).toHaveBeenCalledWith('/auth/register/operator', data)
    post.mockRestore()
  })

  it('extracts the membership from an explicit authenticated enrollment', async () => {
    const api = createAuthenticatedApi('customer-token')
    const membership = { org_id: 'target-org', role: 'member' }
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { membership } })
    expect(await authApi.enroll(api)).toEqual(membership)
    expect(post).toHaveBeenCalledWith('/auth/enroll')
  })

  it('password reset (G03): request and confirm post their bodies and unwrap `detail`', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { detail: 'Se existir uma conta…' } })
    expect(await authApi.requestPasswordReset('me@test.com')).toBe('Se existir uma conta…')
    expect(post).toHaveBeenCalledWith('/auth/password-reset/request', { email: 'me@test.com' })
    post.mockResolvedValue({ data: { detail: 'Password alterada.' } })
    expect(await authApi.confirmPasswordReset('tok', 'novapass123')).toBe('Password alterada.')
    expect(post).toHaveBeenCalledWith('/auth/password-reset/confirm', { token: 'tok', password: 'novapass123' })
    post.mockRestore()
  })

  it('preserves the authentication envelope returned by customer registration', async () => {
    const response = { access_token: 'token', token_type: 'bearer', user: { id: 'user' }, role: 'member' }
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: response })
    const data = { email: 'customer@example.com', password: 'password123', name: 'Customer' }
    expect(await authApi.register(data)).toEqual(response)
    expect(post).toHaveBeenCalledWith('/auth/register', data)
    post.mockRestore()
  })
})

// C10: a space's coordinates arrive as Decimal strings (or null) and leave
// lib/api.ts as numbers (or null) — never 0 for a missing one, which would put
// a space without a location on the map at 0°N 0°E.
describe('space location shape (C10)', () => {
  const wire = {
    id: 's1', name: 'Espaço Calmo', address: 'R. 12 de Julho de 1997 5, Loja 1', city: 'Queluz',
    postal_code: '2745-841', latitude: '38.755723', longitude: '-9.279799',
  }
  const bare = { id: 's2', name: 'Sem morada', postal_code: null, latitude: null, longitude: null }

  it('spacesApi.list converts coordinates and keeps null as null', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { spaces: [wire, bare] } }) } as any
    const [located, unlocated] = await spacesApi.list(mockApi)
    expect(located.postal_code).toBe('2745-841')
    expect(located.latitude).toBe(38.755723)
    expect(located.longitude).toBe(-9.279799)
    expect(unlocated.latitude).toBeNull()
    expect(unlocated.longitude).toBeNull()
  })

  it('spacesApi.get carries the organisation contact, nulls when the API sends none (G04)', async () => {
    const withContact = { get: vi.fn().mockResolvedValue({ data: { space: { id: 's1' }, rooms: [], contact: { email: 'ola@flowspace.pt', phone: null } } }) } as any
    expect((await spacesApi.get('s1', withContact)).contact).toEqual({ email: 'ola@flowspace.pt', phone: null })
    const without = { get: vi.fn().mockResolvedValue({ data: { space: { id: 's1' }, rooms: [] } }) } as any
    expect((await spacesApi.get('s1', without)).contact).toEqual({ email: null, phone: null })
  })

  it('spacesApi.get converts the space and still normalizes its rooms', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({ data: { space: wire, rooms: [{ id: 'r1', hourly_rate: '11.00' }] } }),
    } as any
    const { space, rooms } = await spacesApi.get('s1', mockApi)
    expect(space.latitude).toBe(38.755723)
    expect(rooms[0].hourly_rate).toBe(11)
  })

  it('adminApi.getSpaces converts coordinates and nested room rates', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({ data: { spaces: [{ ...wire, rooms: [{ id: 'r1', hourly_rate: '11.00' }] }] } }),
    } as any
    const [space] = await adminApi.getSpaces(mockApi)
    expect(space.longitude).toBe(-9.279799)
    expect(space.rooms?.[0].hourly_rate).toBe(11)
  })

  it('adminApi.createSpace and updateSpace send the location and unwrap { space }', async () => {
    const mockApi = {
      post: vi.fn().mockResolvedValue({ data: { space: wire } }),
      put: vi.fn().mockResolvedValue({ data: { space: bare } }),
    } as any
    const body = { name: 'Espaço Calmo', postal_code: '2745-841', latitude: 38.755723, longitude: -9.279799 }
    const created = await adminApi.createSpace(body, mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/admin/spaces', body)
    expect(created.latitude).toBe(38.755723)

    const cleared = { postal_code: null, latitude: null, longitude: null }
    const updated = await adminApi.updateSpace('s2', cleared, mockApi)
    expect(mockApi.put).toHaveBeenCalledWith('/admin/spaces/s2', cleared)
    expect(updated.latitude).toBeNull()
  })
})

// C13: a mixed booking's split arrives as Decimal strings like every amount.
describe('mixed payment shape (C13)', () => {
  const wire = {
    id: 'b1', status: 'pending', payment_method: 'mixed', duration_hours: '8.00',
    package_hours_used: '7.00', total_amount: '11.00',
  }

  it('bookingsApi.create sends the method and converts the split', async () => {
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { booking: wire, checkout_url: 'http://x/cs' } }) } as any
    const body = { room_id: 'r', start_time: 's', end_time: 'e', payment_method: 'mixed' as const }
    const { booking, checkout_url } = await bookingsApi.create(body, mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/bookings', body)
    expect(booking.payment_method).toBe('mixed')
    expect(booking.package_hours_used).toBe(7)
    expect(booking.total_amount).toBe(11)
    expect(checkout_url).toBe('http://x/cs')
  })

  it('listMine and the admin list convert it too, and default a missing share to 0', async () => {
    const mine = { get: vi.fn().mockResolvedValue({ data: { bookings: [wire, { id: 'old', total_amount: '11.00', duration_hours: '1' }] } }) } as any
    const [mixed, old] = await bookingsApi.listMine(mine)
    expect(mixed.package_hours_used).toBe(7)
    expect(old.package_hours_used).toBe(0)

    const admin = { defaults: {}, get: vi.fn().mockResolvedValue({ data: { bookings: [wire], total: 1, page: 1, page_size: 20 } }) } as any
    expect((await adminApi.getBookings({}, admin)).bookings[0].package_hours_used).toBe(7)
  })
})

// C14/C15: photo management. Each call answers with the updated entity; the
// wrapper hands back just its `photos`, which is all the photo manager needs.
describe('photo management shape (C15)', () => {
  const photos = [{ id: 'p1', url: 'http://api/media/a.webp', thumb_url: 'http://api/media/a_thumb.webp', width: 1600, height: 1200 }]

  it('uploadPhoto posts multipart to the room or the space and extracts photos', async () => {
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { room: { id: 'r1', hourly_rate: '11.00', photos } } }) } as any
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    const onProgress = vi.fn()
    expect(await adminApi.uploadPhoto('rooms', 'r1', file, mockApi, onProgress)).toEqual(photos)
    const [url, body, config] = mockApi.post.mock.calls[0]
    expect(url).toBe('/admin/rooms/r1/images')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBe(file)
    config.onUploadProgress({ loaded: 50, total: 200 })
    expect(onProgress).toHaveBeenCalledWith(25)

    const spaceApi = { post: vi.fn().mockResolvedValue({ data: { space: { id: 's1', photos } } }) } as any
    expect(await adminApi.uploadPhoto('spaces', 's1', file, spaceApi)).toEqual(photos)
    expect(spaceApi.post.mock.calls[0][0]).toBe('/admin/spaces/s1/images')
  })

  it('deletePhoto and reorderPhotos extract photos from the updated entity', async () => {
    const mockApi = {
      delete: vi.fn().mockResolvedValue({ data: { room: { id: 'r1', photos: [] } } }),
      put: vi.fn().mockResolvedValue({ data: { space: { id: 's1', photos } } }),
    } as any
    expect(await adminApi.deletePhoto('rooms', 'r1', 'p1', mockApi)).toEqual([])
    expect(mockApi.delete).toHaveBeenCalledWith('/admin/rooms/r1/images/p1')
    expect(await adminApi.reorderPhotos('spaces', 's1', ['p1'], mockApi)).toEqual(photos)
    expect(mockApi.put).toHaveBeenCalledWith('/admin/spaces/s1/images/order', { order: ['p1'] })
  })

  it('an entity without the field yet reads as no photos', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { space: { id: 's1' }, rooms: [{ id: 'r1', hourly_rate: '11.00' }] } }) } as any
    const { space, rooms } = await spacesApi.get('s1', mockApi)
    expect(space.photos).toEqual([])
    expect(rooms[0].photos).toEqual([])
  })
})

// C17: the help form. The receipt is wrapped and carries no message back.
describe('supportApi (C17)', () => {
  it('posts the request and unwraps the receipt', async () => {
    const receipt = { id: '3f9a12bc-0000-0000-0000-000000000000', reference: '3F9A12BC', status: 'new', created_at: '2026-09-22T10:00:00Z' }
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { request: receipt } }) } as any
    const body = { category: 'technical' as const, message: 'x'.repeat(20), contact_email: 'a@b.pt', context: {}, website: '' }
    expect(await supportApi.create(body, mockApi)).toEqual(receipt)
    expect(mockApi.post).toHaveBeenCalledWith('/support/requests', body)
  })
})

// C19: the operator inbox, paginated like the admin bookings list.
describe('adminApi support inbox (C19)', () => {
  it('getSupportRequests merges the org param, passes filters and returns the page', async () => {
    const mockApi = {
      defaults: { params: { org_id: 'org-1' } },
      get: vi.fn().mockResolvedValue({ data: { requests: [{ id: 'r1', reference: 'R1' }], total: 1, page: 1, page_size: 20 } }),
    } as any
    const page = await adminApi.getSupportRequests({ status: 'new', page: 2 }, mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/support/requests', { params: { org_id: 'org-1', status: 'new', page: 2 } })
    expect(page.requests[0].reference).toBe('R1')
    expect(page.total).toBe(1)
  })

  it('updateSupportRequest puts the status and unwraps the request', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { request: { id: 'r1', status: 'closed' } } }) } as any
    expect((await adminApi.updateSupportRequest('r1', 'closed', mockApi)).status).toBe('closed')
    expect(mockApi.put).toHaveBeenCalledWith('/admin/support/requests/r1', { status: 'closed' })
  })
})

// A01/A02/A03: what the admin calendar calls.
// K02: a purchase started from the booking page says where to come back to.
describe('packagesApi.purchase return_to (K02)', () => {
  const data = { purchase: { id: 'p1', hours_total: '10.00', hours_used: '0', hours_remaining: '10.00' }, checkout_url: 'http://x/checkout' }
  it('sends return_to only when given', async () => {
    const mockApi = { post: vi.fn().mockResolvedValue({ data }) } as any
    await packagesApi.purchase('pkg', 'org', mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/packages/pkg/purchase', { org_id: 'org' })
    const result = await packagesApi.purchase('pkg', 'org', mockApi, '/spaces/s?room=r&start=a&end=b')
    expect(mockApi.post).toHaveBeenLastCalledWith('/packages/pkg/purchase', { org_id: 'org', return_to: '/spaces/s?room=r&start=a&end=b' })
    expect(result.checkout_url).toBe('http://x/checkout')
    expect(result.purchase.hours_remaining).toBe(10)
  })
})

describe('adminApi booking management and blocks (A01, A02)', () => {
  const booking = { id: 'b1', total_amount: '22.00', duration_hours: '2.00', package_hours_used: '0', admin_note: 'n' }

  it('updateBookingDetails puts any subset and returns the booking with hours when it moved', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { booking, hours: { before: '1.00', after: '2.00' } } }) } as any
    const body = { start_time: 's', end_time: 'e', room_id: 'r', admin_note: 'n' }
    const result = await adminApi.updateBookingDetails('b1', body, mockApi)
    expect(mockApi.put).toHaveBeenCalledWith('/admin/bookings/b1', body)
    expect(result.booking.total_amount).toBe(22)
    expect(result.booking.admin_note).toBe('n')
    // H03: `uncovered` is 0 when the API did not report any.
    expect(result.hours).toEqual({ before: 1, after: 2, uncovered: 0 })
  })

  it('updateBookingDetails carries the hours the bank could not cover (H03)', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { booking, hours: { before: '2.00', after: '4.00', uncovered: '1.00' } } }) } as any
    const result = await adminApi.updateBookingDetails('b1', { end_time: 'e' }, mockApi)
    expect(result.hours).toEqual({ before: 2, after: 4, uncovered: 1 })
  })

  it('updateBookingDetails carries the credit a cancellation created, with its hours as a number (K01)', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { booking, credit: { id: 'c1', hours: '2.00', expires_at: '2027-10-01T00:00:00Z' } } }) } as any
    const result = await adminApi.updateBookingDetails('b1', { status: 'cancelled', reason: 'r' }, mockApi)
    expect(result.credit).toEqual({ id: 'c1', hours: 2, expires_at: '2027-10-01T00:00:00Z' })
    expect(result.hours).toBeUndefined()
    const none = await adminApi.updateBookingDetails('b1', { status: 'cancelled', reason: 'r', credit_hours: false }, { put: vi.fn().mockResolvedValue({ data: { booking } }) } as any)
    expect(none.credit).toBeUndefined()
  })

  it('updateBooking (status only) still works and normalizes', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { booking } }) } as any
    expect((await adminApi.updateBooking('b1', 'cancelled', mockApi)).total_amount).toBe(22)
    expect(mockApi.put).toHaveBeenCalledWith('/admin/bookings/b1', { status: 'cancelled' })
  })

  it('createManualBooking posts and unwraps', async () => {
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { booking: { ...booking, payment_method: 'manual' } } }) } as any
    const body = { user_id: 'u', room_id: 'r', start_time: 's', end_time: 'e', admin_note: 'cash' }
    expect((await adminApi.createManualBooking(body, mockApi)).payment_method).toBe('manual')
    expect(mockApi.post).toHaveBeenCalledWith('/admin/bookings', body)
  })

  it('markBookingPaid posts the reason and unwraps', async () => {
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { booking } }) } as any
    await adminApi.markBookingPaid('b1', 'MB WAY', mockApi)
    expect(mockApi.post).toHaveBeenCalledWith('/admin/bookings/b1/mark-paid', { reason: 'MB WAY' })
  })

  it('blocks: list, create, update, delete', async () => {
    const block = { id: 'k1', room_id: 'r', start_time: 's', end_time: 'e', reason: 'obras' }
    const mockApi = {
      get: vi.fn().mockResolvedValue({ data: { blocks: [block] } }),
      post: vi.fn().mockResolvedValue({ data: { block } }),
      put: vi.fn().mockResolvedValue({ data: { block: { ...block, reason: 'pintura' } } }),
      delete: vi.fn().mockResolvedValue({}),
    } as any
    expect(await adminApi.getBlocks('r', { from: 'a', to: 'b' }, mockApi)).toEqual([block])
    expect(mockApi.get).toHaveBeenCalledWith('/admin/rooms/r/blocks', { params: { from: 'a', to: 'b' } })
    expect(await adminApi.createBlock('r', { start_time: 's', end_time: 'e', reason: 'obras' }, mockApi)).toEqual(block)
    expect((await adminApi.updateBlock('r', 'k1', { reason: 'pintura' }, mockApi)).reason).toBe('pintura')
    await adminApi.deleteBlock('r', 'k1', mockApi)
    expect(mockApi.delete).toHaveBeenCalledWith('/admin/rooms/r/blocks/k1')
  })

  it('getBookings passes a date window and room for the calendar', async () => {
    const mockApi = { defaults: { params: { org_id: 'o' } }, get: vi.fn().mockResolvedValue({ data: { bookings: [booking], total: 1, page: 1, page_size: 100 } }) } as any
    await adminApi.getBookings({ from: 'a', to: 'b', room_id: 'r', page_size: 100 }, mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/bookings', { params: { org_id: 'o', from: 'a', to: 'b', room_id: 'r', page_size: 100 } })
  })
})

// A05: users, one customer, the role and complimentary hours.
describe('adminApi users (A05)', () => {
  const orgUser = { id: 'u1', email: 'ana@example.com', name: 'Ana', role: 'member', joined_at: '2026-01-01T00:00:00Z', bookings_count: 2, created_at: '2026-01-01T00:00:00Z' }

  it('getUsers returns the page envelope untouched, with the search and paging params', async () => {
    const mockApi = { get: vi.fn().mockResolvedValue({ data: { users: [orgUser], total: 1, page: 1, page_size: 20 } }) } as any
    const page = await adminApi.getUsers({ q: 'ana', page: 1, page_size: 20 }, mockApi)
    expect(page.users).toEqual([orgUser])
    expect(page.total).toBe(1)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/users', { params: { q: 'ana', page: 1, page_size: 20 } })
  })

  it('getUser normalises the money and hours strings on purchases and bookings', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          user: orgUser,
          bookings: [{ id: 'b1', total_amount: '22.00', duration_hours: '2.00', package_hours_used: '0.00', room: { id: 'r', hourly_rate: '11.00' } }],
          purchases: [{ id: 'p1', hours_total: '3.00', hours_used: '0.00', hours_remaining: '3.00', amount_paid: '0.00', admin_note: 'oferta', package: { id: 'k', price: '100.00' } }],
          balance: { hours_available: '3.00', hours_expiring_next: { hours: '3.00', expires_at: '2027-01-01T00:00:00Z' } },
          support_requests: [],
        },
      }),
    } as any
    const detail = await adminApi.getUser('u1', mockApi)
    expect(mockApi.get).toHaveBeenCalledWith('/admin/users/u1')
    expect(detail.user).toEqual(orgUser)
    expect(detail.bookings[0].total_amount).toBe(22)
    expect(detail.purchases[0]).toMatchObject({ hours_remaining: 3, amount_paid: 0, admin_note: 'oferta', package: { price: 100 } })
    // H02: the bank rides along, its strings turned into numbers too.
    expect(detail.balance).toEqual({ hours_available: 3, hours_expiring_next: { hours: 3, expires_at: '2027-01-01T00:00:00Z' } })
  })

  it('getUser normalises a booking\'s per-pack split (H02)', async () => {
    const mockApi = {
      get: vi.fn().mockResolvedValue({
        data: {
          user: orgUser,
          bookings: [{ id: 'b1', total_amount: '55.00', duration_hours: '5.00', package_hours_used: '5.00', package_debits: [{ purchase_id: 'p1', hours: '2.00', package_name: 'Pack 10h', expires_at: null }] }],
          purchases: [],
          balance: { hours_available: '0', hours_expiring_next: null },
          support_requests: [],
        },
      }),
    } as any
    const detail = await adminApi.getUser('u1', mockApi)
    expect(detail.bookings[0].package_debits).toEqual([{ purchase_id: 'p1', hours: 2, package_name: 'Pack 10h', expires_at: null }])
    expect(detail.balance).toEqual({ hours_available: 0, hours_expiring_next: null })
  })

  it('setUserRole puts the role and unwraps the member row', async () => {
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { user: { ...orgUser, role: 'admin' } } }) } as any
    expect((await adminApi.setUserRole('u1', 'admin', mockApi)).role).toBe('admin')
    expect(mockApi.put).toHaveBeenCalledWith('/admin/users/u1/role', { role: 'admin' })
  })

  it('grantHours posts the body and unwraps the zero-amount purchase', async () => {
    const purchase = { id: 'p1', hours_total: '3.00', hours_used: '0.00', hours_remaining: '3.00', amount_paid: '0.00', admin_note: 'avaria' }
    const mockApi = { post: vi.fn().mockResolvedValue({ data: { purchase } }) } as any
    const body = { hours: 3, package_id: 'k', reason: 'avaria' }
    expect(await adminApi.grantHours('u1', body, mockApi)).toMatchObject({ amount_paid: 0, hours_remaining: 3 })
    expect(mockApi.post).toHaveBeenCalledWith('/admin/users/u1/complimentary-hours', body)
  })

  it('extendPurchase puts the new expiry and reason, and unwraps (A06)', async () => {
    const purchase = { id: 'p1', hours_remaining: '7.00', amount_paid: '100.00', expires_at: '2030-04-15T23:59:59Z', admin_note: '[2026-09-22] Validade: 2030-03-01 → 2030-04-15. baixa' }
    const mockApi = { put: vi.fn().mockResolvedValue({ data: { purchase } }) } as any
    const body = { expires_at: '2030-04-15T23:59:59Z', reason: 'baixa' }
    expect(await adminApi.extendPurchase('p1', body, mockApi)).toMatchObject({ hours_remaining: 7, amount_paid: 100 })
    expect(mockApi.put).toHaveBeenCalledWith('/admin/purchases/p1/expiry', body)
  })
})

describe('Part A1 admin endpoints (G01–G04): every wrapper unwraps its envelope', () => {
  const api = (data: unknown, method: 'get' | 'post' | 'put' | 'delete' = 'get') => {
    const fn = vi.fn().mockResolvedValue({ data })
    return { [method]: fn, fn } as unknown as { get: typeof fn; post: typeof fn; put: typeof fn; delete: typeof fn; fn: typeof fn }
  }

  it('audit trail and history share the paginated shape', async () => {
    const page = { actions: [{ id: 'a1', action: 'update' }], total: 1, page: 1, page_size: 20 }
    const trail = api(page)
    expect(await adminApi.getAudit({ entity_type: 'room' }, trail as any)).toEqual(page)
    expect(trail.fn).toHaveBeenCalledWith('/admin/audit', { params: { entity_type: 'room' } })
    const history = api(page)
    expect(await adminApi.getHistory('support', 'r1', { page: 2 }, history as any)).toEqual(page)
    expect(history.fn).toHaveBeenCalledWith('/admin/support/requests/r1/history', { params: { page: 2 } })
    const purchases = api(page)
    await adminApi.getHistory('purchases', 'p1', {}, purchases as any)
    expect(purchases.fn).toHaveBeenCalledWith('/admin/purchases/p1/history', { params: {} })
  })

  it('detail reads normalise the nested entity numbers', async () => {
    const space = api({ space: { id: 's1', latitude: '38.7', longitude: '-9.1', rooms: [{ id: 'r1', hourly_rate: '11.00' }] }, photo_count: 2, bookings: { total: 3, upcoming: 1 } })
    const s = await adminApi.getSpace('s1', space as any)
    expect(s.space.latitude).toBe(38.7)
    expect(s.space.rooms?.[0].hourly_rate).toBe(11)
    expect(s.bookings).toEqual({ total: 3, upcoming: 1 })
    const room = api({ room: { id: 'r1', hourly_rate: '9.50' }, space: { id: 's1' }, rules: [], blocks: [], photo_count: 0, bookings: { total: 0, upcoming: 0 } })
    expect((await adminApi.getRoom('r1', room as any)).room.hourly_rate).toBe(9.5)
    const booking = api({ booking: { id: 'b1', total_amount: '9.00', duration_hours: '1', stripe_checkout_session_id: 'cs_1' }, history: [] })
    const b = await adminApi.getBooking('b1', booking as any)
    expect(b.booking.total_amount).toBe(9)
    expect(b.booking.stripe_checkout_session_id).toBe('cs_1')
    const pkg = api({ package: { id: 'p1', price: '100.00' }, purchases: { total: 2, active: 1 }, hours_outstanding: '7.50' })
    const p = await adminApi.getPackage('p1', pkg as any)
    expect(p.package.price).toBe(100)
    expect(p.hours_outstanding).toBe(7.5)
  })

  it('room duplicate and availability helpers', async () => {
    const dup = api({ room: { id: 'r2', hourly_rate: '11.00' } }, 'post')
    expect((await adminApi.duplicateRoom('r1', dup as any)).id).toBe('r2')
    expect(dup.fn).toHaveBeenCalledWith('/admin/rooms/r1/duplicate')
    const copy = api({ rules: [{ id: 'x', day_of_week: 0 }] }, 'post')
    expect(await adminApi.copyAvailabilityToAllDays('r1', 0, copy as any)).toHaveLength(1)
    expect(copy.fn).toHaveBeenCalledWith('/admin/rooms/r1/availability/copy-to-all-days', { day_of_week: 0 })
    const del = api(undefined, 'delete')
    await adminApi.deleteAvailabilityRule('r1', 'rule1', del as any)
    expect(del.fn).toHaveBeenCalledWith('/admin/rooms/r1/availability/rule1')
  })

  it('hard deletes send confirm as a query parameter (G02)', async () => {
    for (const [call, path] of [
      [(a: any) => adminApi.deleteSpace('s1', 'Espaço', a), '/admin/spaces/s1'],
      [(a: any) => adminApi.deleteRoom('r1', 'Sala', a), '/admin/rooms/r1'],
      [(a: any) => adminApi.deletePackage('p1', 'Pack', a), '/admin/packages/p1'],
      [(a: any) => adminApi.deletePurchase('u1', 'abcd1234', a), '/admin/purchases/u1'],
      [(a: any) => adminApi.deleteSupportRequest('q1', 'abcd1234', a), '/admin/support/requests/q1'],
      [(a: any) => adminApi.deleteUser('u1', 'x@y.z', a), '/admin/users/u1'],
      [(a: any) => adminApi.removeMembership('u1', 'x@y.z', a), '/admin/users/u1/membership'],
    ] as const) {
      const del = api(undefined, 'delete')
      await call(del)
      expect(del.fn.mock.calls[0][0]).toBe(path)
      expect(del.fn.mock.calls[0][1].params.confirm).toBeTruthy()
    }
    const withReason = api(undefined, 'delete')
    await adminApi.deleteBooking('b1', 'abcd1234', 'Criada por engano', withReason as any)
    expect(withReason.fn).toHaveBeenCalledWith('/admin/bookings/b1', { params: { confirm: 'abcd1234', reason: 'Criada por engano' } })
    const anon = api({ user: { id: 'u1', email: 'utilizador-abcd1234@anon.invalid', name: 'Utilizador removido', disabled_at: 't' } }, 'post')
    expect((await adminApi.anonymiseUser('u1', { confirm: 'abcd1234', reason: 'RGPD' }, anon as any)).email).toContain('anon.invalid')
    expect(anon.fn).toHaveBeenCalledWith('/admin/users/u1/anonymise', { confirm: 'abcd1234', reason: 'RGPD' })
  })

  it('users: create, update, reset link, set password', async () => {
    const created = api({ user: { id: 'u1', email: 'a@b.c', role: 'member' } }, 'post')
    expect((await adminApi.createUser({ email: 'a@b.c', name: 'A' }, created as any)).role).toBe('member')
    expect(created.fn).toHaveBeenCalledWith('/admin/users', { email: 'a@b.c', name: 'A' })
    const updated = api({ user: { id: 'u1', disabled_at: null } }, 'put')
    expect((await adminApi.updateUser('u1', { disabled_at: null }, updated as any)).disabled_at).toBeNull()
    expect(updated.fn).toHaveBeenCalledWith('/admin/users/u1', { disabled_at: null })
    const sent = api({ sent_to: 'a@b.c', sent_at: 't' }, 'post')
    expect((await adminApi.sendPasswordReset('u1', sent as any)).sent_to).toBe('a@b.c')
    const pw = api({ user: { id: 'u1' } }, 'post')
    await adminApi.setPassword('u1', 'definida123', pw as any)
    expect(pw.fn).toHaveBeenCalledWith('/admin/users/u1/set-password', { password: 'definida123' })
  })

  it('purchases: list with the customer, detail with debits, adjust and update', async () => {
    const list = api({ purchases: [{ id: 'p1', hours_total: '10.00', hours_used: '0', hours_remaining: '10.00', user: { id: 'u1', name: 'A', email: 'a@b.c' } }], total: 1, page: 1, page_size: 20 })
    const l = await adminApi.getPurchases({ status: 'active' }, list as any)
    expect(l.purchases[0].hours_remaining).toBe(10)
    expect(l.purchases[0].user.email).toBe('a@b.c')
    expect(list.fn).toHaveBeenCalledWith('/admin/purchases', { params: { status: 'active' } })
    const detail = api({ purchase: { id: 'p1', hours_total: '10.00', hours_used: '1.00', hours_remaining: '9.00' }, user: { id: 'u1', name: 'A', email: 'a@b.c' }, debits: [{ booking_id: 'b1', hours: '1.00', start_time: 't', end_time: 't', status: 'confirmed', room_name: 'Sala' }] })
    const d = await adminApi.getPurchase('p1', detail as any)
    expect(d.debits[0].hours).toBe(1)
    const adjust = api({ purchase: { id: 'p1', hours_total: '12.00', hours_remaining: '11.00', hours_used: '1.00' } }, 'post')
    expect((await adminApi.adjustPurchase('p1', { hours: 2, reason: 'x' }, adjust as any)).hours_total).toBe(12)
    expect(adjust.fn).toHaveBeenCalledWith('/admin/purchases/p1/adjust', { hours: '2', reason: 'x' })
    const upd = api({ purchase: { id: 'p1', status: 'cancelled', hours_total: '10', hours_used: '0', hours_remaining: '0' } }, 'put')
    expect((await adminApi.updatePurchase('p1', { status: 'cancelled', reason: 'r' }, upd as any)).status).toBe('cancelled')
  })

  it('support detail and note, organisation read and write', async () => {
    const detail = api({ request: { id: 'q1', message: 'm', admin_note: null, user: null, booking: null } })
    expect((await adminApi.getSupportRequest('q1', detail as any)).message).toBe('m')
    const note = api({ request: { id: 'q1', admin_note: 'n', status: 'in_progress' } }, 'put')
    expect((await adminApi.updateSupportRequestDetail('q1', { admin_note: 'n', status: 'in_progress' }, note as any)).admin_note).toBe('n')
    const org = api({ organization: { id: 'o1', name: 'FlowSpace', slug: 'fs', contact_email: null, contact_phone: null, timezone: 'Europe/Lisbon' } })
    expect((await adminApi.getOrganization(org as any)).slug).toBe('fs')
    const put = api({ organization: { id: 'o1', name: 'Novo' } }, 'put')
    expect((await adminApi.updateOrganization({ name: 'Novo' }, put as any)).name).toBe('Novo')
    expect(put.fn).toHaveBeenCalledWith('/admin/organization', { name: 'Novo' })
  })
})
