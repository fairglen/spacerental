import axios from 'axios'
import type {
  Space, Room, Booking, Package, UserPackagePurchase,
  AvailabilitySlot, AdminStats, Membership,
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

// ─── Decimal normalization ───────────────────────────────────────────────
// Pydantic v2 serializes Decimal as a JSON string. Our TS types declare these
// fields as number, so we coerce here at the boundary. Keep the list explicit
// — no deep walker.

export const DECIMAL_FIELDS = {
  room: ['hourly_rate'],
  booking: ['total_amount', 'duration_hours'],
  pkg: ['price'],
  purchase: ['hours_total', 'hours_used', 'hours_remaining'],
} as const

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v)
}

function normRoom<T extends { hourly_rate?: unknown }>(r: T): T {
  return { ...r, hourly_rate: num(r.hourly_rate) } as T
}

function normBooking<T extends Booking>(b: T): T {
  return {
    ...b,
    total_amount: num(b.total_amount),
    duration_hours: num(b.duration_hours),
    room: b.room ? normRoom(b.room) : b.room,
  }
}

function normPackage<T extends { price?: unknown }>(p: T): T {
  return { ...p, price: num(p.price) } as T
}

function normPurchase<T extends UserPackagePurchase>(p: T): T {
  return {
    ...p,
    hours_total: num(p.hours_total),
    hours_used: num(p.hours_used),
    hours_remaining: num(p.hours_remaining),
    package: p.package ? normPackage(p.package) : p.package,
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────

export const authApi = {
  getMemberships: (api: Api) =>
    api.get<{ memberships: Membership[] }>('/auth/memberships').then(r => r.data.memberships),
}

// ─── Public ──────────────────────────────────────────────────────────────

export const spacesApi = {
  list: (api = apiClient) =>
    api.get<{ spaces: Space[] }>('/spaces').then(r => r.data.spaces),

  get: (id: string, api = apiClient) =>
    api.get<{ space: Space; rooms: Room[] }>(`/spaces/${id}`).then(r => ({
      space: r.data.space,
      rooms: (r.data.rooms ?? []).map(normRoom),
    })),

  getAvailability: (roomId: string, date: string, api = apiClient) =>
    api.get<{ slots: AvailabilitySlot[] }>(`/rooms/${roomId}/availability`, { params: { date } })
      .then(r => r.data.slots),
}

// ─── User (auth required) ────────────────────────────────────────────────

export const bookingsApi = {
  listMine: (api: Api) =>
    api.get<{ bookings: Booking[] }>('/bookings/me').then(r => r.data.bookings.map(normBooking)),

  create: (data: { room_id: string; start_time: string; end_time: string; notes?: string }, api: Api) =>
    api.post<{ booking: Booking }>('/bookings', data).then(r => normBooking(r.data.booking)),

  cancel: (id: string, api: Api) =>
    api.delete(`/bookings/${id}`),
}

export const packagesApi = {
  list: (orgId: string, api = apiClient) =>
    api.get<{ packages: Package[] }>('/packages', { params: { org_id: orgId } })
      .then(r => r.data.packages.map(normPackage)),

  listMine: (api: Api) =>
    api.get<{ purchases: UserPackagePurchase[] }>('/packages/me').then(r => r.data.purchases.map(normPurchase)),

  purchase: (packageId: string, orgId: string, api: Api) =>
    api.post<{ purchase: UserPackagePurchase }>(`/packages/${packageId}/purchase`, { org_id: orgId })
      .then(r => normPurchase(r.data.purchase)),
}

// ─── Admin ───────────────────────────────────────────────────────────────

export const adminApi = {
  getDashboard: (api: Api) =>
    api.get<AdminStats>('/admin/dashboard').then(r => r.data),

  getSpaces: (api: Api) =>
    api.get<{ spaces: Space[] }>('/admin/spaces').then(r =>
      r.data.spaces.map(s => ({ ...s, rooms: (s.rooms ?? []).map(normRoom) })),
    ),

  createSpace: (data: Partial<Space>, api: Api) =>
    api.post<{ space: Space }>('/admin/spaces', data).then(r => r.data.space),

  updateSpace: (id: string, data: Partial<Space>, api: Api) =>
    api.put<{ space: Space }>(`/admin/spaces/${id}`, data).then(r => r.data.space),

  createRoom: (spaceId: string, data: Partial<Room>, api: Api) =>
    api.post<{ room: Room }>(`/admin/spaces/${spaceId}/rooms`, data).then(r => normRoom(r.data.room)),

  updateRoom: (id: string, data: Partial<Room>, api: Api) =>
    api.put<{ room: Room }>(`/admin/rooms/${id}`, data).then(r => normRoom(r.data.room)),

  getBookings: (params: Record<string, string>, api: Api) =>
    api.get<{ bookings: Booking[] }>('/admin/bookings', {
      // Merge with instance defaults (e.g. org_id injected by useApi).
      params: { ...(api.defaults.params || {}), ...params },
    }).then(r => r.data.bookings.map(normBooking)),

  updateBooking: (id: string, status: string, api: Api) =>
    api.put<{ booking: Booking }>(`/admin/bookings/${id}`, { status }).then(r => normBooking(r.data.booking)),

  getPackages: (api: Api) =>
    api.get<{ packages: Package[] }>('/admin/packages').then(r => r.data.packages.map(normPackage)),

  createPackage: (data: Partial<Package>, api: Api) =>
    api.post<{ package: Package }>('/admin/packages', data).then(r => normPackage(r.data.package)),
}
