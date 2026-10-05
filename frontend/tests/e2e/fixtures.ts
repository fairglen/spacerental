/**
 * Isolated data for every browser test (Q41).
 *
 * The suite runs `fullyParallel` against the e2e stack
 * (docker-compose.e2e.yml). Nothing here is shared between tests: each one
 * gets its own room in the seeded space (the seeded rooms stay read-only and
 * are addressed by name, never by index — the public room order is not
 * stable), its own customer, and a day of its own to book on. The seeded
 * admin (`admin@demo.com`) is the only shared identity, and only for the
 * admin API and the pre-authenticated admin browser state.
 *
 * Plain functions first — `createCustomer`, `loginAs`, `createRoom`,
 * `createBooking`, `buyPack`, `createBlock`, `freshDay` — then a `test`
 * extended with fixtures built on them (`api`, `admin`, `room`, `customer`),
 * so a spec can take what it needs as arguments.
 */
import { randomUUID } from 'node:crypto'
import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type Browser,
  type BrowserContextOptions,
} from '@playwright/test'

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8000/api/v1'
export const API_ORIGIN = new URL(API_URL).origin
export const ADMIN_CREDENTIALS = { email: 'admin@demo.com', password: 'admin123' }
/** The seeded rooms, read-only for the suite (see app/seed.py). */
export const SEEDED_ROOMS = ['Sala Calma', 'Sala Brisa', 'Sala Névoa'] as const
/** Temporary rooms use the seeded rate, so every price assertion still reads 11,00 €/h. */
export const ROOM_RATE = '11.00'
export const OPEN_HOUR = 8
export const CLOSE_HOUR = 22

export type Admin = { token: string; orgId: string; spaceId: string; userId: string }
export type Customer = { id: string; email: string; password: string; name: string; token: string; orgId: string }
export type Room = { id: string; name: string; space_id: string; org_id: string; hourly_rate: number }
export type Booking = {
  id: string
  room_id: string
  start_time: string
  end_time: string
  status: string
  payment_method: string
  org_id: string
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` })
export const isoDate = (d: Date) => d.toISOString().slice(0, 10)

async function okJson<T>(response: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  expect(response.ok(), `${what}: ${response.status()} ${await response.text()}`).toBeTruthy()
  return (await response.json()) as T
}

/**
 * A day of this test's own, `offset` days from today at 00:00 UTC.
 *
 * Each worker is shifted one more day out (bounded so a customer booking
 * stays inside the 30-day window), so two tests running at once on rooms of
 * their own never also share a date — and a leftover from an interrupted run
 * on a long-lived stack lands on another worker's day, not this one's.
 */
export function freshDay(offset: number, workerIndex = base.info().workerIndex): Date {
  const shift = Math.min(workerIndex % 4, Math.max(0, 27 - offset))
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offset + shift)
  return d
}

/** `hour` o'clock UTC on `day`. */
export function at(day: Date, hour: number, minute = 0): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute))
}

/** The seeded admin's API session and the seeded (single) public space. */
export async function adminSession(api: APIRequestContext): Promise<Admin> {
  const login = await okJson<{ access_token: string; user: { id: string } }>(
    await api.post(`${API_URL}/auth/login`, { data: ADMIN_CREDENTIALS }),
    'admin login',
  )
  const headers = auth(login.access_token)
  const { memberships } = await okJson<{ memberships: { org_id: string }[] }>(
    await api.get(`${API_URL}/auth/memberships`, { headers }),
    'admin memberships',
  )
  const { spaces } = await okJson<{ spaces: { id: string; org_id: string }[] }>(
    await api.get(`${API_URL}/spaces`),
    'public spaces',
  )
  const orgId = memberships[0].org_id
  const space = spaces.find((s) => s.org_id === orgId) ?? spaces[0]
  expect(space, 'the seeded space must be public').toBeTruthy()
  return { token: login.access_token, orgId, spaceId: space.id, userId: login.user.id }
}

/** Register a fresh customer (enrolled in the configured org by the backend). */
export async function createCustomer(
  api: APIRequestContext,
  opts: { tag?: string; name?: string; password?: string } = {},
): Promise<Customer> {
  const tag = opts.tag ?? 'e2e'
  const email = `${tag}-${randomUUID().slice(0, 12)}@example.com`
  const password = opts.password ?? 'Password123!'
  const name = opts.name ?? `Cliente ${tag} ${randomUUID().slice(0, 4)}`
  const registered = await okJson<{ access_token: string; user: { id: string } }>(
    await api.post(`${API_URL}/auth/register`, { data: { email, password, name } }),
    `register ${email}`,
  )
  const { memberships } = await okJson<{ memberships: { org_id: string }[] }>(
    await api.get(`${API_URL}/auth/memberships`, { headers: auth(registered.access_token) }),
    'customer memberships',
  )
  return { id: registered.user.id, email, password, name, token: registered.access_token, orgId: memberships[0].org_id }
}

/**
 * A NextAuth browser session for `user`, as a storage state the spec hands to
 * `browser.newContext({ storageState })`. The same CSRF → credentials
 * handshake global-setup.ts does for the admin; the sign-in FORM is only
 * exercised by the specs that are about it.
 */
export async function loginAs(
  user: { email: string; password: string },
  baseURL: string = base.info().project.use.baseURL ?? 'http://localhost:3000',
): Promise<NonNullable<BrowserContextOptions['storageState']>> {
  const ctx = await request.newContext({ baseURL })
  try {
    const { csrfToken } = await okJson<{ csrfToken: string }>(await ctx.get('/api/auth/csrf'), 'NextAuth CSRF')
    const response = await ctx.post('/api/auth/callback/credentials', {
      form: { csrfToken, email: user.email, password: user.password, callbackUrl: new URL('/dashboard', baseURL).href, json: 'true' },
    })
    expect(response.ok(), `credentials callback for ${user.email}: ${response.status()}`).toBeTruthy()
    const session = await okJson<{ user?: { email?: string } }>(await ctx.get('/api/auth/session'), 'NextAuth session')
    expect(session.user?.email, 'the session must belong to the user').toBe(user.email)
    return await ctx.storageState()
  } finally {
    await ctx.dispose()
  }
}

/** A room of the test's own in the seeded space, open every day 08–22 at the seeded rate. */
export async function createRoom(
  api: APIRequestContext,
  admin: Admin,
  opts: { name?: string; hourlyRate?: string; capacity?: number; color?: string } = {},
): Promise<Room> {
  const name = opts.name ?? `E2E ${base.info().titlePath[0]?.replace(/\.spec\.ts$/, '') ?? 'room'} ${randomUUID().slice(0, 6)}`
  const org = { org_id: admin.orgId }
  const { room } = await okJson<{ room: Room }>(
    await api.post(`${API_URL}/admin/spaces/${admin.spaceId}/rooms`, {
      params: org,
      headers: auth(admin.token),
      data: { name, description: 'Sala temporária dos testes de browser', capacity: opts.capacity ?? 4, hourly_rate: opts.hourlyRate ?? ROOM_RATE, color: opts.color ?? '#A8D5BA', amenities: [] },
    }),
    `create room ${name}`,
  )
  const rules = Array.from({ length: 7 }, (_, day) => ({ day_of_week: day, open_time: `${String(OPEN_HOUR).padStart(2, '0')}:00`, close_time: `${String(CLOSE_HOUR).padStart(2, '0')}:00` }))
  await okJson(
    await api.post(`${API_URL}/admin/rooms/${room.id}/availability`, { params: org, headers: auth(admin.token), data: { rules } }),
    `rules for ${name}`,
  )
  return room
}

/**
 * Take a temporary room out of the stack: its live bookings are cancelled
 * (no credit — nothing was really paid), then the room is hard-deleted if
 * nothing ever referenced it, or deactivated otherwise (the deletion policy
 * keeps history). Never throws: cleanup must not hide the test's own result.
 */
export async function removeRoom(api: APIRequestContext, admin: Admin, roomId: string): Promise<void> {
  const org = { org_id: admin.orgId }
  const headers = auth(admin.token)
  try {
    const listed = await api.get(`${API_URL}/admin/bookings`, { params: { ...org, room_id: roomId, include_cancelled: 'false', page_size: 100 }, headers })
    if (listed.ok()) {
      const { bookings } = (await listed.json()) as { bookings: Booking[] }
      for (const b of bookings) {
        if (['pending', 'confirmed'].includes(b.status)) {
          await api.put(`${API_URL}/admin/bookings/${b.id}`, { params: org, headers, data: { status: 'cancelled', credit_hours: false, reason: 'e2e cleanup' } })
        }
      }
    }
    const roomName = (await (await api.get(`${API_URL}/admin/rooms/${roomId}`, { params: org, headers })).json())?.room?.name
    const deleted = await api.delete(`${API_URL}/admin/rooms/${roomId}`, { params: { ...org, confirm: roomName ?? roomId }, headers })
    if (!deleted.ok()) {
      await api.put(`${API_URL}/admin/rooms/${roomId}`, { params: org, headers, data: { is_active: false } })
    }
  } catch {
    // The stack is torn down after the run anyway.
  }
}

/** The customer books `start`–`end` (`hourly` by default); `pay` completes the stub Checkout. */
export async function createBooking(
  api: APIRequestContext,
  customer: { token: string },
  args: { roomId: string; start: Date; end: Date; paymentMethod?: 'hourly' | 'package' | 'mixed'; pay?: boolean; notes?: string },
): Promise<{ booking: Booking; checkout_url: string | null }> {
  const result = await okJson<{ booking: Booking; checkout_url: string | null }>(
    await api.post(`${API_URL}/bookings`, {
      headers: auth(customer.token),
      data: { room_id: args.roomId, start_time: args.start.toISOString(), end_time: args.end.toISOString(), payment_method: args.paymentMethod ?? 'hourly', notes: args.notes },
    }),
    'create booking',
  )
  if (args.pay && result.checkout_url) await payStubCheckout(api, result.checkout_url)
  return result
}

/** Walk the stub Checkout's "Pagar" for a session URL the API handed back. */
export async function payStubCheckout(api: APIRequestContext, checkoutUrl: string): Promise<void> {
  const sessionId = new URL(checkoutUrl).pathname.split('/').pop()
  const paid = await api.post(`${API_ORIGIN}/checkout/stub/${sessionId}/pay`, { maxRedirects: 0 })
  expect(paid.status(), `stub checkout pay for ${sessionId}`).toBe(303)
}

/** An operator booking for `userId` in `roomId` (confirmed, `manual`). */
export async function adminBooking(
  api: APIRequestContext,
  admin: Admin,
  args: { userId: string; roomId: string; start: Date; end: Date; adminNote?: string },
): Promise<Booking> {
  const { booking } = await okJson<{ booking: Booking }>(
    await api.post(`${API_URL}/admin/bookings`, {
      params: { org_id: admin.orgId },
      headers: auth(admin.token),
      data: { user_id: args.userId, room_id: args.roomId, start_time: args.start.toISOString(), end_time: args.end.toISOString(), admin_note: args.adminNote },
    }),
    'admin booking',
  )
  return booking
}

/** The customer buys `packageId` through the stub Checkout; the purchase is active on return. */
export async function buyPack(api: APIRequestContext, customer: { token: string; orgId: string }, packageId: string): Promise<void> {
  const { checkout_url } = await okJson<{ checkout_url: string }>(
    await api.post(`${API_URL}/packages/${packageId}/purchase`, { headers: auth(customer.token), data: { org_id: customer.orgId } }),
    'purchase package',
  )
  await payStubCheckout(api, checkout_url)
}

/** The seeded packages of the org, by hours (10 and 20 are seeded). */
export async function packageByHours(api: APIRequestContext, orgId: string, hours: number): Promise<{ id: string; name: string; hours: number; price: number }> {
  const { packages } = await okJson<{ packages: { id: string; name: string; hours: number; price: number; is_active: boolean }[] }>(
    await api.get(`${API_URL}/packages`, { params: { org_id: orgId } }),
    'packages',
  )
  const pkg = packages.find((p) => p.hours === hours)
  expect(pkg, `no seeded package with ${hours}h`).toBeTruthy()
  return pkg!
}

/** Complimentary hours for a customer (A05), as the operator. */
export async function grantHours(
  api: APIRequestContext,
  admin: Admin,
  args: { userId: string; packageId: string; hours: string; reason?: string; expiresAt?: Date },
): Promise<{ id: string }> {
  const { purchase } = await okJson<{ purchase: { id: string } }>(
    await api.post(`${API_URL}/admin/users/${args.userId}/complimentary-hours`, {
      params: { org_id: admin.orgId },
      headers: auth(admin.token),
      data: { hours: args.hours, package_id: args.packageId, reason: args.reason ?? 'Oferta dos testes de browser', expires_at: args.expiresAt?.toISOString() },
    }),
    'complimentary hours',
  )
  return purchase
}

/** A block the operator puts on a room (A02). */
export async function createBlock(
  api: APIRequestContext,
  admin: Admin,
  args: { roomId: string; start: Date; end: Date; reason?: string },
): Promise<{ id: string }> {
  const { block } = await okJson<{ block: { id: string } }>(
    await api.post(`${API_URL}/admin/rooms/${args.roomId}/blocks`, {
      params: { org_id: admin.orgId },
      headers: auth(admin.token),
      data: { start_time: args.start.toISOString(), end_time: args.end.toISOString(), reason: args.reason ?? 'E2E: bloqueio' },
    }),
    'create block',
  )
  return block
}

/** Cancel a booking as the operator, without a credit; swallows failures (cleanup). */
export async function adminCancel(api: APIRequestContext, admin: Admin, bookingId: string): Promise<void> {
  try {
    await api.put(`${API_URL}/admin/bookings/${bookingId}`, {
      params: { org_id: admin.orgId },
      headers: auth(admin.token),
      data: { status: 'cancelled', credit_hours: false, reason: 'e2e cleanup' },
    })
  } catch {
    // cleanup only
  }
}

/** A seeded room by name — read-only use (public pages, lists), never for booking. */
export async function seededRoom(api: APIRequestContext, spaceId: string, name: (typeof SEEDED_ROOMS)[number]): Promise<Room> {
  const { rooms } = await okJson<{ rooms: Room[] }>(await api.get(`${API_URL}/spaces/${spaceId}`), 'space detail')
  const room = rooms.find((r) => r.name === name)
  expect(room, `${name} is not seeded`).toBeTruthy()
  return room!
}

type Fixtures = {
  /** A request context of the test's own. */
  api: APIRequestContext
  /** A temporary room in the seeded space, removed after the test. */
  room: Room
  /** A fresh registered customer. */
  customer: Customer
}
type WorkerFixtures = {
  /** The seeded admin's API session, once per worker. */
  admin: Admin
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  admin: [
    async ({}, use) => {
      const ctx = await request.newContext()
      try {
        await use(await adminSession(ctx))
      } finally {
        await ctx.dispose()
      }
    },
    { scope: 'worker' },
  ],
  api: async ({}, use) => {
    const ctx = await request.newContext()
    try {
      await use(ctx)
    } finally {
      await ctx.dispose()
    }
  },
  room: async ({ api, admin }, use) => {
    const room = await createRoom(api, admin)
    await use(room)
    await removeRoom(api, admin, room.id)
  },
  customer: async ({ api }, use) => {
    await use(await createCustomer(api))
  },
})

/** A browser context signed in as `user` (`null` = the seeded admin), on this project's baseURL. */
export async function contextAs(
  browser: Browser,
  user: { email: string; password: string } | null,
  options: Omit<BrowserContextOptions, 'storageState'> = {},
) {
  const storageState = await loginAs(user ?? ADMIN_CREDENTIALS)
  return browser.newContext({ ...options, storageState })
}

export { expect }
