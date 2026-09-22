import axios from 'axios'
import type {
  Space, Room, Booking, Package, UserPackagePurchase, Photo,
  AvailabilitySlot, AvailabilityRule, AdminStats, Membership, User,
  BookingCheckout, PackagePurchaseCheckout, RecurrenceWithBookings, PaginatedBookings,
  SupportRequestBody, SupportRequestReceipt, SupportRequestRow, PaginatedSupportRequests,
  OrgUser, OrgUserDetail, PaginatedOrgUsers, AdminPurchase, ComplimentaryHoursBody,
  RoomBlock, AdminBookingPatch,
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
  space: ['latitude', 'longitude'],
  room: ['hourly_rate'],
  booking: ['total_amount', 'duration_hours', 'package_hours_used'],
  pkg: ['price'],
  purchase: ['hours_total', 'hours_used', 'hours_remaining'],
} as const

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  return typeof v === 'number' ? v : Number(v)
}

// Unlike money, a coordinate has no zero default: a missing one stays null so
// a space without a location is not drawn in the Gulf of Guinea.
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function normSpace<T extends { latitude?: unknown; longitude?: unknown; rooms?: Room[]; photos?: Photo[] }>(s: T): T {
  return {
    ...s,
    latitude: numOrNull(s.latitude),
    longitude: numOrNull(s.longitude),
    photos: s.photos ?? [],
    ...(s.rooms ? { rooms: s.rooms.map(normRoom) } : {}),
  } as T
}

function normRoom<T extends { hourly_rate?: unknown; photos?: Photo[] }>(r: T): T {
  return { ...r, hourly_rate: num(r.hourly_rate), photos: r.photos ?? [] } as T
}

function normBooking<T extends Booking>(b: T): T {
  return {
    ...b,
    total_amount: num(b.total_amount),
    duration_hours: num(b.duration_hours),
    package_hours_used: num(b.package_hours_used),
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
    amount_paid: num(p.amount_paid),
    package: p.package ? normPackage(p.package) : p.package,
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────

export type RegisterResponse = {
  access_token: string
  token_type: string
  user: User
  role: string
}

export const authApi = {
  getMemberships: (api: Api) =>
    api.get<{ memberships: Membership[] }>('/auth/memberships').then(r => r.data.memberships),

  enroll: (api: Api) =>
    api.post<{ membership: Pick<Membership, 'org_id' | 'role'> }>('/auth/enroll')
      .then(r => r.data.membership),

  register: (data: { email: string; password: string; name: string }) =>
    apiClient.post<RegisterResponse>('/auth/register', data).then(r => r.data),

  registerOperator: (data: { email: string; password: string; name: string }) =>
    apiClient.post<RegisterResponse>('/auth/register/operator', data).then(r => r.data),
}

// ─── Public ──────────────────────────────────────────────────────────────

export const spacesApi = {
  list: (api = apiClient) =>
    api.get<{ spaces: Space[] }>('/spaces').then(r => r.data.spaces.map(normSpace)),

  get: (id: string, api = apiClient) =>
    api.get<{ space: Space; rooms: Room[] }>(`/spaces/${id}`).then(r => ({
      space: normSpace(r.data.space),
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

  // An `hourly` booking comes back `pending` with a Stripe Checkout URL — it is
  // the webhook, not this response, that confirms it. A `package` booking is
  // paid from prepaid hours, so it is already `confirmed` and `checkout_url` is
  // null. `mixed` (C13) asks for "my pack first, money for the rest": the
  // server computes the split, and may answer with a plain `package` or
  // `hourly` booking if that is what the balance makes it.
  create: (
    data: {
      room_id: string
      start_time: string
      end_time: string
      notes?: string
      payment_method?: 'hourly' | 'package' | 'mixed'
    },
    api: Api,
  ) =>
    api.post<BookingCheckout>('/bookings', data).then(r => ({
      booking: normBooking(r.data.booking),
      checkout_url: r.data.checkout_url ?? null,
    })),

  cancel: (id: string, api: Api) =>
    api.delete(`/bookings/${id}`),

  // "Pagar agora" (C03): a fresh Checkout URL for an unpaid or expired hold.
  // Same wrapped shape as create; the backend never creates a second booking.
  checkout: (id: string, api: Api) =>
    api.post<BookingCheckout>(`/bookings/${id}/checkout`).then(r => ({
      booking: normBooking(r.data.booking),
      checkout_url: r.data.checkout_url ?? null,
    })),
}

export const recurrencesApi = {
  // Same all-or-nothing create as bookingsApi.create, but for a weekly series.
  // No checkout_url in the response — see RecurrenceWithBookings.
  create: (
    data: {
      room_id: string
      start_time: string
      end_time: string
      until_date: string
      frequency?: 'weekly'
      notes?: string
    },
    api: Api,
  ) =>
    api.post<RecurrenceWithBookings>('/recurrences', data).then(r => ({
      recurrence: r.data.recurrence,
      bookings: r.data.bookings.map(normBooking),
    })),
}

export const packagesApi = {
  list: (orgId: string, api = apiClient) =>
    api.get<{ packages: Package[] }>('/packages', { params: { org_id: orgId } })
      .then(r => r.data.packages.map(normPackage)),

  listMine: (api: Api) =>
    api.get<{ purchases: UserPackagePurchase[] }>('/packages/me').then(r => r.data.purchases.map(normPurchase)),

  purchase: (packageId: string, orgId: string, api: Api) =>
    api.post<PackagePurchaseCheckout>(`/packages/${packageId}/purchase`, { org_id: orgId })
      .then(r => ({
        purchase: normPurchase(r.data.purchase),
        checkout_url: r.data.checkout_url,
      })),
}

// ─── Support (C17) ───────────────────────────────────────────────────────

export const supportApi = {
  // Works signed out (apiClient) and signed in (an authenticated instance,
  // which is what attaches the customer's identity and their booking).
  create: (body: SupportRequestBody, api: Api = apiClient) =>
    api.post<{ request: SupportRequestReceipt }>('/support/requests', body).then(r => r.data.request),
}

// ─── Admin ───────────────────────────────────────────────────────────────

export type PhotoOwner = 'rooms' | 'spaces'
type PhotoOwnerResponse = { room?: Room; space?: Space }

function photosOf(kind: PhotoOwner, data: PhotoOwnerResponse): Photo[] {
  return (kind === 'rooms' ? data.room?.photos : data.space?.photos) ?? []
}

export const adminApi = {
  getDashboard: (api: Api) =>
    api.get<AdminStats>('/admin/dashboard').then(r => r.data),

  getSpaces: (api: Api) =>
    api.get<{ spaces: Space[] }>('/admin/spaces').then(r =>
      r.data.spaces.map(s => normSpace({ ...s, rooms: s.rooms ?? [] })),
    ),

  createSpace: (data: Partial<Space>, api: Api) =>
    api.post<{ space: Space }>('/admin/spaces', data).then(r => normSpace(r.data.space)),

  updateSpace: (id: string, data: Partial<Space>, api: Api) =>
    api.put<{ space: Space }>(`/admin/spaces/${id}`, data).then(r => normSpace(r.data.space)),

  createRoom: (spaceId: string, data: Partial<Room>, api: Api) =>
    api.post<{ room: Room }>(`/admin/spaces/${spaceId}/rooms`, data).then(r => normRoom(r.data.room)),

  updateRoom: (id: string, data: Partial<Room>, api: Api) =>
    api.put<{ room: Room }>(`/admin/rooms/${id}`, data).then(r => normRoom(r.data.room)),

  // Response carries pagination metadata (total/page/page_size) alongside the
  // page of bookings — see backend/app/routers/admin.py::admin_list_bookings.
  // page/page_size default to 1/20 server-side when omitted, so passing {} keeps
  // today's behavior for callers that don't care about paging.
  getBookings: (params: Record<string, string | number>, api: Api): Promise<PaginatedBookings> =>
    api.get<PaginatedBookings>('/admin/bookings', {
      // Merge with instance defaults (e.g. org_id injected by useApi).
      params: { ...(api.defaults.params || {}), ...params },
    }).then(r => ({ ...r.data, bookings: r.data.bookings.map(normBooking) })),

  updateBooking: (id: string, status: string, api: Api) =>
    api.put<{ booking: Booking }>(`/admin/bookings/${id}`, { status }).then(r => normBooking(r.data.booking)),

  // ── Booking management (A01) ──────────────────────────────────────────
  // A move answers with `hours` (before/after): a duration change moves no
  // money, the operator settles it; the calendar shows both numbers.
  updateBookingDetails: (id: string, body: AdminBookingPatch, api: Api) =>
    api.put<{ booking: Booking; hours?: { before: string; after: string } }>(`/admin/bookings/${id}`, body)
      .then(r => ({
        booking: normBooking(r.data.booking),
        hours: r.data.hours ? { before: num(r.data.hours.before), after: num(r.data.hours.after) } : undefined,
      })),

  createManualBooking: (
    body: { user_id: string; room_id: string; start_time: string; end_time: string; admin_note?: string; notes?: string },
    api: Api,
  ) => api.post<{ booking: Booking }>('/admin/bookings', body).then(r => normBooking(r.data.booking)),

  markBookingPaid: (id: string, reason: string, api: Api) =>
    api.post<{ booking: Booking }>(`/admin/bookings/${id}/mark-paid`, { reason }).then(r => normBooking(r.data.booking)),

  // ── Blocked time (A02) ────────────────────────────────────────────────
  getBlocks: (roomId: string, params: { from?: string; to?: string }, api: Api) =>
    api.get<{ blocks: RoomBlock[] }>(`/admin/rooms/${roomId}/blocks`, { params }).then(r => r.data.blocks),

  createBlock: (roomId: string, body: { start_time: string; end_time: string; reason: string }, api: Api) =>
    api.post<{ block: RoomBlock }>(`/admin/rooms/${roomId}/blocks`, body).then(r => r.data.block),

  updateBlock: (roomId: string, blockId: string, body: Partial<{ start_time: string; end_time: string; reason: string }>, api: Api) =>
    api.put<{ block: RoomBlock }>(`/admin/rooms/${roomId}/blocks/${blockId}`, body).then(r => r.data.block),

  deleteBlock: (roomId: string, blockId: string, api: Api) =>
    api.delete(`/admin/rooms/${roomId}/blocks/${blockId}`).then(() => undefined),

  // ── Users (A05) ──────────────────────────────────────────────────────
  // The org's members, searchable (`q`) and paged; the calendar's customer
  // picker uses the same call with a short page.
  getUsers: (params: { q?: string; page?: number; page_size?: number }, api: Api): Promise<PaginatedOrgUsers> =>
    api.get<PaginatedOrgUsers>('/admin/users', { params }).then(r => r.data),

  getUser: (id: string, api: Api): Promise<OrgUserDetail> =>
    api.get<OrgUserDetail>(`/admin/users/${id}`).then(r => ({
      ...r.data,
      bookings: r.data.bookings.map(normBooking),
      purchases: r.data.purchases.map(normPurchase),
    })),

  setUserRole: (id: string, role: 'admin' | 'member', api: Api): Promise<OrgUser> =>
    api.put<{ user: OrgUser }>(`/admin/users/${id}/role`, { role }).then(r => r.data.user),

  grantHours: (id: string, body: ComplimentaryHoursBody, api: Api): Promise<AdminPurchase> =>
    api.post<{ purchase: AdminPurchase }>(`/admin/users/${id}/complimentary-hours`, body).then(r => normPurchase(r.data.purchase)),

  // "Prolongar validade" (A06): a later expiry and why.
  extendPurchase: (purchaseId: string, body: { expires_at: string; reason: string }, api: Api): Promise<AdminPurchase> =>
    api.put<{ purchase: AdminPurchase }>(`/admin/purchases/${purchaseId}/expiry`, body).then(r => normPurchase(r.data.purchase)),

  getPackages: (api: Api) =>
    api.get<{ packages: Package[] }>('/admin/packages').then(r => r.data.packages.map(normPackage)),

  createPackage: (data: Partial<Package>, api: Api) =>
    api.post<{ package: Package }>('/admin/packages', data).then(r => normPackage(r.data.package)),

  updatePackage: (id: string, data: Partial<Package>, api: Api) =>
    api.put<{ package: Package }>(`/admin/packages/${id}`, data).then(r => normPackage(r.data.package)),

  // ── Photos (C14/C15) ──────────────────────────────────────────────────
  // Every photo call answers with the updated room or space; the photo manager
  // only needs the new list, so that is what these return.
  uploadPhoto: (
    kind: PhotoOwner, id: string, file: File, api: Api, onProgress?: (percent: number) => void,
  ): Promise<Photo[]> => {
    const body = new FormData()
    body.append('file', file)
    return api.post<PhotoOwnerResponse>(`/admin/${kind}/${id}/images`, body, {
      onUploadProgress: (e) => { if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100)) },
    }).then(r => photosOf(kind, r.data))
  },

  deletePhoto: (kind: PhotoOwner, id: string, photoId: string, api: Api): Promise<Photo[]> =>
    api.delete<PhotoOwnerResponse>(`/admin/${kind}/${id}/images/${photoId}`).then(r => photosOf(kind, r.data)),

  // The FULL list of ids in the order wanted; the first becomes the cover.
  reorderPhotos: (kind: PhotoOwner, id: string, order: string[], api: Api): Promise<Photo[]> =>
    api.put<PhotoOwnerResponse>(`/admin/${kind}/${id}/images/order`, { order }).then(r => photosOf(kind, r.data)),

  // ── Support inbox (C19) ───────────────────────────────────────────────
  getSupportRequests: (params: Record<string, string | number>, api: Api): Promise<PaginatedSupportRequests> =>
    api.get<PaginatedSupportRequests>('/admin/support/requests', {
      params: { ...(api.defaults.params || {}), ...params },
    }).then(r => ({ ...r.data, requests: r.data.requests.map(row => ({ ...row, booking: row.booking ? normBooking(row.booking) : null })) })),

  updateSupportRequest: (id: string, status: 'new' | 'closed', api: Api): Promise<SupportRequestRow> =>
    api.put<{ request: SupportRequestRow }>(`/admin/support/requests/${id}`, { status }).then(r => r.data.request),

  getAvailability: (roomId: string, api: Api) =>
    api.get<{ rules: AvailabilityRule[] }>(`/admin/rooms/${roomId}/availability`).then(r => r.data.rules),

  setAvailability: (
    roomId: string,
    rules: Array<{ day_of_week: number; open_time: string; close_time: string }>,
    api: Api,
  ) =>
    api.post<{ rules: AvailabilityRule[] }>(`/admin/rooms/${roomId}/availability`, { rules })
      .then(r => r.data.rules),
}
