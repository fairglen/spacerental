# SpaceRental — Shared API Contract

Base URL: `http://localhost:8000/api/v1`

## Auth
All protected routes require `Authorization: Bearer <jwt>` header.
JWT is HS256, signed with the backend `SECRET_KEY`, issued by `POST /auth/login` or `POST /auth/register`.

## Roles
- `owner` — org owner, full admin
- `admin` — admin within an org
- `member` — regular user / customer

---

## Public Endpoints

### GET /spaces
List all active spaces (public).
Response: `{ spaces: Space[] }`

### GET /spaces/:id
Space detail with rooms.
Response: `{ space: Space, rooms: Room[] }`

### GET /rooms/:id/availability
Query: `?date=YYYY-MM-DD`
Response: `{ slots: [{ start: ISO8601, end: ISO8601, available: bool }] }`

---

## Auth Endpoints

### POST /auth/register
Body: `{ email, password, name? }` (password 8-128 chars, Argon2id hashed)
Response: `{ access_token, token_type: "bearer", user: User, role: "owner"|"admin"|"member" }`

### POST /auth/login
Body: `{ email, password }`
Response: `{ access_token, token_type, user, role }` — same shape as register

### GET /auth/me
Headers: `Authorization: Bearer <jwt>`
Response: `User`

---

## User Endpoints (requires auth)

### GET /bookings/me
My bookings list.
Response: `{ bookings: Booking[] }`

### POST /bookings
Create a booking.
Body: `{ room_id, start_time, end_time, notes? }`
Response: `{ booking: Booking }`

### DELETE /bookings/:id
Cancel a booking (own only, if > 24h before).

### GET /packages
List available packages for an org.
Query: `?org_id=`

### POST /packages/:id/purchase
Purchase a package.
Body: `{ org_id }`
Response: `{ purchase: UserPackagePurchase }`

### GET /packages/me
My package purchases and remaining hours.

---

## Admin Endpoints (requires admin/owner role)

### GET /admin/dashboard
Stats: total bookings, revenue, occupancy rate, active users.

### GET /admin/spaces
All spaces for admin's org.

### POST /admin/spaces
Create a space.
Body: `{ name, description, address, city, images?, amenities? }`

### PUT /admin/spaces/:id
Update a space.

### DELETE /admin/spaces/:id
Soft-delete a space.

### POST /admin/spaces/:id/rooms
Add a room to a space.
Body: `{ name, description, capacity, hourly_rate, color, amenities?, images? }`

### PUT /admin/rooms/:id
Update a room.

### POST /admin/rooms/:id/availability
Set availability rules for a room.
Body: `{ rules: [{ day_of_week, open_time, close_time }] }`

### GET /admin/bookings
All bookings for org.
Query: `?status=&room_id=&from=&to=`

### PUT /admin/bookings/:id
Update booking status.
Body: `{ status: "confirmed"|"cancelled" }`

### GET /admin/users
All users who have booked in this org.

### GET /admin/packages
List packages for this org.

### POST /admin/packages
Create a package.
Body: `{ name, hours, price, validity_days }`

---

## Data Types

```typescript
type Space = {
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

type Room = {
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

type Booking = {
  id: string
  org_id: string
  room_id: string
  user_id: string
  start_time: string   // ISO8601
  end_time: string
  duration_hours: number
  total_amount: number
  status: "pending" | "confirmed" | "cancelled" | "completed"
  payment_method: "hourly" | "package"
  notes?: string
  room?: Room
  user?: User
  created_at: string
}

type User = {
  id: string
  clerk_id: string
  email: string
  name: string
  avatar_url?: string
}

type Package = {
  id: string
  org_id: string
  name: string
  hours: number
  price: number
  validity_days: number
  is_active: boolean
}

type UserPackagePurchase = {
  id: string
  user_id: string
  package_id: string
  org_id: string
  hours_total: number
  hours_used: number
  hours_remaining: number
  purchased_at: string
  expires_at: string
}

type OrgMembership = {
  org_id: string
  role: "owner" | "admin" | "member"
}
```
