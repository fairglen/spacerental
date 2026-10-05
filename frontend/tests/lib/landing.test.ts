import { describe, expect, it, vi } from 'vitest'
import { fetchLandingData, landingCacheSeconds } from '@/lib/landing'

describe('landingCacheSeconds (P1.2)', () => {
  it('is 0 unless LANDING_CACHE_SECONDS says otherwise, and refuses anything but a whole number', () => {
    expect(landingCacheSeconds({})).toBe(0)
    expect(landingCacheSeconds({ LANDING_CACHE_SECONDS: '' })).toBe(0)
    expect(landingCacheSeconds({ LANDING_CACHE_SECONDS: ' 60 ' })).toBe(60)
    expect(() => landingCacheSeconds({ LANDING_CACHE_SECONDS: '1m' })).toThrow(/LANDING_CACHE_SECONDS/)
    expect(() => landingCacheSeconds({ LANDING_CACHE_SECONDS: '-5' })).toThrow(/LANDING_CACHE_SECONDS/)
  })
})

const space = (id: string) => ({ id, org_id: 'o-1', name: id, description: null, address: 'Rua', city: 'Lisboa', images: [], amenities: [], is_active: true })

describe('fetchLandingData (P1.2)', () => {
  it('one space: the list, then one composite read with the packs — two requests, nothing else', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ data: { spaces: [space('s-1')] } })
      .mockResolvedValueOnce({ data: { space: space('s-1'), rooms: [{ id: 'r-1', hourly_rate: '11.00', images: [], amenities: [], photos: [] }], contact: { email: 'x@y', phone: null }, packages: [{ id: 'p-1', hours: 10, price: '99.00' }] } })
    const data = await fetchLandingData({ get } as never)
    expect(get).toHaveBeenCalledTimes(2)
    expect(get.mock.calls[0][0]).toBe('/spaces')
    expect(get.mock.calls[1]).toEqual(['/spaces/s-1', { params: { include: 'packages' } }])
    expect(data.spaces).toHaveLength(1)
    expect(data.detail?.rooms[0].hourly_rate).toBe(11)
    expect(data.detail?.packages[0].price).toBe(99)
    expect(data.detail?.contact).toEqual({ email: 'x@y', phone: null })
  })

  it('several spaces or none: the list only, no detail', async () => {
    const get = vi.fn().mockResolvedValue({ data: { spaces: [space('s-1'), space('s-2')] } })
    expect((await fetchLandingData({ get } as never)).detail).toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
    get.mockResolvedValue({ data: { spaces: [] } })
    expect((await fetchLandingData({ get } as never)).detail).toBeNull()
  })

  it('an API failure propagates — the page decides what to render, and nothing is cached', async () => {
    const get = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(fetchLandingData({ get } as never)).rejects.toThrow('ECONNREFUSED')
  })
})
