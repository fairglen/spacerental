// An uploaded photo (C14). URLs are absolute and ready to use; `thumb_url` is
// the 480px version for cards. Sizes are null only for a photo carried over
// from an old external `images` URL.
export type Photo = {
  id: string
  url: string
  thumb_url: string
  width: number | null
  height: number | null
}

export type Space = {
  id: string
  org_id: string
  name: string
  description: string
  address: string
  city: string
  postal_code?: string | null
  // Both or neither (the API refuses half a point). Numbers here; the API
  // sends Decimal strings and lib/api.ts converts them at the boundary.
  latitude?: number | null
  longitude?: number | null
  // The clock the rooms' opening hours are read on (R01), an IANA name.
  timezone?: string
  images: string[]
  // In display order; the first is the cover.
  photos?: Photo[]
  amenities: string[]
  is_active: boolean
  created_at: string
  rooms?: Room[]
}

export type Room = {
  id: string
  space_id: string
  org_id: string
  name: string
  description: string
  capacity: number
  hourly_rate: number
  images: string[]
  // In display order; the first is the cover.
  photos?: Photo[]
  amenities: string[]
  color: string
  is_active: boolean
  // Present on the public space detail (V06); absent elsewhere.
  availability_rules?: OpeningWindow[]
}

export type Booking = {
  id: string
  org_id: string
  room_id: string
  user_id: string
  start_time: string
  end_time: string
  duration_hours: number
  total_amount: number
  // C03: `expired` = an unpaid hold whose deadline passed (holds no slot,
  // can be retried); `paid_unfulfilled` = money arrived late for a slot that
  // was taken meanwhile (kept visible; refunds are O02).
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'expired' | 'paid_unfulfilled'
  // `mixed` (C13): part of the block came out of a pack, the rest was paid.
  // `manual` (A01): paid or arranged outside the platform; set by an operator
  // only. Customers may SEE it ("Pago no local") but never send it.
  payment_method: 'hourly' | 'package' | 'mixed' | 'manual'
  // Hours paid with pack hours: 0 for hourly, the whole duration for package,
  // in between for mixed. For hourly/mixed `total_amount` is the money charged.
  package_hours_used?: number
  // H02: which purchases those hours came from. Operator responses only;
  // present while the booking holds its hours.
  package_debits?: BookingPackageDebit[]
  notes?: string
  // Set when this booking is one occurrence of a recurring series.
  recurrence_rule_id?: string | null
  // C03: deadline of an unpaid checkout hold; null/absent when it never expires.
  hold_expires_at?: string | null
  // A01: the operator's private note. Present only in admin responses.
  admin_note?: string | null
  // Door code for a confirmed booking; null until the lock gateway issues
  // one (or when it could not). Never present for pending/cancelled rows.
  access_code?: string | null
  room?: Room
  user?: User
  created_at: string
}

export type PaginatedBookings = {
  bookings: Booking[]
  total: number
  page: number
  page_size: number
}

export type User = {
  id: string
  email: string
  name: string
  avatar_url?: string
}

export type Package = {
  id: string
  org_id: string
  name: string
  hours: number
  price: number
  validity_days: number
  is_active: boolean
}

// K01: where the hours came from — bought, granted by the operator, or the
// paid hours of a cancelled booking.
export type PurchaseSource = 'purchase' | 'complimentary' | 'cancellation_credit'

export type UserPackagePurchase = {
  id: string
  user_id: string
  // null for a cancellation credit: hours that belong to no pack.
  package_id: string | null
  org_id: string
  hours_total: number
  hours_used: number
  hours_remaining: number
  // What was paid, at purchase time: the pack's price, or 0 for hours the
  // operator granted (A05); for a credit, what the cancelled booking cost.
  amount_paid: number
  // Hours only become spendable once Stripe confirms the payment.
  status: 'pending' | 'active' | 'cancelled'
  source: PurchaseSource
  source_booking_id: string | null
  purchased_at: string
  expires_at: string
  package?: Package | null
}

// The operator's view of a purchase (A05): plus the private note.
export type AdminPurchase = UserPackagePurchase & { admin_note: string | null }

// H02: one purchase's share of a booking's pack hours.
export type BookingPackageDebit = {
  purchase_id: string
  hours: number
  package_name: string | null
  expires_at: string | null
}

// H02: the hour bank as one number — every active, unexpired hour the
// customer holds — and the slice of it that lapses first.
export type PackageBalance = {
  hours_available: number
  hours_expiring_next: { hours: number; expires_at: string } | null
}

export type MyPackages = {
  purchases: UserPackagePurchase[]
  balance: PackageBalance
}

// One member of the operator's org, as /admin/users lists them (A05).
export type OrgUser = {
  id: string
  email: string
  name: string
  role: 'owner' | 'admin' | 'member'
  joined_at: string
  bookings_count: number
  // "Suspender" (G02): set while the account cannot sign in.
  disabled_at?: string | null
  created_at: string
}

export type PaginatedOrgUsers = {
  users: OrgUser[]
  total: number
  page: number
  page_size: number
}

export type OrgUserDetail = {
  user: OrgUser
  bookings: Booking[]
  purchases: AdminPurchase[]
  // The same bank the customer sees on their packs page (H02).
  balance: PackageBalance
  support_requests: SupportRequestRow[]
}

export type ComplimentaryHoursBody = {
  hours: number
  package_id: string
  reason: string
  expires_at?: string
}

// POST /bookings and POST /packages/{id}/purchase both return the created
// resource alongside the Stripe Checkout URL the user must be sent to.
// A booking paid with package hours is already `confirmed` and has nothing
// left to pay, so it comes back without a URL.
export type BookingCheckout = {
  booking: Booking
  checkout_url: string | null
}

export type RecurrenceRule = {
  id: string
  org_id: string
  room_id: string
  user_id: string
  frequency: 'weekly'
  start_time: string
  end_time: string
  until_date: string
  notes?: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

// POST /recurrences and PUT /recurrences/{id} return the rule plus every
// occurrence it expanded to. No checkout_url yet — charging a whole series
// through one Checkout Session is deferred to the Stripe follow-up (Epic 2).
export type RecurrenceWithBookings = {
  recurrence: RecurrenceRule
  bookings: Booking[]
}

export type PackagePurchaseCheckout = {
  purchase: UserPackagePurchase
  checkout_url: string
}

// Why a slot is not bookable (H01); null exactly when `available` is true.
export type SlotReason = 'past' | 'booked' | 'blocked' | 'beyond_window'

export type AvailabilitySlot = {
  start: string
  end: string
  available: boolean
  reason?: SlotReason | null
}

// A room's public opening window (V06): weekday 0 = Monday, UTC times as the
// API sends them ("08:00:00").
export type OpeningWindow = {
  day_of_week: number
  open_time: string
  close_time: string
}

export type AvailabilityRule = {
  id: string
  room_id: string
  day_of_week: number
  open_time: string
  close_time: string
  is_active: boolean
}

// The help form (C17).
export type SupportCategory = 'technical' | 'booking' | 'payment' | 'package' | 'other'

export type SupportRequestBody = {
  category: SupportCategory
  message: string
  // Required when signed out; ignored (the account's address is used) when signed in.
  contact_email?: string
  booking_id?: string
  context: {
    page_url?: string
    viewport?: string
    user_agent?: string
    app_version?: string
    timestamp?: string
  }
  // Honeypot: always empty from a real form.
  website: string
}

// Triage (C19, G04): `in_progress` means someone is on it.
export type SupportStatus = 'new' | 'in_progress' | 'closed'

// What the sender gets back: a reference to quote, never the message.
export type SupportRequestReceipt = {
  id: string
  reference: string
  status: SupportStatus
  created_at: string
}

// One inbox row for the operator (C19).
export type SupportRequestRow = {
  id: string
  reference: string
  category: SupportCategory
  status: SupportStatus
  contact_email: string
  user_id: string | null
  booking_id: string | null
  booking: Booking | null
  message: string
  context: SupportRequestBody['context']
  created_at: string
  updated_at: string
}

export type PaginatedSupportRequests = {
  requests: SupportRequestRow[]
  total: number
  page: number
  page_size: number
}

export type AdminStats = {
  total_bookings: number
  total_revenue: number
  occupancy_rate: number
  active_users: number
}

export type OrgMembership = {
  org_id: string
  role: 'owner' | 'admin' | 'member'
}

export type Membership = {
  org_id: string
  org_name: string
  org_slug: string
  role: 'owner' | 'admin' | 'member'
}

// A02: a stretch of time the operator took a room out of service.
export type RoomBlock = {
  id: string
  org_id: string
  room_id: string
  start_time: string
  end_time: string
  reason: string
  created_by: string | null
  created_at: string
}

// A01: what PUT /admin/bookings/:id accepts — any subset.
export type AdminBookingPatch = {
  status?: Booking['status']
  start_time?: string
  end_time?: string
  room_id?: string
  admin_note?: string | null
  // G04: the customer-visible note, and the price override (needs a reason).
  notes?: string | null
  total_amount?: number
  // K01: cancelling credits the paid hours unless this is false (then a
  // reason is required).
  credit_hours?: boolean
  reason?: string
}

// ── Part A1's admin endpoints (G01–G04) ───────────────────────────────────

// One row of the audit trail (G01).
export type AuditActor = { id: string; name: string | null; email: string }
export type AdminAction = {
  id: string
  org_id: string
  actor: AuditActor | null
  entity_type: AuditEntityType
  entity_id: string
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  reason: string | null
  request_id: string | null
  created_at: string
}
export type AuditEntityType =
  | 'space' | 'room' | 'availability_rule' | 'room_block' | 'booking' | 'user'
  | 'package' | 'purchase' | 'support_request' | 'organization'
export type PaginatedActions = { actions: AdminAction[]; total: number; page: number; page_size: number }
export type AuditFilters = {
  entity_type?: AuditEntityType
  entity_id?: string
  actor?: string
  from?: string
  to?: string
  page?: number
  page_size?: number
}

// The admin's space/room/booking/package pages (G04).
export type BookingCounts = { total: number; upcoming: number }
export type AdminSpaceDetail = { space: Space; photo_count: number; bookings: BookingCounts }
export type AdminRoomDetail = {
  room: Room
  space: Space
  rules: AvailabilityRule[]
  blocks: RoomBlock[]
  photo_count: number
  bookings: BookingCounts
}
// K01: the credit a cancelled paid booking left in the customer's bank.
export type CancellationCredit = {
  id: string
  hours_total: number
  hours_remaining: number
  status: UserPackagePurchase['status']
  expires_at: string
}
export type AdminBookingDetail = {
  booking: Booking & { stripe_checkout_session_id: string | null; cancellation_credit?: CancellationCredit | null }
  history: AdminAction[]
}
export type AdminPackageDetail = {
  package: Package
  purchases: { total: number; active: number }
  hours_outstanding: number
}

// The blockers a refused hard delete lists (G02): `detail.blockers` of a 409.
export type DeleteBlockers =
  | Array<{ room_id: string; name: string; bookings: number }>
  | Record<string, number | string>
  | Array<Record<string, unknown>>

// Users (G03/G04).
export type AdminUserCreateBody = { email: string; name?: string; password?: string }
export type AdminUserPatch = { name?: string; email?: string; disabled_at?: string | null }
export type AnonymisedUser = { id: string; email: string; name: string | null; disabled_at: string | null }

// Purchases (G04): the list carries the customer alongside each row.
export type AdminPurchaseRow = AdminPurchase & { user: AuditActor }
export type PaginatedPurchases = { purchases: AdminPurchaseRow[]; total: number; page: number; page_size: number }
export type PurchaseDebit = {
  booking_id: string
  hours: number
  start_time: string
  end_time: string
  status: string
  room_name: string | null
}
export type AdminPurchaseDetail = { purchase: AdminPurchase; user: AuditActor; debits: PurchaseDebit[] }
export type PurchaseFilters = {
  user_id?: string
  package_id?: string
  status?: UserPackagePurchase['status']
  expiring_before?: string
  page?: number
  page_size?: number
}

// Support (G04): the detail carries the note and the person.
export type SupportRequestDetail = SupportRequestRow & { admin_note: string | null; user: AuditActor | null }

// Organisation settings (G04).
export type OrganizationSettings = {
  id: string
  name: string
  slug: string
  plan: string
  contact_email: string | null
  contact_phone: string | null
  timezone: string
  created_at: string
  updated_at: string
}
// The organisation's public contact on the space detail (G04); nulls when unset.
export type PublicContact = { email: string | null; phone: string | null }

export type OrganizationSettingsPatch = {
  name?: string
  contact_email?: string | null
  contact_phone?: string | null
  timezone?: string
}
