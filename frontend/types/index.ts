export type Space = {
  id: string
  org_id: string
  name: string
  description: string
  address: string
  city: string
  images: string[]
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
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed'
  payment_method: 'hourly' | 'package'
  notes?: string
  // Set when this booking is one occurrence of a recurring series.
  recurrence_rule_id?: string | null
  room?: Room
  user?: User
  created_at: string
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
export type BookingCheckout = {
  booking: Booking
  checkout_url: string
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
