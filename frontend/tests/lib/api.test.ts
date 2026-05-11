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
