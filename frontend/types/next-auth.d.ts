import NextAuth from 'next-auth'

declare module 'next-auth' {
  interface Session {
    accessToken: string
    role: string
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
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken: string
    role: string
    id: string
  }
}
