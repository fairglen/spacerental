import NextAuth from 'next-auth'

type SessionMembership = {
  org_id: string
  role: 'owner' | 'admin' | 'member'
}

declare module 'next-auth' {
  interface Session {
    accessToken: string
    role: string
    memberships: SessionMembership[]
    user: {
      id: string
      email: string
      name?: string | null
    }
  }

  interface User {
    id: string
    email: string
    name?: string | null
    accessToken: string
    role: string
    memberships?: SessionMembership[]
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken: string
    role: string
    id: string
    memberships: SessionMembership[]
  }
}
