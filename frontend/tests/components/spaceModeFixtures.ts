import { vi } from 'vitest'
import type { SingleSpaceState } from '@/lib/hooks/useSingleSpace'
import type { Room, Space } from '@/types'

export const makeSpace = (id: string, overrides: Partial<Space> = {}): Space => ({
  id, org_id: 'org-1', name: `Espaço ${id}`, description: '', address: 'R. 12 de Julho de 1997 5, Loja 1',
  city: 'Queluz', postal_code: '2745-841', latitude: 38.755723, longitude: -9.279799,
  images: [], amenities: [], is_active: true, created_at: '', ...overrides,
})

export const makeRoom = (id: string, overrides: Partial<Room> = {}): Room => ({
  id, space_id: 's-1', org_id: 'org-1', name: `Sala ${id}`, description: '', capacity: 4,
  hourly_rate: 11, images: [], amenities: ['WiFi'], color: '#A8D5BA', is_active: true, ...overrides,
})

export const modeState = (partial: Partial<SingleSpaceState>): SingleSpaceState => ({
  mode: 'multi', space: null, spaces: [], retry: vi.fn(), ...partial,
})
