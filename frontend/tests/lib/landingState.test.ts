import { describe, expect, it } from 'vitest'
import { QueryClient, hydrate } from '@tanstack/react-query'
import { dehydratedLandingState } from '@/lib/landingState'
import { queryKeys } from '@/lib/queryKeys'
import type { LandingData } from '@/lib/landing'
import type { Package, Room, Space } from '@/types'

const space = { id: 's-1', org_id: 'o-1', name: 'FlowSpace', description: null, address: 'Rua', city: 'Lisboa', images: [], amenities: [], is_active: true, created_at: '2026-10-05T00:00:00Z' } as unknown as Space
const room: Room = { id: 'r-1', space_id: 's-1', org_id: 'o-1', name: 'Sala Calma', description: null, capacity: 4, hourly_rate: 11, images: [], amenities: [], color: '#A8D5BA', is_active: true }
const pack: Package = { id: 'p-1', org_id: 'o-1', name: '10h', hours: 10, price: 99, validity_days: 180, is_active: true }

describe('dehydratedLandingState (P1.2)', () => {
  it('hydrates the three keys the landing components read, with the packs apart from the space detail', () => {
    const data: LandingData = { spaces: [space], detail: { space, rooms: [room], contact: { email: null, phone: null }, packages: [pack] } }
    const client = new QueryClient()
    hydrate(client, dehydratedLandingState(data))
    expect(client.getQueryData(queryKeys.spaces)).toEqual([space])
    expect(client.getQueryData(queryKeys.space('s-1'))).toEqual({ space, rooms: [room], contact: { email: null, phone: null } })
    expect(client.getQueryData(queryKeys.pricingPackages('o-1'))).toEqual([pack])
    expect(client.getQueryCache().getAll()).toHaveLength(3)
  })

  it('with no single space only the list is hydrated', () => {
    const client = new QueryClient()
    hydrate(client, dehydratedLandingState({ spaces: [space, { ...space, id: 's-2' }], detail: null }))
    expect(client.getQueryData(queryKeys.spaces)).toHaveLength(2)
    expect(client.getQueryCache().getAll()).toHaveLength(1)
  })

  it('is plain data a server component can pass to HydrationBoundary', () => {
    const state = dehydratedLandingState({ spaces: [space], detail: { space, rooms: [room], contact: { email: null, phone: null }, packages: [pack] } })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})
