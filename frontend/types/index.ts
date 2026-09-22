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
  payment_method: 'hourly' | 'package' | 'mixed'
  // Hours paid with pack hours: 0 for hourly, the whole duration for package,
  // in between for mixed. For hourly/mixed `total_amount` is the money charged.
  package_hours_used?: number
  notes?: string
  // Set when this booking is one occurrence of a recurring series.
  recurrence_rule_id?: string | null
  // C03: deadline of an unpaid checkout hold; null/absent when it never expires.
  hold_expires_at?: string | null
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

export type UserPackagePurchase = {
  id: string
  user_id: string
  package_id: string
  org_id: string
  hours_total: number
  hours_used: number
  hours_remaining: number
  // Hours only become spendable once Stripe confirms the payment.
  status: 'pending' | 'active' | 'cancelled'
  purchased_at: string
  expires_at: string
  package?: Package
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

export type AvailabilitySlot = {
  start: string
  end: string
  available: boolean
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

// What the sender gets back: a reference to quote, never the message.
export type SupportRequestReceipt = {
  id: string
  reference: string
  status: 'new' | 'closed'
  created_at: string
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
