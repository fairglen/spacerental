import axios from 'axios'
import type {
  Space, Room, Booking, Package, UserPackagePurchase,
  AvailabilitySlot, AdminStats,
} from '@/types'

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export const apiClient = axios.create({ baseURL })

export function createAuthenticatedApi(accessToken: string | null | undefined) {
  const instance = axios.create({ baseURL })
  if (accessToken) {
    instance.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
  }
  return instance
}

type Api = ReturnType<typeof createAuthenticatedApi>

// ─── Public ──────────────────────────────────────────────────────────────

export const spacesApi = {
  list: (api = apiClient) =>
    api.get<{ spaces: Space[] }>('/spaces').then(r => r.data.spaces),

  get: (id: string, api = apiClient) =>
    api.get<{ space: Space; rooms: Room[] }>(`/spaces/${id}`).then(r => r.data),

  getAvailability: (roomId: string, date: string, api = apiClient) =>
    api.get<{ slots: AvailabilitySlot[] }>(`/rooms/${roomId}/availability`, { params: { date } })
      .then(r => r.data.slots),
}

// ─── User (auth required) ────────────────────────────────────────────────

export const bookingsApi = {
  listMine: (api: Api) =>
    api.get<{ bookings: Booking[] }>('/bookings/me').then(r => r.data.bookings),

  create: (data: { room_id: string; start_time: string; end_time: string; notes?: string }, api: Api) =>
    api.post<{ booking: Booking }>('/bookings', data).then(r => r.data.booking),

  cancel: (id: string, api: Api) =>
    api.delete(`/bookings/${id}`),
}

export const packagesApi = {
  list: (orgId: string, api = apiClient) =>
    api.get<{ packages: Package[] }>('/packages', { params: { org_id: orgId } })
      .then(r => r.data.packages),

  listMine: (api: Api) =>
    api.get<{ purchases: UserPackagePurchase[] }>('/packages/me').then(r => r.data.purchases),

  purchase: (packageId: string, orgId: string, api: Api) =>
    api.post<{ purchase: UserPackagePurchase }>(`/packages/${packageId}/purchase`, { org_id: orgId })
      .then(r => r.data.purchase),
}

// ─── Admin ───────────────────────────────────────────────────────────────

export const adminApi = {
  getDashboard: (api: Api) =>
    api.get<AdminStats>('/admin/dashboard').then(r => r.data),

  getSpaces: (api: Api) =>
    api.get<{ spaces: Space[] }>('/admin/spaces').then(r => r.data.spaces),

  createSpace: (data: Partial<Space>, api: Api) =>
    api.post<{ space: Space }>('/admin/spaces', data).then(r => r.data.space),

  updateSpace: (id: string, data: Partial<Space>, api: Api) =>
    api.put<{ space: Space }>(`/admin/spaces/${id}`, data).then(r => r.data.space),

  createRoom: (spaceId: string, data: Partial<Room>, api: Api) =>
    api.post<{ room: Room }>(`/admin/spaces/${spaceId}/rooms`, data).then(r => r.data.room),

  updateRoom: (id: string, data: Partial<Room>, api: Api) =>
    api.put<{ room: Room }>(`/admin/rooms/${id}`, data).then(r => r.data.room),

  getBookings: (params: Record<string, string>, api: Api) =>
    api.get<{ bookings: Booking[] }>('/admin/bookings', { params }).then(r => r.data.bookings),

  updateBooking: (id: string, status: string, api: Api) =>
    api.put<{ booking: Booking }>(`/admin/bookings/${id}`, { status }).then(r => r.data.booking),

  getPackages: (api: Api) =>
    api.get<{ packages: Package[] }>('/admin/packages').then(r => r.data.packages),

  createPackage: (data: Partial<Package>, api: Api) =>
    api.post<{ package: Package }>('/admin/packages', data).then(r => r.data.package),
}
