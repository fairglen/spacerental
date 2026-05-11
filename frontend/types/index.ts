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
  purchased_at: string
  expires_at: string
  package?: Package
}

export type AvailabilitySlot = {
  start: string
  end: string
  available: boolean
}

export type AdminStats = {
  total_bookings: number
  revenue_this_month: number
  active_spaces: number
  registered_users: number
}

export type OrgMembership = {
  org_id: string
  role: 'owner' | 'admin' | 'member'
}
